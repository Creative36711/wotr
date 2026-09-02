#!/usr/bin/env python3
"""
Тесты для модуля карт, maps.json и назначения позиций.
"""

import json
import os
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

if sys.platform != "win32":
    if "bridge.launcher" not in sys.modules:
        fake_launcher = types.ModuleType("bridge.launcher")
        fake_launcher.discover_exe = lambda exp=None: "C:\\RotWK\\lotrbfme2ep1.exe"
        fake_launcher.launch_game = lambda *a, **k: None
        sys.modules["bridge.launcher"] = fake_launcher
    if "bridge.navigate" not in sys.modules:
        fake_nav = types.ModuleType("bridge.navigate")
        fake_nav.INJECT_MAGIC = 0x42464D45
        fake_nav.viewport = lambda: (0, 0, 1920, 1080)
        fake_nav.click = lambda x, y: None
        fake_nav.move = lambda x, y: None
        fake_nav.scroll = lambda amount: None
        fake_nav.find_game_window = lambda: (None, None)
        sys.modules["bridge.navigate"] = fake_nav
    if "bridge.input_lock" not in sys.modules:
        fake_lock = types.ModuleType("bridge.input_lock")
        fake_lock.lock = lambda: True
        fake_lock.unlock = lambda: None
        sys.modules["bridge.input_lock"] = fake_lock
    if "bridge.elevate" not in sys.modules:
        fake_elevate = types.ModuleType("bridge.elevate")
        fake_elevate.is_admin = lambda: True
        fake_elevate.ensure_admin = lambda: None
        fake_elevate.restore_real_appdata = lambda argv=None: None
        sys.modules["bridge.elevate"] = fake_elevate
    if "bridge.visual_ready" not in sys.modules:
        fake_vr = types.ModuleType("bridge.visual_ready")
        fake_vr.load_marker = lambda *a: (None, None)
        fake_vr.wait_ready = lambda *a, **k: True
        sys.modules["bridge.visual_ready"] = fake_vr

from bridge import maps
from bridge import room
import main


class TestMaps(unittest.TestCase):
    def test_map_definitions(self):
        all_maps = maps.load_all_maps()
        expected_keys = ["westmarch", "dagorlad", "dead_marshes", "minas_tirith"]
        for k in expected_keys:
            self.assertIn(k, all_maps)
            m = all_maps[k]
            self.assertIn("name", m)
            self.assertIn("map_name", m)
            self.assertIn("is_fortress", m)
            self.assertEqual(len(m["defense_positions"]), 4)
            self.assertEqual(len(m["attack_positions"]), 4)

        self.assertFalse(maps.is_fortress_map("westmarch"))
        self.assertFalse(maps.is_fortress_map("dagorlad"))
        self.assertFalse(maps.is_fortress_map("dead_marshes"))
        self.assertTrue(maps.is_fortress_map("minas_tirith"))

    def test_save_and_reload_map(self):
        tmp = tempfile.mkdtemp(prefix="test-map-")
        try:
            from bridge import config
            old_maps_file = config.MAPS_FILE
            config.MAPS_FILE = os.path.join(tmp, "maps.json")

            new_map = {
                "name": "Новая Крепость",
                "map_name": "map mp test fortress",
                "is_fortress": True,
                "defense_positions": [(0.1, 0.1), (0.2, 0.2), (0.3, 0.3), (0.4, 0.4)],
                "attack_positions": [(0.5, 0.5), (0.6, 0.6), (0.7, 0.7), (0.8, 0.8)],
            }
            maps.save_map("new_fortress", new_map)

            reloaded = maps.get_map("new_fortress")
            self.assertIsNotNone(reloaded)
            self.assertEqual(reloaded["name"], "Новая Крепость")
            self.assertTrue(reloaded["is_fortress"])
            self.assertEqual(len(reloaded["defense_positions"]), 4)
            self.assertEqual(reloaded["defense_positions"][0], (0.1, 0.1))

            # Lookup by Russian name
            by_name = maps.get_map("Новая Крепость")
            self.assertIsNotNone(by_name)
            self.assertEqual(by_name["map_name"], "map mp test fortress")

            config.MAPS_FILE = old_maps_file
        finally:
            import shutil
            shutil.rmtree(tmp, ignore_errors=True)

    def test_calculate_slot_positions_fortress_owner(self):
        bot_factions = {
            2: "elves", 3: "dwarves", 4: "men",
            5: "mordor", 6: "isengard", 7: "goblins", 8: "angmar"
        }
        pos, def_s, atk_s = maps.calculate_slot_positions(
            "minas_tirith", "defender", 8, "men", bot_factions,
            random_positions=False, fortress_owner=4
        )
        mt = maps.get_map("minas_tirith")
        # Владелец на 1-й точке
        self.assertEqual(pos[4], mt["defense_positions"][0])
        self.assertEqual(pos[1], mt["defense_positions"][1])
        self.assertEqual(pos[2], mt["defense_positions"][2])
        self.assertEqual(pos[3], mt["defense_positions"][3])
        self.assertEqual(pos[5], mt["attack_positions"][0])
        self.assertEqual(pos[6], mt["attack_positions"][1])
        self.assertEqual(pos[7], mt["attack_positions"][2])
        self.assertEqual(pos[8], mt["attack_positions"][3])

    def test_assign_start_positions_fortress_owner(self):
        calls = []
        orig_assign = room.assign_start_position

        def mock_assign(slot, pos, clicks=1):
            calls.append((slot, pos, clicks))
            return True

        room.assign_start_position = mock_assign
        try:
            slot_positions = {
                1: (0.1, 0.1),
                2: (0.2, 0.2),
                8: (0.8, 0.8),
                5: (0.5, 0.5),
            }
            res = room.assign_start_positions(slot_positions, fortress_owner=8)
            self.assertTrue(res)
            # Первый слот 8 с 8 кликами
            self.assertEqual(calls[0], (8, (0.8, 0.8), 8))
            # Оставшиеся слоты 1, 2, 5 по 1 клику
            remaining_calls = calls[1:]
            self.assertEqual([c[0] for c in remaining_calls], [1, 2, 5])
            self.assertEqual([c[2] for c in remaining_calls], [1, 1, 1])
        finally:
            room.assign_start_position = orig_assign

    def test_ask_map(self):
        with patch("builtins.input", side_effect=["1"]):
            self.assertEqual(main.ask_map(), "westmarch")
        with patch("builtins.input", side_effect=["Минас Тирит"]):
            self.assertEqual(main.ask_map(), "minas_tirith")

    def test_ask_player_role(self):
        with patch("builtins.input", side_effect=["1"]):
            self.assertEqual(main.ask_player_role(), "defender")
        with patch("builtins.input", side_effect=["2"]):
            self.assertEqual(main.ask_player_role(), "attacker")

    def test_ask_fortress_owner(self):
        self.assertEqual(main.ask_fortress_owner([1]), 1)
        with patch("builtins.input", side_effect=["4"]):
            self.assertEqual(main.ask_fortress_owner([1, 2, 4]), 4)


if __name__ == "__main__":
    unittest.main()
