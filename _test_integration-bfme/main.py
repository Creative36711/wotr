#!/usr/bin/env python3
"""
BFME2: RotWK integration — AUTO FLOW (entry point).

Интерактивно спрашивает настройки боя, запускает игру, проходит меню до
комнаты создания игры и выставляет уровень сложности ботам.

Flow:
    ask setup (фракция, число игроков 2–8, сложность ботов, новые WOTR-механики)
    -> записать NetworkPref.ini (фракция + авто-цвет игрока)
    -> генерация __wotr_generated_presets.big (золото/ОК/сигнальный огонь/PP
       + кольцевая расстановка стартовой армии; боты — случайные значения)
    -> запуск игры (полный экран) -> окно -> главное меню
    -> «Сеть» -> «Лок. сеть» -> «Создать игру» -> комната
    -> выставить сложность слотам ботов (2..N)
    -> бой -> экран статистики -> определение команды-победителя
       (match_result_detector) -> config/match_result.json

Задержки — в bridge/timings.py. Координаты слотов — bridge/room.py,
кнопок меню — config/menu_positions.json.
"""

import argparse
import json
import os
import sys
import time

# Make `bridge` importable no matter how this script is launched.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bridge import config
from bridge import elevate
from bridge import input_lock
from bridge import launcher
from bridge.log import log, start as log_start
from bridge import maps
from bridge import match_players
from bridge import menu
from bridge import navigate as nav
from bridge import network_prefs
from bridge import room
from bridge import spawn
from bridge import timings
from bridge import visual_ready

try:
    from match_result_detector import MatchResultDetector, STATUS_UNKNOWN
except ImportError:  # модуль опционален
    MatchResultDetector = None
    STATUS_UNKNOWN = "UNKNOWN"

T = timings.TIMINGS

# Ключ фракции -> отображаемое имя (для интерактивного опроса).
FACTION_CHOICES = [
    ("men",      "Люди"),
    ("elves",    "Эльфы"),
    ("dwarves",  "Гномы"),
    ("isengard", "Изенгард"),
    ("mordor",   "Мордор"),
    ("goblins",  "Гоблины"),
    ("angmar",   "Ангмар"),
]

DIFFICULTY_NAMES = room.DIFFICULTY_NAMES

# Маркер экрана «Лок. сеть» (картинка из _tools/, рядом с приложением).
LAN_MARKER_PATH = os.path.join(config.BASE_DIR, "_tools",
                               "Маркер локальной сети.jpg")


