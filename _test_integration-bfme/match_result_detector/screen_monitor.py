#!/usr/bin/env python3
"""
Фоновый мониторинг появления экрана статистики (Score Screen).

Экран статистики определяется по ДВУМ независимым маркерам:
  * иконка «Крепость» в легенде внизу (fortress_icon.png);
  * декоративный элемент шапки «Счёт» (score_screen_marker.png).

Оба должны быть найдены подряд confirm_streak кадров — это исключает ложные
срабатывания на боевом HUD. Держит кадр «чёрным» (fullscreen D3D не отдаёт
BitBlt) дальше, а не обрабатывает пустоту.

КЛЮЧЕВОЙ МОМЕНТ: score_screen_marker находится и на лобби (0.97), поэтому
нужен ОБЯЗАТЕЛЬНО и fortress_icon: он на статистике ~1.0, на лобби ~0.57.
"""

import threading
import time
from typing import Callable, Optional

from . import icon_finder


class ScoreScreenMonitor(threading.Thread):
    """Поток-монитор: ждёт появление экрана статистики."""

    def __init__(self, is_score_screen: Callable, poll: float = 0.5,
                 confirm_streak: int = 2,
                 on_score_screen: Optional[Callable] = None,
                 on_timeout: Optional[Callable] = None,
                 game_alive: Optional[Callable] = None):
        super().__init__(daemon=True)
        self._is_score_screen = is_score_screen
        self._poll = poll
        self._confirm_streak = confirm_streak
        self._on_score_screen = on_score_screen
        self._on_timeout = on_timeout
        self._game_alive = game_alive
        self._stop = threading.Event()
        self._streak = 0

    def stop(self):
        self._stop.set()

    def run(self):
        deadline = None
        # Вообще монитор не имеет собственного таймаута — таймаут задаётся
        # снаружи через stop(); здесь только поллинг.
        while not self._stop.is_set():
            # Если игра закрылась/упала — не ждём экран статистики.
            if self._game_alive is not None:
                try:
                    if not self._game_alive():
                        self._stop.set()
                        break
                except Exception:  # noqa: BLE001
                    self._stop.set()
                    break
            try:
                ok = self._is_score_screen()
            except Exception:  # noqa: BLE001 - захват может временно падать
                ok = False
            if ok:
                self._streak += 1
                if self._streak >= self._confirm_streak:
                    if self._on_score_screen:
                        self._on_score_screen()
                    return
            else:
                self._streak = 0
            # прерываемый сон
            self._stop.wait(self._poll)
        if self._on_timeout:
            self._on_timeout()