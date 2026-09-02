#!/usr/bin/env python3
"""
Калибратор карт и координат для BFME2: RotWK.

Интерактивно спрашивает параметры карты (название и тип: крепость/обычная),
запускает игру в оконном режиме и пошагово ведёт пользователя по точкам:

  - Обычная карта: 4 позиции обороны + 4 позиции атаки (F9 для каждой точки);
  - Крепость: 1-я ГЛАВНАЯ позиция (владелец крепости, управление воротами)
              + 3 позиции обороны + 4 позиции атаки.

После снятия всех 8 точек карта автоматически сохраняется в config/maps.json
и сразу становится доступна при запуске main.py.

Горячие клавиши:
    F8  — захватить маркер готовности меню (config/menu_marker.npy/.json)
    F9  — снять координату текущей точки (шаги 1..8)
    F10 — выход / отмена

Запуск:
    python tools/calibrate.py
    python tools/calibrate.py --attach    (если игра уже запущена)
"""

import argparse
import json
import os
import re
import sys
import time
import traceback

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

ID_MARKER = 1
ID_CAPTURE = 2
ID_QUIT = 3

CAL_RESOLUTION = "1280 720"  # разрешение на время калибровки
RESTORE_AFTER = 5.0          # через сколько секунд после запуска вернуть прежнее
WINDOW_TIMEOUT = 120.0       # сколько ждать появления окна игры
MARKER_SIZE_FRAC = 0.03

# Модули «моста» подключаются лениво (они Windows-only) — см. _load_bridge().
config = elevate = launcher = nav = options_ini = network_prefs = hotkey = maps = None

MARKER_NPY = MARKER_JSON = COORDS_FILE = LOG_FILE = None
_LOG_READY = False

# Состояние мастера калибровки
_MAP_INFO = None
_STEPS = []
_CAPTURED_COORDS = []


def _say(msg=""):
    """Печать в консоль с одновременной записью в лог-файл."""
    print(msg)
    if not _LOG_READY:
        return
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"{msg}\n")
    except OSError:
        pass


def _start_log():
    global LOG_FILE, _LOG_READY
    try:
        LOG_FILE = os.path.join(config.BASE_DIR, "calibrate_log.txt")
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"\n=== {time.strftime('%Y-%m-%d %H:%M:%S')} ===\n")
        _LOG_READY = True
    except OSError:
        _LOG_READY = False


def _require_windows():
    if os.name != "nt":
        raise SystemExit("[cal] Калибровка работает только под Windows "
                         "(нужны Win32 API: окно игры, SendInput, BitBlt).")


def _load_bridge():
    global config, elevate, launcher, nav, options_ini, network_prefs, hotkey, maps
    global MARKER_NPY, MARKER_JSON, COORDS_FILE

    from bridge import config as _config
    from bridge import elevate as _elevate
    from bridge import launcher as _launcher
    from bridge import maps as _maps
    from bridge import navigate as _nav
    from bridge import network_prefs as _network_prefs
    from bridge import options_ini as _options_ini
    from tools import hotkey as _hotkey

    config, elevate, launcher, maps = _config, _elevate, _launcher, _maps
    nav, options_ini, network_prefs, hotkey = (_nav, _options_ini,
                                               _network_prefs, _hotkey)

    config.ensure_config_dir()
    MARKER_NPY = os.path.join(config.CONFIG_DIR, "menu_marker.npy")
    MARKER_JSON = os.path.join(config.CONFIG_DIR, "menu_marker.json")
    COORDS_FILE = os.path.join(config.CONFIG_DIR, "calibrate_coords.txt")


def _require_numpy():
    try:
        import numpy  # noqa: F401
        return True
    except ImportError:
        _say("[cal] НЕ УСТАНОВЛЕН numpy — без него маркер (F8) сохранить нельзя.")
        _say("[cal]   Установи:  python -m pip install numpy")
        return False


def _make_key(name):
    """Генерирует латинский slug/key из названия карты."""
    translit = {
        'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
        'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
        'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
        'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
        'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya', ' ': '_'
    }
    s = str(name).strip().lower()
    res = []
    for ch in s:
        if ch in translit:
            res.append(translit[ch])
        elif ch.isalnum() or ch == '_':
            res.append(ch)
        else:
            res.append('_')
    key = re.sub(r'_+', '_', ''.join(res)).strip('_')
    return key or "custom_map"


