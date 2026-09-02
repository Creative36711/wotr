#!/usr/bin/env python3
"""
Модуль определения команды-победителя BFME2:RotWK по экрану статистики.

Публичный API:

    from match_result_detector import MatchResultDetector

    players = [
        {"name": "Игрок", "slot": 1, "color": "blue", "team": "good",
         "is_local_player": True},
        {"name": "Бот 1", "slot": 2, "color": "red", "team": "evil",
         "is_local_player": False},
    ]
    detector = MatchResultDetector(players)
    result = detector.wait_for_result(timeout=1200)

Ручной анализ кадра/файла:

    detector.analyze_current_screen()
    detector.analyze_image(frame_rgb)
    detector.analyze_file("screenshot.png")

Команды: "good" = Свет (добро), "evil" = Тьма (зло).
"""

from .detector import (MatchResultDetector, STATUS_COMPLETED,
                       STATUS_SURRENDER, STATUS_TIMEOUT, STATUS_UNKNOWN)
from .config import DetectorConfig, TEMPLATE_FILES, TEMPLATES_DIR

__version__ = "0.2.0"
__all__ = [
    "MatchResultDetector",
    "DetectorConfig",
    "TEMPLATE_FILES",
    "TEMPLATES_DIR",
    "STATUS_COMPLETED",
    "STATUS_SURRENDER",
    "STATUS_TIMEOUT",
    "STATUS_UNKNOWN",
    "__version__",
]