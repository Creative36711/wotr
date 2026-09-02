#!/usr/bin/env python3
"""
Комната создания игры: таблица слотов и выпадающие списки.

Раскладка — таблица из 8 строк (слотов) × 4 колонки (слева направо):

    слот | сложность | фракция | союз | цвет
    X:       0.177      0.383    0.685  0.744   (доля ширины окна)

Слот 1 — всегда игрок. Его фракция и цвет задаются через NetworkPref.ini ДО
запуска; союз слота 1 НЕ ставится автоматически — его тоже задаём здесь.
Слоты 2..8 — боты, настраиваются полностью здесь.

Выпадающие списки (фракция / союз / цвет) имеют ОДИНАКОВУЮ геометрию:
  * раскрываются ВНИЗ от строки;
  * зазор от строки до первой строки списка GAP = 0.033;
  * шаг строки списка STEP = 0.029;
  * видимых строк = max(4, 9 − слот) — убывает вниз, минимум 4;
  * первая строка списка — «Случайно» (не выбираем);
  * длинные списки прокручиваются ТОЧНО на нужное число строк (см. _pick_dropdown).

Сложность — отдельный список из 4 пунктов (без «Случайно», без прокрутки).

Механика цвета: цвет игрока исчезает из списков ботов. Цвета, занятые ботами,
остаются в списке, но клик по занятому цвету ОТБЕРЁТ его у прежнего владельца.
Поэтому при коллизии (две фракции одного цвета) назначаем свободный цвет.

РАСШИРЕНИЕ:
  * Новая фракция -> FACTION_ORDER + FACTION_NAMES + FACTION_COLORS (network_prefs)
    + FACTION_ALLIANCES.
  * Новый цвет    -> COLOR_ORDER + COLOR_NAMES.
  Геометрия при этом не меняется.
"""

import sys
import time

from bridge.log import log
from bridge import navigate as nav
from bridge import network_prefs
from bridge import timings

T = timings.TIMINGS

# ---------------------------------------------------------------------------
# Слоты (Y-позиция строки, доля высоты окна)
# ---------------------------------------------------------------------------
SLOT_Y = [
    0.5569,   # 1 — игрок (в комнате: союз + фора)
    0.5919,   # 2
    0.6289,   # 3
    0.6644,   # 4
    0.6989,   # 5
    0.7334,   # 6
    0.7678,   # 7
    0.8033,   # 8
]

# ---------------------------------------------------------------------------
# Колонки (X, доля ширины окна)
# ---------------------------------------------------------------------------
COL_DIFFICULTY = 0.177
COL_FACTION = 0.383
COL_ALLIANCE = 0.685
COL_COLOR = 0.744

# Кнопка «Начать игру» (доля окна).
START_BUTTON = (0.8836, 0.9542)

# ---------------------------------------------------------------------------
# Фора (handicap). Колонка по слотам 1..8 (включая игрока), как союзы.
# ---------------------------------------------------------------------------
# X-координата колонки форы (доля ширины окна).
HANDICAP_X = 0.8031

# Значения форы: 0% (по умолчанию) и далее -5% .. -95% с шагом -5%.
HANDICAP_VALUES = [0, -5, -10, -15, -20, -25, -30, -35, -40, -45,
                   -50, -55, -60, -65, -70, -75, -80, -85, -90, -95]

# Шаг строки списка форы (чуть больше, чем у фракций/цветов — из замеров).
HANDICAP_STEP = 0.0305


def handicap_visible_rows(slot):
    """Сколько значений форы видно сразу (без «Случайно», первая строка = 0%).

    Та же закономерность, что у фракций: список обрезается низом панели,
    видимых строк = max(4, 9 − слот). Слот 1 -> 8, слот 4 -> 5, слот 8 -> 4.
    """
    return max(4, 9 - slot)

# ---------------------------------------------------------------------------
# Сложность (4 пункта, без прокрутки)
# ---------------------------------------------------------------------------
DIFFICULTY_NAMES = ["Новобранец", "Воитель", "Ветеран", "Убийца"]
DIFF_OFFSETS = [0.0865, 0.1160, 0.1439, 0.1713]  # Y-смещение пунктов от строки

