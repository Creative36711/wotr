#!/usr/bin/env python3
"""
BFME2: RotWK integration — window & input primitives.

Find the game window, read its viewport, and inject mouse input via SendInput.
Language-agnostic by design: navigation is done by POSITION (fractions of the
window), never by reading text labels.

Standard library only. Windows only (talks to Win32 directly).

IMPORTANT: restype/argtypes are set explicitly for every Win32 call that
returns or takes a HANDLE/pointer — on 64-bit Python the default ctypes
behaviour truncates those to 32-bit ints and will crash or corrupt.
"""

import ctypes
import time
from ctypes import wintypes

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

# ---------------------------------------------------------------------------
# Win32 prototypes (restype/argtypes are REQUIRED on 64-bit Python)
# ---------------------------------------------------------------------------
user32.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
user32.FindWindowW.restype = wintypes.HWND
user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.GetWindowTextW.restype = ctypes.c_int
user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.GetClassNameW.restype = ctypes.c_int
user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user32.GetWindowThreadProcessId.restype = wintypes.DWORD
user32.IsWindowVisible.argtypes = [wintypes.HWND]
user32.IsWindowVisible.restype = wintypes.BOOL
user32.EnumWindows.argtypes = [ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM), wintypes.LPARAM]
user32.EnumWindows.restype = wintypes.BOOL
user32.GetClientRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
user32.GetClientRect.restype = wintypes.BOOL
user32.ClientToScreen.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.POINT)]
user32.ClientToScreen.restype = wintypes.BOOL
user32.GetCursorPos.argtypes = [ctypes.POINTER(wintypes.POINT)]
user32.GetCursorPos.restype = wintypes.BOOL
user32.GetSystemMetrics.argtypes = [ctypes.c_int]
user32.GetSystemMetrics.restype = ctypes.c_int
user32.SetForegroundWindow.argtypes = [wintypes.HWND]
user32.SetForegroundWindow.restype = wintypes.BOOL
user32.BringWindowToTop.argtypes = [wintypes.HWND]
user32.BringWindowToTop.restype = wintypes.BOOL
user32.SetActiveWindow.argtypes = [wintypes.HWND]
user32.SetActiveWindow.restype = wintypes.HWND
user32.SetFocus.argtypes = [wintypes.HWND]
user32.SetFocus.restype = wintypes.HWND
user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
user32.ShowWindow.restype = wintypes.BOOL

SW_RESTORE = 9

kernel32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
kernel32.CreateToolhelp32Snapshot.restype = ctypes.c_void_p
kernel32.Process32FirstW.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
kernel32.Process32FirstW.restype = wintypes.BOOL
kernel32.Process32NextW.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
kernel32.Process32NextW.restype = wintypes.BOOL
kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
kernel32.CloseHandle.restype = wintypes.BOOL

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
SAGE_WINDOW_CLASSES = ("SAGE_Window", "SAGE_WINDOW")
GAME_PROCESS_NAMES = ("game.dat", "lotrbfme2ep1.exe", "lotrbfme2.exe")

MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP = 0x0010
MOUSEEVENTF_WHEEL = 0x0800
MOUSEEVENTF_ABSOLUTE = 0x8000

INPUT_MOUSE = 0

# Магический dwExtraInfo, которым помечается КАЖДОЕ наше инжектированное
# событие (SendInput). По нему input_lock отличает нашу автоматизацию от
# физического ввода пользователя. Софт игровых клавиатур/мышей может ставить
# системный флаг LL*_INJECTED на свои события (поэтому флаг ненадёжен), но
# наш маркер он не подделает.
INJECT_MAGIC = 0x57415231  # "WAR1"

TH32CS_SNAPPROCESS = 0x00000002
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value

SM_CXSCREEN = 0
SM_CYSCREEN = 1


class PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("cntUsage", wintypes.DWORD),
        ("th32ProcessID", wintypes.DWORD),
        ("th32DefaultHeapID", ctypes.c_void_p),
        ("th32ModuleID", wintypes.DWORD),
        ("cntThreads", wintypes.DWORD),
        ("th32ParentProcessID", wintypes.DWORD),
        ("pcPriClassBase", ctypes.c_long),
        ("dwFlags", wintypes.DWORD),
        ("szExeFile", wintypes.WCHAR * 260),
    ]


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", ctypes.c_long),
        ("dy", ctypes.c_long),
        ("mouseData", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.c_void_p),
    ]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.c_void_p),
    ]


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [
        ("uMsg", wintypes.DWORD),
        ("wParamL", wintypes.WORD),
        ("wParamH", wintypes.WORD),
    ]


