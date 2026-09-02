#!/usr/bin/env python3
"""
Elevation helpers.

The game exe requires admin (WinError 740), so it runs elevated. Windows UIPI
(User Interface Privilege Isolation) blocks a NON-elevated process from
injecting input into an elevated window — clicks silently vanish. So the
automation script must run at the same (high) integrity level.

Two ways to satisfy this:
  * run PyCharm / your terminal "as administrator", OR
  * call ensure_admin() — it re-launches the current script elevated (a UAC
    prompt appears once, output then goes to a NEW console window).

Собранный EXE (PyInstaller) собирается с манифестом requireAdministrator
(uac_admin=True в packaging/calibrate.spec), поэтому Windows сама показывает
UAC при запуске, и ensure_admin() просто возвращает управление — перезапуск
не нужен. Для запуска из исходников (python tools\\calibrate.py) перезапуск
через ShellExecuteW обязателен.

APPDATA-СОХРАНЕНИЕ:
  При ShellExecuteW("runas") запускается НОВЫЙ процесс с правами админа.
  Переменные окружения текущего процесса НЕ наследуются. Чтобы дочерний
  процесс знал APPDATA реального пользователя, передаём его через скрытый
  аргумент --_real_appdata=<путь>. main.py затем восстанавливает его в
  os.environ["_REAL_APPDATA"].
"""

import ctypes
import os
import subprocess
import sys

APPDATA_ARG = "--_real_appdata="


def is_admin():
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def _appdata_arg():
    """`--_real_appdata=<путь>` для дочернего процесса (или None)."""
    real_appdata = os.environ.get("_REAL_APPDATA") or os.environ.get("APPDATA")
    return f"{APPDATA_ARG}{real_appdata}" if real_appdata else None


def elevated_command(argv=None, extra=None):
    """(exe, params) для UAC-перезапуска текущего процесса.

    * исходники:  python.exe  "путь\\к\\скрипту.py" [аргументы]
    * собранный exe:  Calibrate.exe [аргументы]   (без имени скрипта!)

    Вынесено в отдельную функцию, чтобы её можно было проверить без Windows.
    """
    argv = list(sys.argv if argv is None else argv)
    args = list(extra if extra is not None else argv[1:])
    appdata = _appdata_arg()
    if appdata and appdata not in args:
        args.append(appdata)

    if getattr(sys, "frozen", False):
        # sys.argv[0] == сам exe — передавать его ещё раз не нужно.
        return sys.executable, subprocess.list2cmdline(args) or None

    script = os.path.abspath(argv[0]) if argv else os.path.abspath(sys.argv[0])
    return sys.executable, subprocess.list2cmdline([script] + args)


def ensure_admin():
    """If not running elevated, re-launch this script/exe elevated and exit.

    Передаёт _REAL_APPDATA через аргумент командной строки, чтобы
    повышенный процесс мог найти NetworkPref.ini в правильном профиле.
    """
    if is_admin():
        return

    exe, params = elevated_command()
    workdir = os.path.dirname(exe) if getattr(sys, "frozen", False) else \
        os.path.dirname(os.path.abspath(sys.argv[0]))

    # ShellExecuteW возвращает HINSTANCE (размер указателя). Без явного
    # restype ctypes урезает его до 32 бит, и успешный запуск может
    # «превратиться» в отрицательное число -> ложная ошибка.
    shell32 = ctypes.windll.shell32
    shell32.ShellExecuteW.restype = ctypes.c_size_t
    shell32.ShellExecuteW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p,
                                      ctypes.c_wchar_p, ctypes.c_wchar_p,
                                      ctypes.c_wchar_p, ctypes.c_int]
    ret = shell32.ShellExecuteW(None, "runas", exe, params, workdir, 1)
    if ret <= 32:
        raise SystemExit(f"Elevation failed (code {ret}). "
                         f"User may have cancelled the UAC prompt.")
    raise SystemExit(0)  # stop the non-elevated copy; the elevated one is running


def restore_real_appdata(argv=None):
    """Восстановить _REAL_APPDATA из аргументов (вызвать после argparse).

    Ищет --_real_appdata=<путь> в sys.argv, удаляет его из списка и
    устанавливает os.environ["_REAL_APPDATA"]. Безопасно вызывать, даже
    если аргумента нет.
    """
    args = argv if argv is not None else sys.argv
    to_remove = None
    for arg in args:
        if arg.startswith(APPDATA_ARG):
            value = arg.split("=", 1)[1]
            if value:
                os.environ["_REAL_APPDATA"] = value
            to_remove = arg
            break
    if to_remove and to_remove in args:
        args.remove(to_remove)