# ---------------------------------------------------------------------------
# Фракции (порядок выпадающего списка; первая строка списка — «Случайная»)
# ---------------------------------------------------------------------------
FACTION_ORDER = ["men", "elves", "dwarves", "isengard", "mordor", "goblins", "angmar"]
FACTION_NAMES = {
    "men": "Люди", "elves": "Эльфы", "dwarves": "Гномы", "isengard": "Изенгард",
    "mordor": "Мордор", "goblins": "Гоблины", "angmar": "Ангмар",
}

# ---------------------------------------------------------------------------
# Союзы (1 = войска света, 2 = войска тьмы)
# ---------------------------------------------------------------------------
ALLIANCE_ORDER = ["good", "evil"]
ALLIANCE_NAMES = {"good": "Свет", "evil": "Тьма"}
FACTION_ALLIANCES = {
    "men": "good", "elves": "good", "dwarves": "good",           # свет
    "isengard": "evil", "mordor": "evil", "goblins": "evil",     # тьма
    "angmar": "evil",
}

# ---------------------------------------------------------------------------
# Цвета (порядок = коду цвета: синий=0, красный=1, ... белый=9)
# ---------------------------------------------------------------------------
COLOR_ORDER = ["blue", "red", "yellow", "green", "orange",
               "light_blue", "purple", "pink", "black", "white"]
COLOR_NAMES = {
    "blue": "Синий", "red": "Красный", "yellow": "Жёлтый", "green": "Зелёный",
    "orange": "Оранжевый", "light_blue": "Голубой", "purple": "Фиолетовый",
    "pink": "Розовый", "black": "Чёрный", "white": "Белый",
}

# ---------------------------------------------------------------------------
# Геометрия выпадающих списков (фракция / союз / цвет)
# ---------------------------------------------------------------------------
DROP_STEP = 0.029          # шаг строки списка
DROP_GAP = 0.033           # зазор от строки слота до первой строки списка
SCROLL_MOVE_OFFSET = 0.05  # смещение мыши внутрь списка перед прокруткой
# 1 щелчок колеса = 1 строка списка (предположение; проверено на фракциях).
WHEEL_ROWS_PER_NOTCH = 1


# ===========================================================================
# Сложность
# ===========================================================================
def set_slot_difficulty(slot, diff_index):
    vp = nav.viewport()
    if not vp:
        log("[room] окно игры не найдено", file=sys.stderr)
        return False
    l, t, W, H = vp
    fx = l + int(COL_DIFFICULTY * W)
    fy = t + int(SLOT_Y[slot - 1] * H)
    nav.click(fx, fy)
    time.sleep(T["room_dropdown"])
    nav.click(fx, t + int((SLOT_Y[slot - 1] + DIFF_OFFSETS[diff_index]) * H))
    time.sleep(T["room_settle"])
    log(f"[room] слот {slot}: сложность = {DIFFICULTY_NAMES[diff_index]}")
    return True


# ===========================================================================
# Универсальный выбор из выпадающего списка (фракция / союз / цвет)
# ===========================================================================
def _pick_dropdown(slot, col_x, item_index, item_count, label):
    """Открыть ячейку (slot, col_x) и кликнуть пункт item_index (0-based).

    item_count — число РЕАЛЬНЫХ пунктов (первая строка списка — «Случайно»,
    её не выбираем). Пункт в видимой части кликается сразу; иначе список
    прокручивается ТОЧНО так, чтобы пункт оказался на нижней видимой строке
    (иначе длинный список проскроллится мимо средних пунктов).
    """
    visible_rows = max(4, 9 - slot)    # видимых строк (включая «Случайно»)
    visible_items = visible_rows - 1   # видимых реальных пунктов
    vp = nav.viewport()
    if not vp:
        log("[room] окно игры не найдено", file=sys.stderr)
        return False
    l, t, W, H = vp
    fx = l + int(col_x * W)
    selector_y = t + int(SLOT_Y[slot - 1] * H)
    list_top = SLOT_Y[slot - 1] + DROP_GAP  # позиция строки «Случайно»

    # 1. раскрыть список
    nav.click(fx, selector_y)
    time.sleep(T["room_dropdown"])

    if item_index < visible_items:
        # прямой клик: реальный пункт i лежит на строке (i + 1)
        fy = list_top + (item_index + 1) * DROP_STEP
    else:
        # 2. мышь внутрь списка — иначе колесо ЗАКРОЕТ выпадающий список
        nav.move(fx, selector_y + int(SCROLL_MOVE_OFFSET * H))
        time.sleep(0.1)
        # 3. прокрутить ТОЧНО: целевой пункт -> нижняя видимая строка
        notches = (item_index - visible_items + 1) * WHEEL_ROWS_PER_NOTCH
        for _ in range(max(0, notches)):
            nav.scroll(-1)
        time.sleep(0.2)
        # 4. целевой пункт теперь на нижней строке списка
        fy = list_top + (visible_rows - 1) * DROP_STEP

    nav.click(fx, t + int(fy * H))
    time.sleep(T["room_settle"])
    log(f"[room] слот {slot}: {label}")
    return True


