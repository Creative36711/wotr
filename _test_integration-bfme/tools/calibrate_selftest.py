#!/usr/bin/env python3
"""
Офлайн-самопроверка калибратора и модулей моста.

Не требует ни Windows, ни игры, ни numpy: Win32-модули моста подменяются
заглушками, после чего прогоняется РЕАЛЬНЫЙ код tools/calibrate.py
(поиск окна -> F9 координаты -> сохранение карты -> F8 маркер -> F10 выход).

Запуск:
    python tools/calibrate_selftest.py
"""

import importlib
import json
import os
import shutil
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

FAILURES = []


def check(name, cond, detail=""):
    status = "OK  " if cond else "FAIL"
    print(f"  [{status}] {name}" + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


# ---------------------------------------------------------------------------
# Заглушки Win32-модулей
# ---------------------------------------------------------------------------
class FakePath:
    def __init__(self, path):
        self._p = path
        self.name = os.path.basename(path)

    def __str__(self):
        return self._p


class FakeNav:
    HWND = 0x1234
    CLIENT = (100, 50, 1380, 770)      # -> W=1280, H=720
    CURSOR = (700, 400)                # -> fx=0.46875, fy=0.486111

    def __init__(self):
        self.moves = []
        self.captures = []
        self.visible = True

    def find_game_window(self, require_visible=True):
        if not self.visible:
            return None, None
        return self.HWND, "proc=game.dat"

    def get_cursor_pos(self):
        return self.CURSOR

    def get_client_rect(self, hwnd):
        return self.CLIENT

    def move(self, x, y):
        self.moves.append((x, y))

    def capture_region(self, x, y, w, h):
        self.captures.append((x, y, w, h))
        return [("fake-array", w, h)]


class FakeLauncher:
    def __init__(self, exe="C:\\RotWK\\lotrbfme2ep1.exe"):
        self.exe = exe
        self.launches = []

    def discover_exe(self, explicit=None):
        return FakePath(explicit or self.exe) if (explicit or self.exe) else None

    def launch_game(self, exe, args=None, elevate=False):
        self.launches.append((str(exe), list(args or [])))
        return None


class FakeOptionsIni:
    def __init__(self, current="1920 1080"):
        self.current = current
        self.calls = []

    def read_option(self, key, folder=None, filename=None):
        return self.current if key == "Resolution" else None

    def set_option(self, key, value, folder=None, filename=None):
        self.calls.append((key, value))
        self.current = value
        return "Options.ini"


class FakeHotkey:
    def __init__(self, press=(2, 1, 3)):
        self.press = press          # порядок нажатий: 2=F9, 1=F8, 3=F10
        self.registered = []
        self.quit_posted = 0

    def register(self, id_, key, modifiers=0):
        self.registered.append((id_, key))

    def post_quit(self):
        self.quit_posted += 1

    def run_loop(self, actions):
        for id_ in self.press:
            fn = actions.get(id_)
            if fn:
                fn()


class FakeNumpy:
    def __init__(self):
        self.saved = []

    def save(self, path, arr):
        self.saved.append((path, arr))
        with open(path, "wb") as f:
            f.write(b"\x93NUMPY-FAKE")


def install_fakes(nav, launcher, options_ini, hotkey, numpy):
    """Подменить Windows-модули моста заглушками."""
    import bridge
    import tools

    bridge_mod = sys.modules.setdefault("bridge", bridge)
    tools_mod = sys.modules.setdefault("tools", tools)

    fake_netprefs = type("network_prefs", (), {
        "save_real_appdata": staticmethod(lambda: None),
        "_appdata": staticmethod(lambda: tempfile.gettempdir()),
    })
    fake_elevate = type("elevate", (), {
        "is_admin": staticmethod(lambda: True),
        "ensure_admin": staticmethod(lambda: None),
        "restore_real_appdata": staticmethod(lambda argv=None: None),
    })

    for name, mod in (("navigate", nav), ("launcher", launcher),
                      ("options_ini", options_ini),
                      ("network_prefs", fake_netprefs),
                      ("elevate", fake_elevate)):
        sys.modules[f"bridge.{name}"] = mod
        setattr(bridge_mod, name, mod)
    sys.modules["tools.hotkey"] = hotkey
    setattr(tools_mod, "hotkey", hotkey)
    sys.modules["numpy"] = numpy


# ---------------------------------------------------------------------------
# Тесты
# ---------------------------------------------------------------------------
def test_config_paths():
    print("\n[1] bridge/config.py — пути и загрузка JSON")
    import bridge.config as cfg
    importlib.reload(cfg)

    check("BASE_DIR = корень проекта", os.path.samefile(cfg.BASE_DIR, ROOT), cfg.BASE_DIR)
    check("CONFIG_DIR = <корень>/config", cfg.CONFIG_DIR == os.path.join(ROOT, "config"), cfg.CONFIG_DIR)
    check("MAPS_FILE = <корень>/config/maps.json", cfg.MAPS_FILE == os.path.join(cfg.CONFIG_DIR, "maps.json"))


def test_elevate_command():
    print("\n[2] bridge/elevate.py — команда UAC-перезапуска")
    from bridge import elevate

    saved_appdata = os.environ.get("APPDATA")
    saved_real = os.environ.get("_REAL_APPDATA")
    os.environ["APPDATA"] = "C:\\Users\\user\\AppData\\Roaming"
    exe, params = elevate.elevated_command(argv=["tools\\calibrate.py", "--attach"])
    check("запускается python.exe", exe == sys.executable, exe)
    first = params.split()[0].strip('"')
    check("скрипт передаётся первым аргументом",
          first == os.path.abspath("tools\\calibrate.py"), params)
    check("передан --_real_appdata",
          "--_real_appdata=C:\\Users\\user\\AppData\\Roaming" in params, params)
    check("аргументы пользователя сохранены", "--attach" in params, params)

    for key, value in (("APPDATA", saved_appdata), ("_REAL_APPDATA", saved_real)):
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value


def test_calibrate_flow():
    print("\n[3] tools/calibrate.py — полный цикл мастера калибровки карты (8 точек F9)")
    tmp = tempfile.mkdtemp(prefix="calflow-")
    try:
        import bridge.config as cfg
        cfg.BASE_DIR = tmp
        cfg.CONFIG_DIR = os.path.join(tmp, "config")
        cfg.CONFIG_FILE = os.path.join(cfg.CONFIG_DIR, "config.json")
        cfg.MAPS_FILE = os.path.join(cfg.CONFIG_DIR, "maps.json")
        os.makedirs(cfg.CONFIG_DIR, exist_ok=True)
        with open(cfg.CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump({"exe_path": "C:\\RotWK\\lotrbfme2ep1.exe"}, f)

        # 8 нажатий F9 (захват всех 8 точек) -> 1 нажатие F8 (маркер) -> F10
        press = [2] * 8 + [1, 3]
        nav = FakeNav()
        launcher = FakeLauncher()
        options_ini = FakeOptionsIni()
        hotkey = FakeHotkey(press=press)
        numpy = FakeNumpy()
        install_fakes(nav, launcher, options_ini, hotkey, numpy)

        cal = importlib.import_module("tools.calibrate")
        importlib.reload(cal)
        cal._require_windows = lambda: None
        cal.RESTORE_AFTER = 0.0

        code = cal.run(["--map-name", "Тестовая Крепость", "--fortress", "--no-pause"])
        check("код возврата 0", code == 0, f"code={code}")
        check("горячие клавиши зарегистрированы (F8/F9/F10)",
            sorted(k for _i, k in hotkey.registered) == ["F10", "F8", "F9"],
            str(hotkey.registered))
        check("игра запущена с -win",
              launcher.launches == [("C:\\RotWK\\lotrbfme2ep1.exe", ["-win"])],
            str(launcher.launches))

        # Проверяем сохранение карты в maps.json
        check("maps.json создан", os.path.exists(cfg.MAPS_FILE))
        saved_maps = json.load(open(cfg.MAPS_FILE, encoding="utf-8"))
        check("карта сохранена в maps.json", "testovaya_krepost" in saved_maps, str(saved_maps.keys()))
        saved_card = saved_maps.get("testovaya_krepost", {})
        check("карта отмечена как крепость", saved_card.get("is_fortress") is True)
        check("ровно 4 позиции обороны", len(saved_card.get("defense_positions", [])) == 4)
        check("ровно 4 позиции атаки", len(saved_card.get("attack_positions", [])) == 4)

        marker_json = os.path.join(cfg.CONFIG_DIR, "menu_marker.json")
        check("menu_marker.json создан", os.path.exists(marker_json))

        log = os.path.join(tmp, "calibrate_log.txt")
        log_text = open(log, encoding="utf-8").read() if os.path.exists(log) else ""
        check("в логе зафиксировано завершение мастера", "ВСЕ 8 ТОЧЕК УСПЕШНО СНЯТЫ" in log_text)

    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_maps_loading_and_fallback():
    print("\n[4] bridge/maps.py — загрузка карт из maps.json и доступность в игре")
    from bridge import maps
    all_maps = maps.load_all_maps()
    check("встроенные карты доступны", "westmarch" in all_maps and "minas_tirith" in all_maps)
    check("Минас Тирит — крепость", maps.is_fortress_map("minas_tirith") is True)
    check("Вестмарш — обычная карта", maps.is_fortress_map("westmarch") is False)


def main():
    print("=" * 64)
    print("Самопроверка калибратора и карт (офлайн)")
    print("=" * 64)
    test_config_paths()
    test_elevate_command()
    test_calibrate_flow()
    test_maps_loading_and_fallback()

    print("\n" + "=" * 64)
    if FAILURES:
        print(f"ПРОВАЛЕНО проверок: {len(FAILURES)}")
        for name in FAILURES:
            print(f"  - {name}")
        return 1
    print("Все проверки пройдены.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