class _INPUTUNION(ctypes.Union):
    _fields_ = [
        ("mi", MOUSEINPUT),
        ("ki", KEYBDINPUT),
        ("hi", HARDWAREINPUT),
    ]


class INPUT(ctypes.Structure):
    _fields_ = [
        ("type", wintypes.DWORD),
        ("u", _INPUTUNION),
    ]


# SendInput — the modern injection API. Events injected via SendInput carry
# the LLKHF_INJECTED / LLMHF_INJECTED flags, so a low-level hook (input_lock)
# can distinguish our automation from the user's physical input.
user32.SendInput.argtypes = [wintypes.UINT, ctypes.POINTER(INPUT), ctypes.c_int]
user32.SendInput.restype = wintypes.UINT


# ---------------------------------------------------------------------------
# Window discovery
# ---------------------------------------------------------------------------
def _get_class_name(hwnd):
    buf = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, buf, 256)
    return buf.value


def _get_window_title(hwnd):
    buf = ctypes.create_unicode_buffer(512)
    user32.GetWindowTextW(hwnd, buf, 512)
    return buf.value


def _get_pid(hwnd):
    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    return pid.value


def _process_name_map():
    """Fresh {pid: exe name} via CreateToolhelp32Snapshot.

    Built on EVERY call — no caching. (An earlier cached version broke:
    if the map was built before the launcher spawned game.dat, it stayed
    without game.dat forever and the game window was never found.) Toolhelp is
    a single kernel call, so rebuilding each time is cheap and always current.
    """
    pmap = {}
    snap = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if snap == INVALID_HANDLE_VALUE:
        return pmap
    entry = PROCESSENTRY32W()
    entry.dwSize = ctypes.sizeof(PROCESSENTRY32W)
    if kernel32.Process32FirstW(snap, ctypes.byref(entry)):
        while True:
            pmap[entry.th32ProcessID] = entry.szExeFile.lower()
            if not kernel32.Process32NextW(snap, ctypes.byref(entry)):
                break
    kernel32.CloseHandle(snap)
    return pmap


def process_pids(names=None):
    """Вернуть {pid: lowercase exe} для процессов, имена которых в names.

    names: набор имён файлов (без пути) или None -> все процессы.
    """
    pmap = _process_name_map()
    if not names:
        return dict(pmap)
    wanted = {str(n).lower() for n in names}
    return {pid: name for pid, name in pmap.items() if name in wanted}


def list_windows():
    """Enumerate ALL top-level windows -> list of dicts (title, class, pid, name)."""
    pmap = _process_name_map()  # build once for this enumeration
    wins = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def _cb(hwnd, _lparam):
        pid = _get_pid(hwnd)
        wins.append({
            "hwnd": hwnd,
            "title": _get_window_title(hwnd),
            "class": _get_class_name(hwnd),
            "pid": pid,
            "proc": pmap.get(pid, f"pid={pid}"),
            "visible": bool(user32.IsWindowVisible(hwnd)),
        })
        return True

    user32.EnumWindows(_cb, 0)
    return wins


def find_window(class_names=None, title_substring=None, process_names=None):
    """
    Find the game window. Priority:
      1. window class (SAGE_Window / SAGE_WINDOW)
      2. window title substring
      3. owning process name (game.dat / lotrbfme2ep1.exe)

    Returns (hwnd, matched_by) — matched_by is a description string.
    """
    class_names = class_names or SAGE_WINDOW_CLASSES
    process_names = process_names or GAME_PROCESS_NAMES

    for cls in class_names:
        hwnd = user32.FindWindowW(cls, None)
        if hwnd:
            return hwnd, f"class={cls}"

    wins = list_windows()
    if title_substring:
        for w in wins:
            if w["visible"] and title_substring.lower() in w["title"].lower():
                return w["hwnd"], f"title~={title_substring!r}"

    for w in wins:
        if w["visible"] and w["proc"].lower() == "game.dat":
            return w["hwnd"], "proc=game.dat"

    for w in wins:
        if w["visible"] and w["proc"].lower() in process_names:
            return w["hwnd"], f"proc={w['proc']}"

    for w in wins:
        if w["proc"].lower() == "game.dat":
            return w["hwnd"], "proc=game.dat (hidden)"

    for w in wins:
        if w["proc"].lower() in process_names:
            return w["hwnd"], f"proc={w['proc']} (hidden)"

    return None, None