def ask_map_setup(args):
    """Интерактивный опрос: какая карта калибруется (название + тип)."""
    if args.free:
        return None

    _say("=" * 60)
    _say("Мастер калибровки новой карты BFME2: RotWK")
    _say("=" * 60)

    # 1. Название карты
    if args.map_name:
        map_name = args.map_name
        _say(f"Название карты: {map_name}")
    else:
        while True:
            map_name = input("Название карты (например: Хельмова Падь) > ").strip()
            if map_name:
                break
            print("  Введите название карты.")

    key = _make_key(map_name)

    # 2. Системное имя карты (map mp ...)
    if args.sys_name:
        sys_name = args.sys_name
    else:
        default_sys = f"map mp {key}"
        try:
            s = input(f"Системное имя карты в игре (по умолчанию '{default_sys}') > ").strip()
        except (EOFError, KeyboardInterrupt):
            s = ""
        sys_name = s if s else default_sys

    # 3. Крепость или обычная карта
    if args.fortress is not None:
        is_fortress = bool(args.fortress)
    else:
        _say("Это карта-крепость или обычная карта?")
        _say("  1. Крепость (есть цитадель/стены/ворота)")
        _say("  2. Обычная карта")
        while True:
            s = input("> ").strip().lower()
            if s in ("1", "крепость", "в крепости", "fortress", "да", "yes"):
                is_fortress = True
                break
            if s in ("2", "обычная", "обычная карта", "normal", "нет", "no"):
                is_fortress = False
                break
            _say("  Введите 1 (крепость) или 2 (обычная).")

    return {
        "key": key,
        "name": map_name,
        "map_name": sys_name,
        "is_fortress": is_fortress,
    }


def get_calibration_steps(is_fortress):
    if is_fortress:
        return [
            "[1/8] ВНИМАНИЕ: Наведите курсор на ГЛАВНУЮ позицию владельца крепости (управляет воротами) и нажмите F9",
            "[2/8] Наведите курсор на 2-ю позицию ЗАЩИТЫ и нажмите F9",
            "[3/8] Наведите курсор на 3-ю позицию ЗАЩИТЫ и нажмите F9",
            "[4/8] Наведите курсор на 4-ю позицию ЗАЩИТЫ и нажмите F9",
            "[5/8] Наведите курсор на 1-ю позицию АТАКИ (наивысший приоритет) и нажмите F9",
            "[6/8] Наведите курсор на 2-ю позицию АТАКИ и нажмите F9",
            "[7/8] Наведите курсор на 3-ю позицию АТАКИ и нажмите F9",
            "[8/8] Наведите курсор на 4-ю позицию АТАКИ и нажмите F9",
        ]
    else:
        return [
            "[1/8] Наведите курсор на 1-ю позицию ЗАЩИТЫ (наивысший приоритет) и нажмите F9",
            "[2/8] Наведите курсор на 2-ю позицию ЗАЩИТЫ и нажмите F9",
            "[3/8] Наведите курсор на 3-ю позицию ЗАЩИТЫ и нажмите F9",
            "[4/8] Наведите курсор на 4-ю позицию ЗАЩИТЫ и нажмите F9",
            "[5/8] Наведите курсор на 1-ю позицию АТАКИ (наивысший приоритет) и нажмите F9",
            "[6/8] Наведите курсор на 2-ю позицию АТАКИ и нажмите F9",
            "[7/8] Наведите курсор на 3-ю позицию АТАКИ и нажмите F9",
            "[8/8] Наведите курсор на 4-ю позицию АТАКИ и нажмите F9",
        ]


# ---------------------------------------------------------------------------
# Действия по горячим клавишам
# ---------------------------------------------------------------------------
def _window_box():
    """(hwnd, left, top, W, H) клиентской области окна игры или None."""
    hwnd, _ = nav.find_game_window()
    pos = nav.get_cursor_pos()
    if not hwnd or not pos:
        _say("[cal] окно/курсор недоступны (игра закрыта?)")
        return None
    l, t, r, b = nav.get_client_rect(hwnd)
    return hwnd, l, t, r - l, b - t


