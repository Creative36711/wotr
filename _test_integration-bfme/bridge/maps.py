#!/usr/bin/env python3
"""
Карты и их стартовые позиции (оборона и атака).

Карты хранятся в config/maps.json.
На каждой карте фиксировано 8 точек:
  - первые 4 — позиции обороны (defense_positions), отсортированные по приоритету
  - вторые 4 — позиции атаки (attack_positions), отсортированные по приоритету

Карты могут быть обычными или крепостями (is_fortress = True).
Для карты-крепости 1-я позиция обороны — главная (управляет воротами крепости).
При запуске боя выбирается владелец крепости (слот из защитников), который встаёт
на самую первую координату обороны (defense_positions[0]).

Механика назначения в комнате:
  - Если на карте-крепости задан владелец (слот K): кликаем его позицию K раз,
    чтобы слот K закрепился за главной точкой крепости.
    Затем все остальные слоты назначаются по возрастанию номеров (1, 2, 3, ...)
    ровно по 1 клику (игра автоматически подставляет следующий свободный слот).
  - На обычной карте все слоты назначаются по возрастанию номеров (1, 2, 3, ...)
    ровно по 1 клику на позицию.
"""

import os
import random
import re

from bridge import config

DEFAULT_MAPS = {
    "westmarch": {
        "name": "Вестмарш",
        "map_name": "map mp tournament westmarch",
        "is_fortress": False,
        "defense_positions": [
            (0.4484, 0.3306),
            (0.4664, 0.3403),
            (0.4492, 0.4292),
            (0.4672, 0.4125),
        ],
        "attack_positions": [
            (0.5273, 0.3389),
            (0.5430, 0.3264),
            (0.5250, 0.4167),
            (0.5437, 0.4278),
        ],
    },
    "dagorlad": {
        "name": "Дагорлад",
        "map_name": "map wor dagorlad",
        "is_fortress": False,
        "defense_positions": [
            (0.4727, 0.3167),
            (0.5039, 0.3236),
            (0.5195, 0.3417),
            (0.5352, 0.3417),
        ],
        "attack_positions": [
            (0.4555, 0.4222),
            (0.4813, 0.4403),
            (0.4898, 0.4250),
            (0.5156, 0.4347),
        ],
    },
    "dead_marshes": {
        "name": "Мёртвые топи",
        "map_name": "map wor dead marshes",
        "is_fortress": False,
        "defense_positions": [
            (0.4914, 0.3208),
            (0.4617, 0.3458),
            (0.4734, 0.3639),
            (0.4672, 0.4125),
        ],
        "attack_positions": [
            (0.5211, 0.3514),
            (0.5172, 0.4056),
            (0.5305, 0.4181),
            (0.4961, 0.4333),
        ],
    },
    "minas_tirith": {
        "name": "Минас Тирит",
        "map_name": "map wor minas tirith",
        "is_fortress": True,
        "defense_positions": [
            (0.4906, 0.3514),
            (0.4984, 0.3306),
            (0.4813, 0.3694),
            (0.4688, 0.3861),
        ],
        "attack_positions": [
            (0.4656, 0.4306),
            (0.4945, 0.4250),
            (0.5211, 0.4306),
            (0.5250, 0.3208),
        ],
    },
}

# ---------------------------------------------------------------------------
# Союзы фракций (свет / тьма)
# ---------------------------------------------------------------------------
FACTION_ALLIANCES = {
    "men": "good", "elves": "good", "dwarves": "good",           # свет
    "isengard": "evil", "mordor": "evil", "goblins": "evil",     # тьма
    "angmar": "evil",
}


def load_all_maps():
    """Загрузить все карты из config/maps.json (с fallback на DEFAULT_MAPS)."""
    raw = config.load_maps()
    if not raw:
        raw = dict(DEFAULT_MAPS)
        try:
            config.save_json(config.MAPS_FILE, raw)
        except OSError:
            pass

    maps_dict = {}
    for k, v in raw.items():
        def_pos = [tuple(p) for p in v.get("defense_positions", [])]
        atk_pos = [tuple(p) for p in v.get("attack_positions", [])]
        maps_dict[k] = {
            "name": v.get("name", k),
            "map_name": v.get("map_name", k),
            "is_fortress": bool(v.get("is_fortress", False)),
            "defense_positions": def_pos,
            "attack_positions": atk_pos,
        }
    return maps_dict


# Всегда актуальный словарь карт
MAPS = load_all_maps()


def reload_maps():
    """Перечитать карты с диска."""
    global MAPS
    MAPS = load_all_maps()
    return MAPS


def save_map(key, map_dict):
    """Сохранить или обновить карту в config/maps.json."""
    all_maps = load_all_maps()
    all_maps[key] = {
        "name": map_dict.get("name", key),
        "map_name": map_dict.get("map_name", key),
        "is_fortress": bool(map_dict.get("is_fortress", False)),
        "defense_positions": [list(p) for p in map_dict.get("defense_positions", [])],
        "attack_positions": [list(p) for p in map_dict.get("attack_positions", [])],
    }
    config.save_json(config.MAPS_FILE, all_maps)
    reload_maps()
    return all_maps[key]


