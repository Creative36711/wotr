#!/usr/bin/env python3
"""
Global hotkey listener via RegisterHotKey + GetMessageW.

Standard library only, Windows only. Run it, switch to the game, and press the
registered keys — the actions fire while the game stays in the foreground
(which is exactly what input injection needs).

Usage (see hotkey_capture.py):
    import hotkey
    hotkey.register(1, "F8")            # id=1 -> F8
    hotkey.register(2, "F9")            # id=2 -> F9
    hotkey.run_loop({1: shot, 2: nav})  # blocks until a quit is posted
"""

import ctypes
from ctypes import wintypes

user32 = ctypes.windll.user32

WM_HOTKEY = 0x0312
MOD_NOREPEAT = 0x4000  # don't auto-repeat while the key is held


class MSG(ctypes.Structure):
    _fields_ = [
        ("hwnd", wintypes.HWND),
        ("message", wintypes.UINT),
        ("wParam", wintypes.WPARAM),
        ("lParam", wintypes.LPARAM),
        ("time", wintypes.DWORD),
        ("pt", wintypes.POINT),
    ]


# Function-key VK codes (the keys most likely free inside the game's menus).
VK = {
    "F1": 0x70, "F2": 0x71, "F3": 0x72, "F4": 0x73, "F5": 0x74, "F6": 0x75,
    "F7": 0x76, "F8": 0x77, "F9": 0x78, "F10": 0x79, "F11": 0x7A, "F12": 0x7B,
    "ESC": 0x1B,
}

user32.RegisterHotKey.argtypes = [wintypes.HWND, ctypes.c_int,
                                  wintypes.UINT, wintypes.UINT]
user32.RegisterHotKey.restype = wintypes.BOOL
user32.GetMessageW.argtypes = [ctypes.POINTER(MSG), wintypes.HWND,
                               wintypes.UINT, wintypes.UINT]
user32.GetMessageW.restype = ctypes.c_int
user32.PostQuitMessage.argtypes = [ctypes.c_int]


def register(id_, key, modifiers=MOD_NOREPEAT):
    """Register a hotkey (string name or VK code) under an integer id."""
    vk = VK[key.upper()] if isinstance(key, str) else key
    if not user32.RegisterHotKey(None, id_, modifiers, vk):
        raise OSError(f"RegisterHotKey failed for {key!r} "
                      f"(id={id_}) — maybe already taken")


def post_quit():
    user32.PostQuitMessage(0)


def run_loop(actions):
    """
    Block, dispatching hotkey presses. `actions` maps id -> callable.

    Returns when PostQuitMessage is called (or the message loop breaks).
    """
    msg = MSG()
    while True:
        res = user32.GetMessageW(ctypes.byref(msg), None, 0, 0)
        if res in (0, -1):      # WM_QUIT (0) or error (-1)
            break
        if msg.message == WM_HOTKEY:
            fn = actions.get(int(msg.wParam))
            if fn:
                fn()


if __name__ == "__main__":
    print("This is a library — see hotkey_capture.py for a working example.")