def find_game_window(require_visible=True):
    """The REAL game window = one owned by game.dat (never the launcher's).

    Returns (hwnd, desc) or (None, None). We must wait for game.dat, NOT for
    lotrbfme2ep1.exe (the launcher shows up first with a hidden window and
    would be matched too early).
    """
    wins = list_windows()
    for w in wins:
        if w["proc"].lower() == "game.dat" and (w["visible"] or not require_visible):
            return w["hwnd"], "proc=game.dat" + ("" if w["visible"] else " (hidden)")
    if not require_visible:
        return None, None
    for w in wins:
        if w["visible"] and w["proc"].lower() in ("lotrbfme2ep1.exe", "lotrbfme2.exe"):
            return w["hwnd"], f"proc={w['proc']} (launcher fallback)"
    return None, None


# ---------------------------------------------------------------------------
# Window geometry
# ---------------------------------------------------------------------------
def get_client_rect(hwnd):
    """Screen coords (left, top, right, bottom) of the CLIENT area only —
    i.e. the actual game viewport, excluding the title bar and window borders."""
    r = wintypes.RECT()
    if not user32.GetClientRect(hwnd, ctypes.byref(r)):
        raise OSError("GetClientRect failed")
    pt = wintypes.POINT(0, 0)
    if not user32.ClientToScreen(hwnd, ctypes.byref(pt)):
        raise OSError("ClientToScreen failed")
    return pt.x, pt.y, pt.x + r.right, pt.y + r.bottom


def viewport():
    """(l, t, W, H) of the game viewport, or None if the window is gone.

    Convenience helper: finds the game window and returns its client area
    plus dimensions, ready for fraction->pixel conversions.
    """
    hwnd, _how = find_game_window()
    if not hwnd:
        return None
    l, t, r, b = get_client_rect(hwnd)
    return l, t, r - l, b - t


def activate_window(hwnd=None):
    """Вывести окно игры на передний план и отдать ему фокус.

    НУЖНО для холодного запуска: сразу после появления окна (game.dat) игра
    ещё может не иметь фокуса / сворачиваться из-за заставки, поэтому
    ПЕРВЫЕ инжектируемые move/click уходят «в пустоту». Активация окна
    гарантирует, что последующие SendInput-события попадают в игру.

    Возвращает True, если окно найдено и активировано.
    """
    if hwnd is None:
        hwnd, _how = find_game_window()
        if not hwnd:
            return False
    try:
        if not user32.IsWindowVisible(hwnd):
            user32.ShowWindow(hwnd, SW_RESTORE)
        user32.SetForegroundWindow(hwnd)
        user32.BringWindowToTop(hwnd)
        user32.SetActiveWindow(hwnd)
        user32.SetFocus(hwnd)
        return True
    except OSError:
        return False


# ---------------------------------------------------------------------------
# Mouse
# ---------------------------------------------------------------------------
def _send_input(*inputs):
    """Send one or more INPUT structs. Returns the number of events sent."""
    arr = (INPUT * len(inputs))(*inputs)
    return user32.SendInput(len(inputs), arr, ctypes.sizeof(INPUT))


def _mouse_event(flags, dx=0, dy=0, mouse_data=0):
    mi = MOUSEINPUT()
    mi.dx = dx
    mi.dy = dy
    mi.mouseData = mouse_data
    mi.dwFlags = flags
    mi.time = 0
    mi.dwExtraInfo = INJECT_MAGIC
    inp = INPUT()
    inp.type = INPUT_MOUSE
    inp.u.mi = mi
    return inp