# ===========================================================================
# Фракция / союз / цвет
# ===========================================================================
def set_slot_faction(slot, faction):
    if faction not in FACTION_ORDER:
        log(f"[room] неизвестная фракция: {faction}", file=sys.stderr)
        return False
    idx = FACTION_ORDER.index(faction)
    return _pick_dropdown(slot, COL_FACTION, idx, len(FACTION_ORDER),
                          f"фракция = {FACTION_NAMES[faction]}")


def set_slot_alliance(slot, alliance):
    if alliance not in ALLIANCE_ORDER:
        log(f"[room] неизвестный союз: {alliance}", file=sys.stderr)
        return False
    idx = ALLIANCE_ORDER.index(alliance)
    return _pick_dropdown(slot, COL_ALLIANCE, idx, len(ALLIANCE_ORDER),
                          f"союз = {ALLIANCE_NAMES[alliance]}")


def set_slot_color(slot, color, excluded):
    """Выбрать цвет слоту. excluded — цвета, исключённые из списка (только
    цвет игрока: именно он пропадает из списков ботов)."""
    if color not in COLOR_ORDER:
        log(f"[room] неизвестный цвет: {color}", file=sys.stderr)
        return False
    avail = [c for c in COLOR_ORDER if c not in excluded]
    if color not in avail:
        return False
    idx = avail.index(color)
    return _pick_dropdown(slot, COL_COLOR, idx, len(avail),
                          f"цвет = {COLOR_NAMES[color]}")


# ===========================================================================
# Стартовые позиции на карте (оборона / атака)
# ===========================================================================
def assign_start_position(slot, frac_pos, clicks=1):
    """Назначить стартовую позицию слоту: кликнуть точку карты `clicks` раз (по умолчанию 1).

    frac_pos — (fx, fy) доля окна.
    """
    vp = nav.viewport()
    if not vp:
        log("[room] окно игры не найдено", file=sys.stderr)
        return False
    l, t, W, H = vp
    x = l + int(frac_pos[0] * W)
    y = t + int(frac_pos[1] * H)
    for _ in range(clicks):
        nav.click(x, y)
        if clicks > 1:
            time.sleep(T["start_pos_click"])
    time.sleep(T["start_pos_click"])
    log(f"[room] стартовая позиция назначена слоту {slot} (кликов: {clicks}, pos={frac_pos})")
    return True


def assign_start_positions(slot_positions, fortress_owner=None):
    """Назначить стартовые позиции слотам на миникарте.

    slot_positions — dict {slot: (fx, fy)}.
    fortress_owner — номер слота владельца крепости (или None).

    Механика:
      - Если задан fortress_owner: назначаем его первым, делая N кликов
        (N = номер слота), чтобы именно он встал на главную точку крепости.
        Затем все остальные слоты назначаются по возрастанию номеров (1, 2, 3, ...)
        ровно по 1 клику на точку (игра автоматически подставляет следующий свободный слот).
      - Если fortress_owner не задан: все слоты назначаются по возрастанию номеров
        (1, 2, 3, ...) ровно по 1 клику на каждую позицию.
    """
    if fortress_owner and fortress_owner in slot_positions:
        # 1. Владелец крепости кликается первым: N кликов на его координату
        owner_pos = slot_positions[fortress_owner]
        if not assign_start_position(fortress_owner, owner_pos, clicks=fortress_owner):
            return False

        # 2. Все остальные слоты — по возрастанию, по 1 клику
        other_slots = sorted(s for s in slot_positions.keys() if s != fortress_owner)
        for slot in other_slots:
            pos = slot_positions[slot]
            if not assign_start_position(slot, pos, clicks=1):
                return False
        return True

    # Обычная карта (без крепости) — все слоты по 1 клику по возрастанию
    for slot in sorted(slot_positions.keys()):
        pos = slot_positions[slot]
        if not assign_start_position(slot, pos, clicks=1):
            return False
    return True