def get_map(key):
    """Получить данные карты по ключу, номеру или названию."""
    if not key:
        return None
    maps_dict = reload_maps()
    k_str = str(key).strip().lower()
    keys = list(maps_dict.keys())
    if k_str.isdigit() and 1 <= int(k_str) <= len(keys):
        return maps_dict[keys[int(k_str) - 1]]
    if k_str in maps_dict:
        return maps_dict[k_str]
    for k, v in maps_dict.items():
        if k_str in (v["name"].lower(), v["map_name"].lower()):
            return v
    for k, v in maps_dict.items():
        if k_str in v["map_name"].lower().replace("map ", ""):
            return v
    return None


def is_fortress_map(key):
    """Является ли карта крепостью."""
    if isinstance(key, dict):
        return bool(key.get("is_fortress", False))
    m = get_map(key)
    return bool(m.get("is_fortress", False)) if m else False


def get_team_slots(player_role, total_players, player_faction, bot_factions):
    """Разделение слотов 1..total_players на защитников и атакующих."""
    player_alliance = FACTION_ALLIANCES.get(player_faction, "good")
    allies = [1]
    enemies = []
    for slot in range(2, total_players + 1):
        bot_all = FACTION_ALLIANCES.get(bot_factions.get(slot), None)
        if bot_all == player_alliance:
            allies.append(slot)
        else:
            enemies.append(slot)

    # Если все фракции одного союза (например, все «Свет»),
    # то делим: слот 1 (игрок) против слотов 2..N (боты).
    if not enemies and total_players > 1:
        allies = [1]
        enemies = list(range(2, total_players + 1))

    if player_role in ("defender", "защитник", "def"):
        defender_slots = list(allies)
        attacker_slots = list(enemies)
    else:
        attacker_slots = list(allies)
        defender_slots = list(enemies)

    return defender_slots, attacker_slots


def calculate_slot_positions(map_key_or_data, player_role, total_players,
                             player_faction, bot_factions,
                             random_positions=False,
                             fortress_owner=None):
    """Вычислить координаты стартовых позиций для каждого слота.

    Параметры:
      - map_key_or_data: ключ карты (str) или словарь данных карты (dict)
      - player_role: "defender" (защитник) или "attacker" (атакующий)
      - total_players: общее число игроков (1..8)
      - player_faction: фракция игрока (слот 1)
      - bot_factions: dict {slot: faction_key} для слотов 2..N
      - random_positions: bool — расставлять позиции случайно (отдельно
        для защитников и атакующих) или по приоритету (по порядку списка).
      - fortress_owner: номер слота владельца крепости (встаёт на 1-ю точку обороны).

    Возвращает:
      (slot_positions, defender_slots, attacker_slots)
      где slot_positions = {slot: (fx, fy)}
    """
    if isinstance(map_key_or_data, dict):
        map_data = map_key_or_data
    else:
        map_data = MAPS.get(map_key_or_data)
        if not map_data:
            map_data = get_map(map_key_or_data)
    if not map_data:
        return {}, [], []

    def_coords = list(map_data.get("defense_positions", []))
    atk_coords = list(map_data.get("attack_positions", []))

    defender_slots, attacker_slots = get_team_slots(
        player_role, total_players, player_faction, bot_factions
    )

    slot_positions = {}

    # Обработка позиций защиты
    if fortress_owner and fortress_owner in defender_slots and def_coords:
        # Владелец крепости гарантированно встаёт на самую первую координату обороны
        slot_positions[fortress_owner] = def_coords[0]
        rem_slots = [s for s in defender_slots if s != fortress_owner]
        rem_coords = def_coords[1:]
        if random_positions:
            n_def = min(len(rem_slots), len(rem_coords))
            chosen_def = random.sample(rem_coords, n_def)
        else:
            chosen_def = rem_coords[:len(rem_slots)]
        for slot, pos in zip(rem_slots, chosen_def):
            slot_positions[slot] = pos
    else:
        if random_positions:
            n_def = min(len(defender_slots), len(def_coords))
            chosen_def = random.sample(def_coords, n_def)
        else:
            chosen_def = def_coords[:len(defender_slots)]
        for slot, pos in zip(defender_slots, chosen_def):
            slot_positions[slot] = pos

    # Обработка позиций атаки
    if random_positions:
        n_atk = min(len(attacker_slots), len(atk_coords))
        chosen_atk = random.sample(atk_coords, n_atk)
    else:
        chosen_atk = atk_coords[:len(attacker_slots)]
    for slot, pos in zip(attacker_slots, chosen_atk):
        slot_positions[slot] = pos

    return slot_positions, defender_slots, attacker_slots