def wait_for_window(timeout, poll=0.5):
    """Wait for the REAL game window (game.dat), not the launcher's hidden one."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        hwnd, how = nav.find_game_window()
        if hwnd:
            return hwnd, how
        time.sleep(poll)
    return None, None


def ask_faction(prompt="За какую фракцию играем?"):
    log(prompt)
    for i, (_key, name) in enumerate(FACTION_CHOICES, 1):
        log(f"  {i}. {name}")
    while True:
        s = input("> ").strip().lower()
        if s.isdigit() and 1 <= int(s) <= len(FACTION_CHOICES):
            return FACTION_CHOICES[int(s) - 1][0]
        for key, name in FACTION_CHOICES:
            if s in (key, name.lower()):
                return key
        log("  Введите номер или название фракции.")


def ask_total_players():
    while True:
        s = input("Сколько игроков всего (2–8)? > ").strip()
        if s.isdigit() and 2 <= int(s) <= 8:
            return int(s)
        log("  Введите число от 2 до 8.")


def ask_difficulty():
    log("Уровень сложности ботов:")
    for i, name in enumerate(DIFFICULTY_NAMES, 1):
        log(f"  {i}. {name}")
    while True:
        s = input("> ").strip()
        if s.isdigit() and 1 <= int(s) <= len(DIFFICULTY_NAMES):
            return int(s) - 1  # 0-based индекс
        log("  Введите номер уровня сложности.")


def ask_bot_factions(total_players):
    """Фракции ботов (слоты 2..total_players). Возвращает dict {slot: faction_key}."""
    factions = {}
    for slot in range(2, total_players + 1):
        factions[slot] = ask_faction(f"Фракция слота {slot} (бота):")
    return factions


def ask_map():
    """Какая карта."""
    maps_dict = maps.reload_maps()
    keys = list(maps_dict.keys())
    log("На какой карте происходит игра?")
    for i, k in enumerate(keys, 1):
        m = maps_dict[k]
        fort_tag = " [КРЕПОСТЬ]" if m.get("is_fortress") else ""
        log(f"  {i}. {m['name']}{fort_tag} ({m['map_name']})")
    while True:
        s = input("> ").strip().lower()
        if s.isdigit() and 1 <= int(s) <= len(keys):
            return keys[int(s) - 1]
        for k in keys:
            m = maps_dict[k]
            if s in (k, m['name'].lower(), m['map_name'].lower()):
                return k
        for k in keys:
            m = maps_dict[k]
            if s in m['map_name'].lower().replace("map ", ""):
                return k
        log("  Введите номер или название карты.")


def ask_player_role():
    """Игрок является защитником или атакующим."""
    log("Кем является игрок?")
    log("  1. Защитник (оборона)")
    log("  2. Атакующий (атака)")
    while True:
        s = input("> ").strip().lower()
        if s in ("1", "защитник", "защита", "оборона", "def", "defender"):
            return "defender"
        if s in ("2", "атакующий", "атака", "atk", "attacker"):
            return "attacker"
        log("  Введите 1 (защитник) или 2 (атакующий).")


def ask_position_mode():
    """Расстановка стартовых позиций: по приоритету или случайно."""
    log("Как расставить стартовые позиции?")
    log("  1. По приоритету")
    log("  2. Случайно (отдельно для защиты и атаки)")
    while True:
        s = input("> ").strip().lower()
        if s in ("1", "приоритет", "по приоритету", "priority", "p", ""):
            return "priority"
        if s in ("2", "случайно", "рандом", "random", "r"):
            return "random"
        log("  Введите 1 (по приоритету) или 2 (случайно).")


def ask_fortress_owner(defender_slots, bot_factions=None, player_faction=None):
    """Спрашивает, какой слот из защитников является владельцем крепости."""
    if len(defender_slots) == 1:
        slot = defender_slots[0]
        fname = room.FACTION_NAMES.get(player_faction if slot == 1 else bot_factions.get(slot, ""), "")
        name = "игрок" if slot == 1 else "бот"
        desc = f"{name}, {fname}" if fname else name
        log(f"Владелец крепости: слот {slot} ({desc})")
        return slot

    log("Кто владелец крепости (из защитников)?")
    for slot in sorted(defender_slots):
        if slot == 1:
            fname = room.FACTION_NAMES.get(player_faction, "")
            log(f"  {slot}. Слот {slot} (игрок{f', {fname}' if fname else ''})")
        else:
            fname = room.FACTION_NAMES.get(bot_factions.get(slot, ""), "") if bot_factions else ""
            log(f"  {slot}. Слот {slot} (бот{f', {fname}' if fname else ''})")

    while True:
        s = input("> ").strip().lower()
        if s.isdigit() and int(s) in defender_slots:
            return int(s)
        if s in ("игрок", "player", "1") and 1 in defender_slots:
            return 1
        valid_str = ", ".join(str(x) for x in sorted(defender_slots))
        log(f"  Введите номер слота из защитников ({valid_str}).")


def ask_army(faction):
    """Состав стартовой армии игрока: список отрядов, каждый со своим уровнем
    и апгрейдами. Возвращает [{"unit":..., "level":N, "upgrades":[...]}].

    Выбор поотрядный: можно добавить несколько ОДИНАКОВЫХ отрядов с разными
    уровнями/апгрейдами (мечники 2 ур. без грейдов и мечники 5 ур. со всеми).
    """
    roster = spawn.roster(faction)
    fname = room.FACTION_NAMES.get(faction, faction)
    log(f"Состав стартовой армии ({fname}). Доступные отряды:")
    for i, (unit, label, cap, upg) in enumerate(roster, 1):
        mark = ", героич." if cap > 5 else ""
        log(f"  {i:2d}. {label} (ур. до {cap}{mark})")

    squads = []
    while True:
        s = input("Добавить отряд: номер из списка, 0 = закончить > ").strip()
        if s in ("0", ""):
            break
        if not (s.isdigit() and 1 <= int(s) <= len(roster)):
            log(f"  Введите номер 1..{len(roster)} или 0.")
            continue
        unit, label, cap, avail_upg = roster[int(s) - 1]

        # уровень
        while True:
            s2 = input(f"    Уровень «{label}» (1-{cap})? > ").strip()
            if s2.isdigit() and 1 <= int(s2) <= cap:
                level = int(s2)
                break
            log(f"    Введите число от 1 до {cap}.")

        # апгрейды
        chosen = []
        if avail_upg:
            log(f"    Апгрейды «{label}» (номера через запятую, 0 = без):")
            for i, a in enumerate(avail_upg, 1):
                log(f"      {i}. {spawn._short(a)}")
            while True:
                s3 = input("    > ").strip()
                if s3 in ("0", ""):
                    break
                parts = [p.strip() for p in s3.split(",") if p.strip()]
                if all(p.isdigit() and 1 <= int(p) <= len(avail_upg) for p in parts):
                    chosen = [avail_upg[int(p) - 1] for p in parts]
                    break
                log(f"    Введите номера 1..{len(avail_upg)} через запятую, или 0.")
        else:
            log("    (у этого отряда нет апгрейдов)")

        squads.append({"unit": unit, "level": level, "upgrades": chosen})
        log(f"    + добавлено: {label}, ур.{level}"
            + (f" [{', '.join(spawn._short(a) for a in chosen)}]" if chosen else ""))
    return squads


def ask_heroes(faction):
    """Выбор героев игрока. Возвращает (heroes, ring_heroes).

    heroes = [{"hero": имя, "level": N}, ...]  (уровни 1..10)
    ring_heroes = [имя, ...]  (без уровня/апгрейдов)
    """
    fname = room.FACTION_NAMES.get(faction, faction)
    heroes = []
    ring = []

    # Обычные герои фракции.
    hlist = spawn.heroes_for(faction)
    if hlist:
        log(f"Герои фракции ({fname}) — номера через запятую, 'r' = случайно, 0 = без:")
        for i, h in enumerate(hlist, 1):
            log(f"  {i}. {h}")
        while True:
            s = input("> ").strip()
            if s in ("r", "random", "случайно"):
                heroes = spawn.random_heroes(faction)
                ring = spawn.random_ring_hero(faction)
                return heroes, ring
            if s in ("0", ""):
                break
            parts = [p.strip() for p in s.split(",") if p.strip()]
            if parts and all(p.isdigit() and 1 <= int(p) <= len(hlist) for p in parts):
                for p in parts:
                    hname = hlist[int(p) - 1]
                    while True:
                        lv = input(f"    Уровень героя {hname} (1-10)? > ").strip()
                        if lv.isdigit() and 1 <= int(lv) <= 10:
                            heroes.append({"hero": hname, "level": int(lv)})
                            break
                        log("    Введите число от 1 до 10.")
                break
            log(f"    Введите номера 1..{len(hlist)}, 'r' или 0.")
    else:
        log(f"У фракции {fname} нет героев.")

    # Кольцевой герой — по стороне фракции.
    alignment = spawn.faction_alignment(faction)
    if alignment:
        rh = spawn.RING_HEROES[alignment][0]
        side = "добро" if alignment == "good" else "зло"
        log(f"Кольцевой герой ({side}): {rh}")
        s = input("Выбрать кольцевого героя? (1 = да, 0 = нет) > ").strip()
        if s == "1":
            ring.append(rh)

    return heroes, ring


def _ask_handicap_value(prompt):
    """Одно значение форы: 0 = без, либо -5..-95 кратное 5."""
    while True:
        s = input(f"{prompt} > ").strip()
        if s in ("", "0"):
            return 0
        s2 = s.replace("%", "").replace(" ", "")
        try:
            v = int(s2)
        except ValueError:
            log("  Введите 0 или -5..-95 (кратное 5).")
            continue
        if -95 <= v <= -5 and v % 5 == 0:
            return v
        log("  Введите 0 или -5..-95 (кратное 5).")


def ask_handicaps(total_players):
    """Фора по слотам 1..total_players. Возвращает {slot: percent} (только ненулевые)."""
    log("Фора (0 = без, шаг -5%, до -95%). Ставится на игрока и ботов:")
    handicaps = {}
    # слот 1 = игрок
    v = _ask_handicap_value("  Игрок (слот 1)")
    if v:
        handicaps[1] = v
    for slot in range(2, total_players + 1):
        v = _ask_handicap_value(f"  Бот (слот {slot})")
        if v:
            handicaps[slot] = v
    return handicaps


def _ask_int(prompt, lo, hi, default=None, none_ok=False):
    """Числовой ответ из [lo..hi]. Пустой ввод = default (или None).
    none_ok — разрешить ввод '0'/'нет' как None (для сигнального огня)."""
    while True:
        s = input(prompt).strip().lower()
        if s in ("r", "рандом", "random", "случайно"):
            return "random"
        if s == "" and default is not None:
            return default
        if none_ok and s in ("нет", "no", "н", "0"):
            return None
        if s.isdigit() and lo <= int(s) <= hi:
            return int(s)
        if not none_ok:
            log(f"  Введите число от {lo} до {hi}, 'r' (рандом) или Enter для значения {default}.")
        else:
            log(f"  Введите число от {lo} до {hi} (Enter = {default}), 'нет'/'0' = нет, 'r' = рандом.")


def ask_mechanics():
    """Опрос новых WOTR-механик — ТОЛЬКО для игрока (слот 1).

    Возвращает dict (или None при 'r' — всё случайно):
        gold            — бонусные стартовые деньги (0 = без)
        command_points  — дополнительные командные очки (0 = без)
        signal_fire     — True/False (сигнальный огонь)
        start_pp        — стартовые очки палантира 0..10
        pp_rate         — прирост PP каждые 2 минуты 1..5
    """
    log("Новые WOTR-механики (для игрока; у ботов — случайные значения).")
    log("  В каждом вопросе можно ввести 'r' — случайное значение.")
    s = input("Задать механики вручную или всё рандомом? (1 = вручную, 2 = всё рандом) > ").strip().lower()
    if s not in ("1", "вручную", "manual", "да", "y"):
        return None

    gold = _ask_int("Сколько бонусных стартовых денег у игрока? (0 = без, Enter = 5000) > ", 0, 1000000, default=5000)
    if gold == "random":
        return None
    cp = _ask_int("Сколько дополнительных командных очков у игрока? (0 = без, Enter = 500) > ", 0, 100000, default=500)
    if cp == "random":
        return None
    sf = _ask_int("Есть ли у фракции игрока сигнальный огонь? (1 = да, Enter = 1) > ", 1, 1, default=1, none_ok=True)
    if sf == "random":
        return None
    start_pp = _ask_int("Сколько стартовых PP у игрока? (0–10, Enter = 5) > ", 0, 10, default=5)
    if start_pp == "random":
        return None
    pp_rate = _ask_int("Сколько PP получает игрок каждые 2 минуты? (1–5, Enter = 3) > ", 1, 5, default=3)
    if pp_rate == "random":
        return None
    return {
        "gold": gold,
        "command_points": cp,
        "signal_fire": bool(sf),
        "start_pp": start_pp,
        "pp_rate": pp_rate,
    }


def _ensure_lan_screen(lan_marker, menu_marker=None, menu_meta=None,
                       attempts=3):
    """Дождаться экрана «Лок. сеть» (верификация маркером-картинкой).

    При холодном старте игра может ещё не принимать инжектируемый ввод: клики
    «Сеть» -> «Лок. сеть» уходят «в пустоту», и мы остаёмся в главном меню.
    Если маркер LAN не найден за lan_marker_timeout:
      * главное меню подтверждено маркером (или menu_marker не задан) — считаем,
        что клики ушли в пустоту, и ПОВТОРЯЕМ навигацию;
      * главное меню НЕ подтверждено — экран LAN просто ещё грузится, ждём ещё
        одну порцию и проверяем маркер снова.

    Возвращает True, если экран «Лок. сеть» подтверждён маркером.
    """
    for attempt in range(1, attempts + 1):
        if visual_ready.wait_image_marker(
                lan_marker, roi_frac=visual_ready.LAN_SCREEN_MARKER_ROI,
                poll=T["lan_marker_poll"], timeout=T["lan_marker_timeout"]):
            return True
        if attempt >= attempts:
            break
        on_main_menu = True
        if menu_marker is not None:
            on_main_menu = visual_ready.is_ready(menu_marker, menu_meta)
        if on_main_menu:
            log(f"[lan] маркер LAN не найден за {T['lan_marker_timeout']:.0f}с — "
                f"клики ушли в пустоту (холодный старт), повторяю "
                f"«Сеть»->«Лок. сеть» (попытка {attempt + 1}/{attempts})")
            if not menu.goto_lan():
                return False
        else:
            log(f"[lan] маркер LAN не найден, главное меню не подтверждено — "
                f"экран ещё грузится, проверяю снова (попытка "
                f"{attempt + 1}/{attempts})")
    return False


def write_match_result(result):
    """Записать итог матча в config/match_result.json."""
    out = os.path.join(config.CONFIG_DIR, "match_result.json")
    try:
        with open(out, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        log(f"[match] результат записан: {out}")
    except OSError as e:
        log(f"[match] ОШИБКА записи {out}: {e}", file=sys.stderr)


def _lock_for_stats():
    """Заблокировать физический ввод на время сбора статистики."""
    ok = input_lock.lock()
    if ok:
        log("[lock] input blocked (stats gathering)")
    else:
        log("[lock] WARNING: input lock failed during stats gathering", file=sys.stderr)


def _unlock_after_stats():
    """Разблокировать физический ввод после сбора статистики."""
    input_lock.unlock()
    log("[lock] input unblocked (stats done)")


def monitor_match_result(players, detector_cfg, lock_input=True):
    """Дождаться экрана статистики и определить команду-победителя.

    Блокирует выполнение до появления результатов (или до таймаута).
    Записывает результат в config/match_result.json.

    Во время кликов по вкладкам/слотам блокирует физический ввод: залочиваем
    его, когда детектор видит ЭКРАН СТАТИСТИКИ (fortress_icon + score_marker),
    и разблокируем после анализа. Это защищает быстрые клики автоматизации от
    вмешательства пользователя.
    """
    if MatchResultDetector is None:
        log("[match] match_result_detector не установлен — пропускаю", file=sys.stderr)
        return None

    log(f"[match] жду экран статистики (до {detector_cfg.get('monitor_timeout', 1500)}s)...")
    detector = MatchResultDetector(
        players,
        config=detector_cfg,
        capture=nav.capture_window,
        click=nav.click,
        game_alive=lambda: nav.find_game_window(require_visible=False)[0] is not None,
    )
    if lock_input:
        detector.on_score_screen_detected = _lock_for_stats
        detector.on_analysis_finished = _unlock_after_stats
    result = detector.wait_for_result(timeout=detector_cfg.get("monitor_timeout", 1500))
    if not result:
        result = {"match_status": STATUS_UNKNOWN, "winning_team": None,
                  "losing_team": None, "winning_team_label": None,
                  "losing_team_label": None, "winners": [], "losers": [],
                  "unmatched_players": [],
                  "raw_data": {"error": "no result (monitor timeout)"}}
    write_match_result(result)
    wt = result.get("winning_team")
    wt_label = result.get("winning_team_label") or wt
    log(f"[match] результат: status={result.get('match_status')} "
        f"winning_team={wt} ({wt_label})")
    return result


def main(argv=None):
    ap = argparse.ArgumentParser(description="launch game and auto-configure a battle")
    ap.add_argument("--exe", help="explicit game/launcher path")
    ap.add_argument("--arg", action="append", dest="args",
                    help="extra launch arg (repeatable)")
    ap.add_argument("--map", help="ключ или имя карты из config/maps.json")
    ap.add_argument("--elevated", action="store_true",
                    help="launch through UAC prompt")
    ap.add_argument("--stop-at", choices=["lan", "create"], default="create",
                    help="lan = stop after entering LAN; create = also click Create Game")
    ap.add_argument("--no-monitor", dest="monitor", action="store_false",
                    help="don't detect the match result after the battle (offline/testing)")
    ap.set_defaults(monitor=None)  # None -> resolve from config.json later
    ap.add_argument("--lock-input", dest="lock_input", action="store_true", default=None,
                    help="block the user's physical keyboard/mouse during "
                         "navigation (ON by default via config.json)")
    ap.add_argument("--no-lock-input", dest="lock_input", action="store_false",
                    help="disable input blocking")
    args = ap.parse_args(argv)

    log_start()  # отсчёт времени сценария — с этого момента

    # Восстановить APPDATA реального пользователя, если передан через
    # --_real_appdata (elevate.ensure_admin() передаёт при UAC-повышении).
    elevate.restore_real_appdata()

    cfg = config.load_config()
    lock_input = args.lock_input if args.lock_input is not None \
        else cfg.get("lock_input", True)

    # Сохранить APPDATA текущего пользователя ДО повышения привилегий.
    # После elevate %APPDATA% может указывать на профиль администратора,
    # а не на профиль пользователя, из-под которого запускается игра.
    network_prefs.save_real_appdata()

    # The game runs elevated -> the script must too, or injected input is
    # silently blocked (UIPI). Re-launches itself via UAC if needed.
    elevate.ensure_admin()

    # Интерактивный опрос ДО блокировки ввода (пользователь должен печатать).
    difficulty = ask_difficulty()
    total_players = ask_total_players()
    faction = ask_faction()
    bot_factions = ask_bot_factions(total_players)

    # Выбор карты (из config/maps.json)
    if getattr(args, "map", None):
        map_key = args.map
        map_data = maps.get_map(map_key)
        if not map_data:
            log(f"ОШИБКА: карта '{map_key}' не найдена в config/maps.json", file=sys.stderr)
            return 1
        is_fortress = maps.is_fortress_map(map_data)
    else:
        map_key = ask_map()
        map_data = maps.get_map(map_key)
        is_fortress = maps.is_fortress_map(map_key)

    player_role = ask_player_role()
    position_mode = ask_position_mode()
    random_pos = (position_mode == "random")

    fortress_owner = None
    if is_fortress:
        def_slots_preview, _ = maps.get_team_slots(player_role, total_players, faction, bot_factions)
        fortress_owner = ask_fortress_owner(def_slots_preview, bot_factions, faction)

    slot_positions, def_slots, atk_slots = maps.calculate_slot_positions(
        map_data, player_role, total_players, faction, bot_factions,
        random_positions=random_pos,
        fortress_owner=fortress_owner)
    army = ask_army(faction)
    if not army:
        army = spawn.random_squads(faction)
        log("[setup] войска не выбраны — случайный состав:")
        for sq in army:
            log(f"  {sq['unit']} ур.{sq['level']}"
                + (f" [{', '.join(spawn._short(a) for a in sq['upgrades'])}]"
                   if sq['upgrades'] else ""))
    heroes, ring_heroes = ask_heroes(faction)
    mechanics = ask_mechanics()
    handicaps = ask_handicaps(total_players)
    color_name = network_prefs.FACTION_COLORS.get(faction)
    map_info = map_data
    role_name = "Защитник (оборона)" if player_role == "defender" else "Атакующий (атака)"
    mode_name = "Случайно" if random_pos else "По приоритету"
    log(f"[setup] фракция={faction}  цвет={color_name}  игроков={total_players}  "
        f"сложность ботов={DIFFICULTY_NAMES[difficulty]}")
    log(f"[setup] карта={map_info['name']} ({map_info['map_name']})"
        + (" [КРЕПОСТЬ]" if map_info.get("is_fortress") else ""))
    log(f"[setup] игрок={role_name}  расстановка={mode_name}")
    if fortress_owner:
        owner_name = "игрок" if fortress_owner == 1 else f"бот ({room.FACTION_NAMES.get(bot_factions.get(fortress_owner, ''), '')})"
        log(f"[setup]   владелец крепости: слот {fortress_owner} ({owner_name}) -> первая позиция")
    log(f"[setup]   оборона: слоты {def_slots}")
    log(f"[setup]   атака:   слоты {atk_slots}")
    for s_idx in sorted(slot_positions):
        side = "защита" if s_idx in def_slots else "атака"
        owner_mark = " [владелец крепости]" if s_idx == fortress_owner else ""
        log(f"[setup]   позиция слота {s_idx} ({side}{owner_mark}): {slot_positions[s_idx]}")
    for slot in sorted(bot_factions):
        log(f"[setup]   слот {slot}: {room.FACTION_NAMES.get(bot_factions[slot])}")
    for sq in army:
        u = sq["unit"]
        s = f"[setup] отряд: {u} ур.{sq['level']}"
        if sq["upgrades"]:
            s += " [" + ", ".join(spawn._short(a) for a in sq["upgrades"]) + "]"
        log(s)
    for h in heroes:
        log(f"[setup] герой: {h['hero']} ур.{h['level']}")
    for r in ring_heroes:
        log(f"[setup] кольцевой герой: {r}")
    if mechanics:
        log(f"[setup] механики игрока: золото={mechanics['gold']}  "
            f"ОК={mechanics['command_points']}  "
            f"сигн.огонь={'да' if mechanics['signal_fire'] else 'нет'}  "
            f"старт.PP={mechanics['start_pp']}  PP/2мин={mechanics['pp_rate']}")
    else:
        log("[setup] механики игрока: случайные (боты — тоже случайные)")
    for slot in sorted(handicaps):
        log(f"[setup] фора слота {slot}: {handicaps[slot]}%")

    # Lock the user's physical input for the ENTIRE run — from here until the
    # very end. Ctrl+Alt+Del still works (emergency exit).
    locked = False
    if lock_input:
        locked = input_lock.lock()
        if locked:
            log("[lock] user input blocked (for the whole run)")
        else:
            log("[lock] WARNING: lock() returned False — input NOT blocked")
    else:
        log("[lock] input lock DISABLED")

    try:
        # 0. Если игра уже открыта — закрываем ПЕРЕД записью настроек и
        #    генерацией спавн-патча (иначе открытая игра может держать файлы
        #    и при следующем запуске стартует вторая копия).
        if launcher.is_game_running():
            log("[check] игра уже запущена — закрываю...")
            if not launcher.stop_game():
                log("ERROR: не удалось закрыть уже запущенную игру",
                    file=sys.stderr)
                return 1
        else:
            log("[check] игра не запущена")

        # 0. prepare network settings BEFORE launch — the game reads
        #    NetworkPref.ini on startup (rules + player faction + color).
        settings = network_prefs.settings_for_faction(cfg.get("network_rules"), faction)
        if settings:
            network_prefs.apply_settings(settings)

        # 0b. сгенерировать спавн-патч «WOTR Generated Presets» (до запуска):
        #     новые механики (золото/ОК/огонь/PP) + стартовая армия.
        #     Файл создаётся ВСЕГДА: механики есть у каждого участника
        #     (у игрока — из опроса, у ботов — случайные).
        spawn_path = cfg.get("spawn_big", spawn.SPAWN_BIG_DEFAULT)
        # factions_by_slot: слот 0 = игрок, слоты 2..N = боты.
        factions_by_slot = {0: faction, **bot_factions}
        ok, info = spawn.generate_spawn_big(
            spawn_path, factions_by_slot, army,
            player_heroes=heroes, ring_heroes=ring_heroes,
            player_mechanics=mechanics)
        if ok:
            log(f"[spawn] спавн-патч создан: {spawn_path}")
        else:
            log(f"[spawn] ОШИБКА генерации: {info}", file=sys.stderr)
            return 1

        # 1. find & launch
        exe = launcher.discover_exe(args.exe or cfg.get("exe_path"))
        if not exe:
            log("ERROR: game not found — use --exe or config/config.json", file=sys.stderr)
            return 1
        log(f"[found] {exe}")

        launch_args = args.args if args.args is not None else cfg.get("args", [])
        try:
            launcher.launch_game(exe, launch_args, elevate=args.elevated
                                 or cfg.get("elevated", False))
        except (OSError, FileNotFoundError) as e:
            log(f"ERROR: launch failed: {e}", file=sys.stderr)
            return 1

        # 2. wait for the window
        log(f"[wait] for game window (up to {T['window_timeout']:.0f}s)...")
        hwnd, how = wait_for_window(T["window_timeout"])
        if not hwnd:
            log("ERROR: game window never appeared", file=sys.stderr)
            return 1
        log(f"[window] found via {how}")

        # 3. ждём готовность главного меню.
        #    Основной механизм — ВИЗУАЛЬНЫЙ детект по маркеру (треугольник над
        #    кнопкой «Сеть», снят через calibrate F8): ждём, пока маркер
        #    появится на кадре. Работает одинаково в холодном и тёплом запуске.
        #    Если маркера нет — откат на фиксированный таймер menu_load.
        marker, marker_meta = visual_ready.load_marker(
            os.path.join(config.CONFIG_DIR, "menu_marker.npy"),
            os.path.join(config.CONFIG_DIR, "menu_marker.json"))

        if marker is not None:
            log("[wait] визуальный детект меню (по маркеру)...")
            if visual_ready.wait_ready(
                    marker, marker_meta,
                    poll=T["menu_poll"],
                    timeout=T["menu_timeout"]):
                log("[wait] маркер найден — меню готово")
            else:
                log(f"ERROR: маркер не найден за {T['menu_timeout']:.0f}s — "
                      f"вероятно, игра не запустилась (краш / зависание)",
                      file=sys.stderr)
                return 1
        else:
            log(f"[wait] маркера нет — пауза {T['menu_load']:.0f}s (заставки)...")
            time.sleep(T["menu_load"])

        # 3b. Прогреть ввод: вывести окно игры на передний план и дать игре
        #     ~menu_settle c, чтобы ПЕРВЫЙ move/click не ушёл «в пустоту».
        #     Особенно важно при холодном запуске: окно (game.dat) появляется,
        #     но ещё ~0.5-1 c не принимает инжектируемый SendInput.
        nav.activate_window(hwnd)
        time.sleep(T["menu_settle"])

        # 4. Network -> Local Network
        log("[nav] Сеть -> Лок. сеть")
        if not menu.goto_lan():
            return 1

        # 4b. ВЕРИФИКАЦИЯ: мы должны оказаться на экране «Лок. сеть».
        #     При холодном старте клики могут уйти «в пустоту» (игра ещё не
        #     принимала ввод) — тогда мы всё ещё в главном меню. Проверяем по
        #     маркеру-картинке; если маркер не найден за пару секунд —
        #     повторяем «Сеть»->«Лок. сеть» и сверяемся снова.
        lan_marker = visual_ready.load_marker_image(LAN_MARKER_PATH)
        if lan_marker is not None:
            if _ensure_lan_screen(lan_marker, marker, marker_meta):
                log("[lan] экран «Лок. сеть» подтверждён маркером")
            else:
                log("ERROR: маркер «Лок. сеть» не найден — экран не загрузился "
                    "(клики не попали по кнопкам)", file=sys.stderr)
                return 1
        else:
            log(f"[lan] маркер «Лок. сеть» не задан ({LAN_MARKER_PATH}) — "
                f"жду по таймеру {T['lobby_load']:.0f}с")
            time.sleep(T["lobby_load"])

        if args.stop_at == "lan":
            log("[done] reached LAN screen")
            return 0

        # 5. wait for the lobby, then Create Game
        log(f"[wait] lobby load ({T['lobby_load']:.0f}s)...")
        time.sleep(T["lobby_load"])
        log("[nav] Создать игру")
        if not menu.goto_create_game():
            return 1

        # 6. wait for the room, then configure everything (column by column)
        log(f"[wait] комната load ({T['room_load']:.0f}s)...")
        time.sleep(T["room_load"])

        log("[room] настраиваю комнату (сложность -> фракции -> союзы -> цвета)...")
        if not room.configure_room(faction, color_name, bot_factions, difficulty):
            return 1

        # 6b. фора по слотам (если задана)
        if handicaps:
            log("[room] выставляю фору...")
            for slot in sorted(handicaps):
                if not room.set_handicap(slot, handicaps[slot]):
                    return 1

        # 7. назначить стартовые позиции на карте
        if slot_positions:
            log(f"[room] назначаю стартовые позиции на карте «{map_info['name']}» "
                f"({len(slot_positions)} слотов)...")
            if not room.assign_start_positions(slot_positions, fortress_owner=fortress_owner):
                return 1

        # 8. Начать игру (после клика идёт 5-сек отсчёт; ввод остаётся
        #    заблокированным, чтобы нельзя было отменить старт вручную).
        log("[room] Начать игру")
        if not room.start_game():
            return 1
        log(f"[wait] отсчёт старта ({T['start_countdown']:.0f}s, ввод заблокирован)...")
        time.sleep(T["start_countdown"])

        log("[done] бой запущен")

        # Во время БОЯ ввод разблокируем (пользователь не заперт на всё
        # ожидание результата). Но как только детектор УВИДИТ экран статистики
        # (fortress_icon + score_marker), ввод снова блокируется на время
        # кликов по вкладкам/слотам (см. monitor_match_result / _lock_for_stats).
        if locked:
            input_lock.unlock()
            locked = False
            log("[lock] user input unblocked (battle starts)")

        # 9. Определить команду-победителя по экрану статистики.
        #    Список игроков: цвета/команды каждого слота известны заранее.
        md_cfg = cfg.get("match_detector", {}) or {}
        monitor = args.monitor if args.monitor is not None \
            else md_cfg.get("monitor", False)
        if monitor:
            players = match_players.player_list(faction, bot_factions)
            log(f"[match] игроков: {len(players)} (слоты "
                f"{[p['slot'] for p in players]})")
            result = monitor_match_result(players, md_cfg, lock_input=lock_input)
            # The match-result monitor is the terminal step of the normal
            # automation flow.  Do not continue into any post-match/menu loop
            # after a result has been written.
            log("[done] результат матча обработан; программа остановлена")
            return 0
        log("[match] определение результата отключено (--no-monitor / config)")
        return 0
    finally:
        if locked:
            input_lock.unlock()
            log("[lock] user input unblocked")


if __name__ == "__main__":
    sys.exit(main())