def move(x, y):
    """Move the cursor via SendInput (absolute move) — flagged as injected."""
    sw = user32.GetSystemMetrics(SM_CXSCREEN)
    sh = user32.GetSystemMetrics(SM_CYSCREEN)
    nx = int(x * 65535 // max(sw - 1, 1))
    ny = int(y * 65535 // max(sh - 1, 1))
    _send_input(_mouse_event(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, nx, ny))
    time.sleep(0.03)


def get_cursor_pos():
    """Current global cursor position (screen coords), even when the game is focused."""
    pt = wintypes.POINT()
    if not user32.GetCursorPos(ctypes.byref(pt)):
        return None
    return pt.x, pt.y


def click(x=None, y=None, button="left"):
    if x is not None:
        move(x, y)
    down = MOUSEEVENTF_LEFTDOWN if button == "left" else MOUSEEVENTF_RIGHTDOWN
    up = MOUSEEVENTF_LEFTUP if button == "left" else MOUSEEVENTF_RIGHTUP
    _send_input(_mouse_event(down))
    time.sleep(0.05)
    _send_input(_mouse_event(up))
    time.sleep(0.05)


def scroll(notches, pause=0.05):
    """Прокрутка колесом мыши. notches < 0 = вниз (к низу списка), > 0 = вверх.

    Один «нотч» — одно деление колеса (delta ±120). Прокрутка действует на
    элемент под курсором — поэтому курсор должен быть над списком.
    """
    _send_input(_mouse_event(MOUSEEVENTF_WHEEL, 0, 0, int(notches) * 120))
    time.sleep(pause)


# ---------------------------------------------------------------------------
# Захват кадра окна (для визуального детекта готовности)
# ---------------------------------------------------------------------------
def capture_region(x, y, w, h):
    """Захватить прямоугольник экрана (x,y — экранные коорд.) как numpy RGB.

    BitBlt с экрана. Возвращает массив (h, w, 3) или None при ошибке.
    """
    try:
        import numpy as np
    except ImportError:
        return None
    if w <= 0 or h <= 0:
        return None

    gdi32 = ctypes.windll.gdi32
    gdi32.CreateCompatibleDC.argtypes = [ctypes.c_void_p]
    gdi32.CreateCompatibleDC.restype = ctypes.c_void_p
    gdi32.CreateCompatibleBitmap.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int]
    gdi32.CreateCompatibleBitmap.restype = ctypes.c_void_p
    gdi32.SelectObject.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    gdi32.SelectObject.restype = ctypes.c_void_p
    gdi32.BitBlt.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int,
                             ctypes.c_int, ctypes.c_int, ctypes.c_void_p,
                             ctypes.c_int, ctypes.c_int, ctypes.c_uint]
    gdi32.BitBlt.restype = ctypes.c_int
    gdi32.DeleteObject.argtypes = [ctypes.c_void_p]
    gdi32.DeleteDC.argtypes = [ctypes.c_void_p]

    user32.GetDC.argtypes = [wintypes.HWND]
    user32.GetDC.restype = ctypes.c_void_p
    user32.ReleaseDC.argtypes = [wintypes.HWND, ctypes.c_void_p]

    SRCCOPY = 0x00CC0020
    DIB_RGB_COLORS = 0

    class BITMAPINFOHEADER(ctypes.Structure):
        _fields_ = [
            ("biSize", wintypes.DWORD),
            ("biWidth", ctypes.c_long),
            ("biHeight", ctypes.c_long),
            ("biPlanes", wintypes.WORD),
            ("biBitCount", wintypes.WORD),
            ("biCompression", wintypes.DWORD),
            ("biSizeImage", wintypes.DWORD),
            ("biXPelsPerMeter", ctypes.c_long),
            ("biYPelsPerMeter", ctypes.c_long),
            ("biClrUsed", wintypes.DWORD),
            ("biClrImportant", wintypes.DWORD),
        ]

    gdi32.GetDIBits.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint,
                                ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p,
                                ctypes.c_uint]
    gdi32.GetDIBits.restype = ctypes.c_int

    hdc_screen = user32.GetDC(None)
    hdc_mem = gdi32.CreateCompatibleDC(hdc_screen)
    bmp = gdi32.CreateCompatibleBitmap(hdc_screen, w, h)
    if not bmp:
        user32.ReleaseDC(None, hdc_screen)
        return None
    old = gdi32.SelectObject(hdc_mem, bmp)
    ok = gdi32.BitBlt(hdc_mem, 0, 0, w, h, hdc_screen, x, y, SRCCOPY)
    if not ok:
        gdi32.SelectObject(hdc_mem, old)
        gdi32.DeleteObject(bmp)
        gdi32.DeleteDC(hdc_mem)
        user32.ReleaseDC(None, hdc_screen)
        return None

    bmi = BITMAPINFOHEADER()
    bmi.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    bmi.biWidth = w
    bmi.biHeight = -h  # top-down
    bmi.biPlanes = 1
    bmi.biBitCount = 32
    buf = (ctypes.c_ubyte * (w * h * 4))()
    got = gdi32.GetDIBits(hdc_mem, bmp, 0, h, buf, ctypes.byref(bmi), DIB_RGB_COLORS)

    gdi32.SelectObject(hdc_mem, old)
    gdi32.DeleteObject(bmp)
    gdi32.DeleteDC(hdc_mem)
    user32.ReleaseDC(None, hdc_screen)

    if not got:
        return None

    raw = np.frombuffer(buf, dtype=np.uint8).reshape(h, w, 4)
    return raw[:, :, :3][:, :, ::-1].copy()  # BGRA -> RGB


def capture_window():
    """Захватить клиентскую область окна игры как numpy RGB (H, W, 3)."""
    hwnd, _how = find_game_window()
    if not hwnd:
        return None
    l, t, r, b = get_client_rect(hwnd)
    return capture_region(l, t, r - l, b - t)