def start_game():
    """Нажать кнопку «Начать игру» (после неё идёт 5-секундный отсчёт)."""
    vp = nav.viewport()
    if not vp:
        log("[room] окно игры не найдено", file=sys.stderr)
        return False
    l, t, W, H = vp
    x = l + int(START_BUTTON[0] * W)
    y = t + int(START_BUTTON[1] * H)
    nav.click(x, y)
    log("[room] нажал «Начать игру»")
    return True


# ===========================================================================
# Фора (handicap)
# ===========================================================================
def handicap_index(percent):
    """Индекс значения форы в списке (0 = 0%, 1 = -5%, ... 19 = -95%)."""
    if percent > 0 or percent < -95:
        return None
    idx = round(abs(percent) / 5)
    if 0 <= idx <= 19:
        return idx
    return None


def set_handicap(slot, percent):
    """Выставить фору слоту (1..8, включая игрока).

    percent — отрицательное число или 0 (например, -15). 0 = по умолчанию,
    слот пропускаем. Список форы: 20 значений, первая строка = 0% (без «случайно»).
    """
    idx = handicap_index(percent)
    if idx is None:
        log(f"[room] некорректная фора: {percent}%", file=sys.stderr)
        return False
    if idx == 0:
        return True  # 0% уже по умолчанию — слот пропускаем

    vp = nav.viewport()
    if not vp:
        log("[room] окно игры не найдено", file=sys.stderr)
        return False
    l, t, W, H = vp
    fx = l + int(HANDICAP_X * W)
    fy = t + int(SLOT_Y[slot - 1] * H)
    list_top = SLOT_Y[slot - 1] + DROP_GAP  # первая строка (0%)

    # 1. открыть список форы
    nav.click(fx, fy)
    time.sleep(T["room_dropdown"])

    visible = handicap_visible_rows(slot)
    if idx < visible:
        # прямой клик: значение idx на строке idx (без «случайно»)
        cy = list_top + idx * HANDICAP_STEP
    else:
        # мышь внутрь списка, прокрутить точно, кликнуть нижнюю видимую строку
        nav.move(fx, fy + int(SCROLL_MOVE_OFFSET * H))
        time.sleep(0.1)
        notches = idx - visible + 1
        for _ in range(notches):
            nav.scroll(-1)
        time.sleep(0.2)
        cy = list_top + (visible - 1) * HANDICAP_STEP

    nav.click(fx, t + int(cy * H))
    time.sleep(T["room_settle"])
    log(f"[room] слот {slot}: фора = {HANDICAP_VALUES[idx]}%")
    return True


# ===========================================================================
# Полная настройка комнаты (по столбцам)
# ===========================================================================
def configure_room(player_faction, player_color, bot_factions, difficulty):
    """Настроить комнату полностью: сложность, фракции, союзы, цвета.

    player_faction / player_color — фракция и цвет игрока (слот 1).
    bot_factions — dict {slot: faction_key} для слотов 2..N.
    difficulty — 0-based индекс сложности ботов.

    Порядок (по столбцам, как в UI): сложность -> фракция -> союз -> цвет.
    """
    slots = sorted(bot_factions.keys())

    # 1. сложность (боты)
    for slot in slots:
        if not set_slot_difficulty(slot, difficulty):
            return False

    # 2. фракции (боты)
    for slot in slots:
        if not set_slot_faction(slot, bot_factions[slot]):
            return False

    # 3. союзы (игрок + боты)
    pa = FACTION_ALLIANCES.get(player_faction)
    if pa and not set_slot_alliance(1, pa):
        return False
    for slot in slots:
        a = FACTION_ALLIANCES.get(bot_factions[slot])
        if a and not set_slot_alliance(slot, a):
            return False

    # 4. цвета (боты). Повторная фракция -> цвет уже занят, оставляем
    #    «Случайный»: игра сама подставит свободный цвет.
    excluded = {player_color} if player_color else set()
    used = set(excluded)
    for slot in slots:
        color = network_prefs.FACTION_COLORS.get(bot_factions[slot])
        if not color:
            continue
        if color in used:
            log(f"[room] слот {slot}: цвет {COLOR_NAMES[color]} занят — "
                  f"оставляю «Случайный»")
            continue
        if not set_slot_color(slot, color, excluded):
            return False
        used.add(color)
    return True
