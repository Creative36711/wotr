#!/usr/bin/env python3
"""
Сборка списка игроков для модуля определения исхода матча.

Детектору нужно знать ЦВЕТ и КОМАНДУ каждого слота ЗАРАНЕЕ (это задаётся
при настройке комнаты детерминированно: цвет — по фракции, команда — по
союзу из FACTION_ALLIANCES). Здесь мы собираем этот список из переданных в
main() значений.

Формат каждого игрока:
    {
      "name": "Игрок" | "Бот N",
      "slot": 1..8,
      "color": "blue"/"red"/...,   # имя цвета для детектора
      "team": "good" (добро) | "evil" (зло),
      "is_local_player": bool,
    }

ЦВЕТ ИЗЕНГАРДА — БЕЛЫЙ (правка пользователя). В network_prefs.FACTION_COLORS
был "black", но чёрная линия неразличима на тёмном графике, поэтому он
заменён на "white" ВЕЗДЕ (и в NetworkPref.ini, и в комнате, и здесь).

Импорт bridge.* сделан отложенным (внутри функций), чтобы модуль можно было
импортировать и тестировать на не-Windows (бридж тянет ctypes.windll).
"""

import logging

log = logging.getLogger("bridge.match_players")


# Фракция -> цвет ЛИНИИ на графике (для детектора). Совпадает с
# network_prefs.FACTION_COLORS (Изенгард — БЕЛЫЙ после правки).
_LINE_COLORS = {
    "men": "blue",
    "elves": "green",
    "dwarves": "yellow",
    "isengard": "white",      # правка: чёрный не читается на тёмном графике
    "mordor": "red",
    "goblins": "orange",
    "angmar": "purple",
}

# Союзы фракций: "good" = Свет (добро), "evil" = Тьма (зло). Продублировано
# здесь, чтобы не тянуть бридж (bridge.room тянет ctypes.windll — только Windows).
# Значения совпадают с bridge.room.FACTION_ALLIANCES.
_TEAM_BY_FACTION = {
    "men": "good", "elves": "good", "dwarves": "good",            # свет
    "isengard": "evil", "mordor": "evil", "goblins": "evil",      # тьма
    "angmar": "evil",
}


def player_list(player_faction, bot_factions, player_color=None):
    """Собрать список игроков (слот 1 = игрок, слоты 2..N = боты).

    Args:
        player_faction: ключ фракции игрока (слот 1).
        bot_factions: dict {slot: faction_key} для слотов 2..N.
        player_color: имя цвета игрока (по умолчанию — цвет линии фракции).

    Returns:
        список dict игроков (цвета известны заранее).
    """
    if player_color is None:
        player_color = _line_color(player_faction)

    players = []
    # Игрок (слот 1).
    players.append({
        "name": "Игрок",
        "slot": 1,
        "color": player_color,
        "team": _team_for(player_faction),
        "is_local_player": True,
    })
    # Боты (слоты 2..N).
    for slot, faction in sorted(bot_factions.items()):
        color = _line_color(faction)
        players.append({
            "name": f"Бот {slot}",
            "slot": slot,
            "color": color,
            "team": _team_for(faction),
            "is_local_player": False,
        })
    return players


def _line_color(faction):
    """Цвет линии фракции для детектора (с учётом правки Изенгард->white)."""
    if faction in _LINE_COLORS:
        return _LINE_COLORS[faction]
    # Неизвестная фракция — откат на network_prefs.FACTION_COLORS.
    try:
        from bridge import network_prefs
    except Exception:  # noqa: BLE001
        return None
    return network_prefs.FACTION_COLORS.get(faction)


def _team_for(faction):
    """Команда фракции: \"good\" = Свет (добро), \"evil\" = Тьма (зло)."""
    return _TEAM_BY_FACTION.get(faction)
