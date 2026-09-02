#!/usr/bin/env python3
"""
Обратная совместимость: модуль maps заменил fortresses.
"""

from bridge import maps

# Для обратной совместимости
FORTRESSES = {
    k: {
        "name": v["name"],
        "start_pos": v["defense_positions"][0] if v["defense_positions"] else (0.0, 0.0),
    }
    for k, v in maps.MAPS.items()
}
