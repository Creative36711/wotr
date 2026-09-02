#!/usr/bin/env python3
"""
Логирование.

Просто печатает сообщения (как print), без таймстампов — чтобы консоль не
засорялась. При желании время можно вернуть, добавив префикс в log().

Использование:
    from bridge.log import log
    log("запускаю игру")
"""

import time

_start = None


def start():
    """(совместимость) — сброс отсчёта, сейчас не используется."""
    global _start
    _start = time.monotonic()


def log(*args, **kwargs):
    """Печатает сообщение. Поддерживает print-аргументы (file= и т.п.)."""
    if not args:
        print(**kwargs)
        return
    msg = " ".join(str(a) for a in args)
    print(msg, **kwargs)