def capture_coord():
    """Снять координату курсора (доля окна), сохранить шаг мастера и дописать в лог."""
    global _CAPTURED_COORDS
    box = _window_box()
    if not box:
        return
    _hwnd, l, t, W, H = box
    pos = nav.get_cursor_pos()
    fx = (pos[0] - l) / W
    fy = (pos[1] - t) / H
    pt = (round(fx, 4), round(fy, 4))
    line = f"[cal] frac=({fx:.4f}, {fy:.4f})   px=({pos[0]},{pos[1]})"
    _say(line)

    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    entry = (f"{stamp}  frac=({fx:.4f}, {fy:.4f})  px=({pos[0]},{pos[1]})"
             f"  ->  [{fx:.4f}, {fy:.4f}],\n")
    try:
        with open(COORDS_FILE, "a", encoding="utf-8") as f:
            f.write(entry)
    except OSError as e:
        _say(f"[cal] не удалось записать {COORDS_FILE}: {e}")

    if _MAP_INFO and _STEPS:
        _CAPTURED_COORDS.append(pt)
        idx = len(_CAPTURED_COORDS)
        _say(f"[cal]   -> Зафиксирована точка {idx}/8: {pt}")

        if idx < len(_STEPS):
            _say()
            _say(f"[cal] СЛЕДУЮЩИЙ ШАГ:")
            _say(f"  {_STEPS[idx]}")
        else:
            # Все 8 точек собраны! Сохраняем в config/maps.json
            def_pos = _CAPTURED_COORDS[:4]
            atk_pos = _CAPTURED_COORDS[4:8]
            map_data = {
                "name": _MAP_INFO["name"],
                "map_name": _MAP_INFO["map_name"],
                "is_fortress": _MAP_INFO["is_fortress"],
                "defense_positions": def_pos,
                "attack_positions": atk_pos,
            }
            maps.save_map(_MAP_INFO["key"], map_data)
            _say()
            _say("=" * 64)
            _say(f"[cal] ВСЕ 8 ТОЧЕК УСПЕШНО СНЯТЫ И СОХРАНЕНЫ!")
            _say(f"[cal] Карта: «{_MAP_INFO['name']}» ({_MAP_INFO['map_name']})")
            _say(f"[cal] Тип:   {'КРЕПОСТЬ' if _MAP_INFO['is_fortress'] else 'Обычная карта'}")
            _say(f"[cal] Позиции обороны (4): {def_pos}")
            _say(f"[cal] Позиции атаки   (4): {atk_pos}")
            _say(f"[cal] Сохранено в config/maps.json.")
            _say(f"[cal] Карта сразу готова к использованию в main.py!")
            _say("=" * 64)
            hotkey.post_quit()


