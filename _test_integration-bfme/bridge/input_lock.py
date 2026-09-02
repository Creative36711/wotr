#!/usr/bin/env python3
"""
Блокировка физического ввода пользователя на время автоматизации.

Реализация через low-level hooks (WH_KEYBOARD_LL / WH_MOUSE_LL).

Принцип (собственный маркер ввода):
  * Вся наша инъекция идёт через SendInput и помечает события магическим
    dwExtraInfo = INJECT_MAGIC (см. bridge/navigate.py).
  * Хук ПРОПУСКАЕТ события с нашим маркером и БЛОКИРУЕТ всё остальное:
    клавиатуру, клики, колесо И движение мыши (курсор замирает для юзера,
    но наша автоматизация продолжает им управлять).
  * Почему не системный флаг LL*_INJECTED: софт игровых клавиатур/мышей
    (Logitech, Razer и т.п.) помечает физические нажатия как инжектированные,
    из-за чего флаг ненадёжен. Наш маркер такой софт не подделает.

Безопасность:
  * Ctrl+Alt+Del обрабатывается Winlogon на защищённом десктопе и НЕ проходит
    через low-level hook — его заблокировать невозможно и НЕ нужно: это
    аварийный выход для пользователя. Так и задумано.
  * Поток хука — daemon: при завершении процесса хук снимается сам.
"""

import ctypes
import threading
import traceback
from ctypes import wintypes

from bridge.log import log
from bridge import navigate as _nav  # для INJECT_MAGIC

INJECT_MAGIC = _nav.INJECT_MAGIC

user32 = ctypes.windll.user32

WH_KEYBOARD_LL = 13
WH_MOUSE_LL = 14

LRESULT = ctypes.c_ssize_t
HOOKPROC = ctypes.WINFUNCTYPE(LRESULT, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM)


class KBDLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [
        ("vkCode", wintypes.DWORD),
        ("scanCode", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.c_void_p),
    ]


class MSLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [
        ("pt", wintypes.POINT),
        ("mouseData", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.c_void_p),
    ]


class MSG(ctypes.Structure):
    _fields_ = [
        ("hwnd", wintypes.HWND),
        ("message", wintypes.UINT),
        ("wParam", wintypes.WPARAM),
        ("lParam", wintypes.LPARAM),
        ("time", wintypes.DWORD),
        ("pt", wintypes.POINT),
    ]


user32.SetWindowsHookExW.argtypes = [ctypes.c_int, HOOKPROC, wintypes.HANDLE, wintypes.DWORD]
user32.SetWindowsHookExW.restype = wintypes.HANDLE
user32.CallNextHookEx.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM]
user32.CallNextHookEx.restype = LRESULT
user32.UnhookWindowsHookEx.argtypes = [wintypes.HANDLE]
user32.UnhookWindowsHookEx.restype = wintypes.BOOL
user32.GetMessageW.argtypes = [ctypes.POINTER(MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT]
user32.GetMessageW.restype = ctypes.c_int
user32.TranslateMessage.argtypes = [ctypes.POINTER(MSG)]
user32.TranslateMessage.restype = wintypes.BOOL
user32.DispatchMessageW.argtypes = [ctypes.POINTER(MSG)]
user32.DispatchMessageW.restype = LRESULT


_blocking = threading.Event()
_ready = threading.Event()      # потоки сообщают: хуки установлены (или ошибка)
_error = []

# Диагностические счётчики (сколько событий увидели / заблокировали).
_kb_seen = 0
_kb_blocked = 0
_mouse_seen = 0
_mouse_blocked = 0


def _kb_proc(nCode, wParam, lParam):
    global _kb_seen, _kb_blocked
    if nCode >= 0 and _blocking.is_set():
        _kb_seen += 1
        s = ctypes.cast(lParam, ctypes.POINTER(KBDLLHOOKSTRUCT)).contents
        if s.dwExtraInfo != INJECT_MAGIC:
            _kb_blocked += 1
            return 1  # физическая клавиша -> блокируем
    return user32.CallNextHookEx(None, nCode, wParam, lParam)


def _mouse_proc(nCode, wParam, lParam):
    global _mouse_seen, _mouse_blocked
    if nCode >= 0 and _blocking.is_set():
        _mouse_seen += 1
        s = ctypes.cast(lParam, ctypes.POINTER(MSLLHOOKSTRUCT)).contents
        if s.dwExtraInfo != INJECT_MAGIC:
            _mouse_blocked += 1
            return 1  # физическое движение/клик/колесо -> блокируем
    return user32.CallNextHookEx(None, nCode, wParam, lParam)


def get_stats():
    """Счётчики: сколько событий увидели и сколько заблокировали."""
    return {
        "kb_seen": _kb_seen, "kb_blocked": _kb_blocked,
        "mouse_seen": _mouse_seen, "mouse_blocked": _mouse_blocked,
    }


# Держим коллбеки живыми (иначе ctypes соберёт их мусором, и хук упадёт).
_KB_PROC = HOOKPROC(_kb_proc)
_MOUSE_PROC = HOOKPROC(_mouse_proc)

_hook_thread = None


def _loop():
    try:
        kb = user32.SetWindowsHookExW(WH_KEYBOARD_LL, _KB_PROC, None, 0)
        mo = user32.SetWindowsHookExW(WH_MOUSE_LL, _MOUSE_PROC, None, 0)
        if not kb or not mo:
            _error.append(f"SetWindowsHookExW failed: kb={kb!r} mo={mo!r} "
                          f"last_error={ctypes.get_last_error()}")
            _ready.set()
            return
        log(f"[lock] hooks installed (kb=0x{kb:X} mo=0x{mo:X})", flush=True)
        _ready.set()
        msg = MSG()
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))
        user32.UnhookWindowsHookEx(kb)
        user32.UnhookWindowsHookEx(mo)
        log("[lock] hooks removed (message loop ended)", flush=True)
    except Exception:
        _error.append(traceback.format_exc())
        _ready.set()


def _ensure_thread():
    global _hook_thread
    if _hook_thread is None or not _hook_thread.is_alive():
        _ready.clear()
        _hook_thread = threading.Thread(target=_loop, name="input-lock", daemon=True)
        _hook_thread.start()


def lock():
    """Заблокировать физический ввод. Возвращает True, если хуки реально встали."""
    _ensure_thread()
    _ready.wait(timeout=5.0)
    if _error:
        log("[lock] ERROR installing hooks:\n" + _error[-1], flush=True)
        return False
    _blocking.set()
    return True


def unlock():
    """Разблокировать физический ввод."""
    _blocking.clear()


class InputLock:
    """Контекстный менеджер: `with InputLock(): ...` блокирует ввод на время блока."""

    def __enter__(self):
        ok = lock()
        log("[lock] user input blocked" if ok else "[lock] BLOCK FAILED")
        return self

    def __exit__(self, *exc):
        unlock()
        log("[lock] user input unblocked")
        return False  # не глушим исключения
