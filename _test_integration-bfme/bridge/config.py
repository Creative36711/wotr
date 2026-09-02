#!/usr/bin/env python3
"""
Config file paths and load/save helpers.

Paths are computed from this file's location, NOT the current working
directory — so they stay correct no matter where you run the scripts from.

ЗАПУСК ИЗ СОБРАННОГО EXE (PyInstaller):
  В однофайловом exe исходники распаковываются во временную папку
  (sys._MEIPASS), которая удаляется при выходе. Писать туда маркеры
  бессмысленно, поэтому:
    * BASE_DIR / CONFIG_DIR  — папка, где ЛЕЖИТ exe (туда пишем);
    * BUNDLED_CONFIG_DIR     — копия config/ внутри exe (оттуда читаем,
                               если рядом с exe файла ещё нет).
  Так exe работает «из коробки», а пользователь может переопределить
  config.json, положив свой рядом с exe.
"""

import json
import os
import sys


def is_frozen():
    """True, если код выполняется внутри собранного exe (PyInstaller)."""
    return bool(getattr(sys, "frozen", False))


def _base_dir():
    """Папка приложения: корень проекта (исходники) или папка exe."""
    if is_frozen():
        return os.path.dirname(os.path.abspath(sys.executable))
    # integration/  (one level above bridge/)
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _bundled_config_dir():
    """Папка config/ внутри exe (None при запуске из исходников)."""
    bundle = getattr(sys, "_MEIPASS", None)
    return os.path.join(bundle, "config") if bundle else None


BASE_DIR = _base_dir()
CONFIG_DIR = os.path.join(BASE_DIR, "config")

CONFIG_FILE = os.path.join(CONFIG_DIR, "config.json")          # game path / args
POSITIONS_FILE = os.path.join(CONFIG_DIR, "menu_positions.json")  # button coords
MAPS_FILE = os.path.join(CONFIG_DIR, "maps.json")                  # map coordinates

BUNDLED_CONFIG_DIR = _bundled_config_dir()


def resolve(path):
    """Путь к файлу данных: сначала рядом с приложением, потом копия в exe."""
    if os.path.exists(path):
        return path
    if BUNDLED_CONFIG_DIR:
        bundled = os.path.join(BUNDLED_CONFIG_DIR, os.path.basename(path))
        if os.path.exists(bundled):
            return bundled
    return path


def ensure_config_dir():
    """Создать папку config/ рядом с приложением (нужна для записи маркеров)."""
    os.makedirs(CONFIG_DIR, exist_ok=True)
    return CONFIG_DIR


def load_json(path, default=None):
    path = resolve(path)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return default if default is not None else {}


def save_json(path, data):
    """Сохранить данные в JSON файл с отступами."""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return path


def load_config():
    """Load config.json (game path, launch args)."""
    return load_json(CONFIG_FILE, {})


def load_positions():
    """Load menu_positions.json (button coords)."""
    return load_json(POSITIONS_FILE, {})


def load_maps():
    """Load maps.json (map definitions & coordinates)."""
    return load_json(MAPS_FILE, {})