def capture_marker(marker_frac=MARKER_SIZE_FRAC):
    """Захватить маркер готовности вокруг курсора (и сохранить позицию в долях)."""
    box = _window_box()
    if not box:
        return
    _hwnd, l, t, W, H = box
    pos = nav.get_cursor_pos()
    fx = (pos[0] - l) / W
    fy = (pos[1] - t) / H
    size = max(8, int(min(W, H) * marker_frac))

    nav.move(l + 10, t + 10)
    time.sleep(0.3)

    arr = nav.capture_region(pos[0] - size // 2, pos[1] - size // 2, size, size)
    if arr is None:
        _say("[cal] не удалось захватить область экрана")
        _require_numpy()
        return

    try:
        import numpy as np
        np.save(MARKER_NPY, arr)
    except ImportError:
        _require_numpy()
        return

    with open(MARKER_JSON, "w", encoding="utf-8") as f:
        json.dump({"fx": fx, "fy": fy, "size_frac": marker_frac}, f, indent=2)
    _say(f"[cal] маркер сохранён: {MARKER_NPY} + {MARKER_JSON}")
    _say(f"[cal]   позиция=({fx:.4f},{fy:.4f})  размер={size}px")


# ---------------------------------------------------------------------------
# Запуск игры и ожидание окна
# ---------------------------------------------------------------------------
def _wait_window(timeout=WINDOW_TIMEOUT):
    _say("[cal] жду окно игры...")
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        hwnd, how = nav.find_game_window()
        if hwnd:
            _say(f"[cal] окно найдено ({how})")
            return hwnd
        time.sleep(0.5)
    return None


def _launch_game(args):
    """Найти exe, временно снизить разрешение, запустить в окне. True = окно есть."""
    exe = launcher.discover_exe(args.exe or config.load_config().get("exe_path"))
    if not exe:
        _say("ОШИБКА: игра не найдена.")
        _say(f"  Проверь путь в {config.CONFIG_FILE}")
        _say('  (формат: {"exe_path": "C:\\\\RotWK\\\\lotrbfme2ep1.exe"})')
        _say("  Или запусти с ключом:  --exe \"путь\\к\\lotrbfme2ep1.exe\"")
        return False

    _say(f"[cal] запускаю игру в оконном режиме: {exe.name}")

    old_res = None
    if not args.no_resolution:
        old_res = options_ini.read_option("Resolution")
        if old_res:
            _say(f"[cal] прежнее разрешение: {old_res} -> ставлю {args.resolution}")
            options_ini.set_option("Resolution", args.resolution)
        else:
            _say("[cal] Resolution в Options.ini не найден — пропускаю смену")

    launcher.launch_game(exe, ["-win"])

    if old_res:
        time.sleep(RESTORE_AFTER)
        options_ini.set_option("Resolution", old_res)
        _say(f"[cal] вернул разрешение {old_res}")

    return _wait_window(args.wait) is not None


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def parse_args(argv=None):
    ap = argparse.ArgumentParser(
        prog="calibrate",
        description="Калибровка 8 точек карты (4 оборона + 4 атака) и маркера меню для BFME2: RotWK.")
    ap.add_argument("--exe", help="путь к lotrbfme2ep1.exe / game.dat")
    ap.add_argument("--map-name", help="название карты (пропустить вопрос)")
    ap.add_argument("--sys-name", help="системное имя карты (map mp ...)")
    ap.add_argument("--fortress", dest="fortress", action="store_true", default=None,
                    help="отметить карту как крепость")
    ap.add_argument("--no-fortress", dest="fortress", action="store_false",
                    help="отметить карту как обычную")
    ap.add_argument("--free", action="store_true",
                    help="свободный режим (без мастера 8 точек карты)")
    ap.add_argument("--attach", action="store_true",
                    help="не запускать игру — подключиться к уже открытому окну")
    ap.add_argument("--resolution", default=CAL_RESOLUTION,
                    help=f'разрешение на время калибровки (по умолчанию "{CAL_RESOLUTION}")')
    ap.add_argument("--no-resolution", action="store_true",
                    help="не менять Resolution в Options.ini")
    ap.add_argument("--wait", type=float, default=WINDOW_TIMEOUT,
                    help=f"сколько секунд ждать окно игры (по умолчанию {WINDOW_TIMEOUT:.0f})")
    ap.add_argument("--marker-size", type=float, default=MARKER_SIZE_FRAC,
                    help=f"сторона маркера в долях окна (по умолчанию {MARKER_SIZE_FRAC})")
    ap.add_argument("--no-admin", action="store_true",
                    help="не запрашивать права администратора")
    ap.add_argument("--no-pause", action="store_true",
                    help="не ждать Enter перед закрытием окна")
    return ap.parse_args(argv)


def _pause(enabled=True):
    if not enabled:
        return
    try:
        input("\nНажми Enter для выхода...")
    except (EOFError, KeyboardInterrupt, OSError):
        pass


def main(argv=None):
    global _MAP_INFO, _STEPS, _CAPTURED_COORDS
    args = parse_args(argv)

    _require_windows()
    _load_bridge()
    _start_log()

    _say("[cal] калибровка BFME2: RotWK")
    _say(f"[cal] версия Python: {sys.version.split()[0]}")
    _say(f"[cal] папка данных: {config.CONFIG_DIR}")

    # Интерактивный опрос параметров карты ДО блокировок
    _MAP_INFO = ask_map_setup(args)
    if _MAP_INFO:
        _STEPS = get_calibration_steps(_MAP_INFO["is_fortress"])
        _CAPTURED_COORDS = []

    # APPDATA реального пользователя
    elevate.restore_real_appdata()
    network_prefs.save_real_appdata()

    if args.no_admin:
        _say("[cal] --no-admin: права администратора НЕ запрашиваются")
    else:
        elevate.ensure_admin()

    if not args.attach:
        if not _launch_game(args):
            return 1
    else:
        _say("[cal] --attach: игру не запускаю, ищу уже открытое окно")
        if not _wait_window(args.wait):
            _say("ОШИБКА: окно игры не найдено (запусти игру или увеличь --wait)")
            return 1

    _require_numpy()

    _say("=" * 60)
    _say("F8  — захватить маркер готовности (треугольник над кнопкой)")
    _say("F9  — снять координату текущей точки (шаги 1..8)")
    _say("F10 — выход / отмена")
    _say("=" * 60)

    if _MAP_INFO and _STEPS:
        _say(f"[cal] Начинаем калибровку карты «{_MAP_INFO['name']}» "
             f"({'КРЕПОСТЬ' if _MAP_INFO['is_fortress'] else 'Обычная карта'}):")
        _say(f"  {_STEPS[0]}")
        _say()

    hotkey.register(ID_MARKER, "F8")
    hotkey.register(ID_CAPTURE, "F9")
    hotkey.register(ID_QUIT, "F10")
    hotkey.run_loop({
        ID_MARKER: lambda: capture_marker(args.marker_size),
        ID_CAPTURE: capture_coord,
        ID_QUIT: hotkey.post_quit,
    })
    _say(f"[cal] координаты сохранены в {COORDS_FILE}")
    return 0


def run(argv=None):
    args = parse_args(argv)
    code = 1
    try:
        code = main(argv) or 0
    except SystemExit as e:
        if isinstance(e.code, int):
            code = e.code
        elif e.code:
            _say(str(e.code))
            code = 1
        else:
            code = 0
    except KeyboardInterrupt:
        _say("[cal] прервано пользователем")
    except Exception:
        _say("ОШИБКА калибровки:")
        _say(traceback.format_exc())
    _pause(not args.no_pause)
    return code


if __name__ == "__main__":
    sys.exit(run())
