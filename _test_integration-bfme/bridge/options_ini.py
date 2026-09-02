#!/usr/bin/env python3
"""
Чтение/запись Options.ini (графические настройки игры).

Файл лежит в %APPDATA%\\My Rise of the Witch-king Files\\Options.ini.

Нужен калибратору: перед запуском в окне мы временно снижаем Resolution,
чтобы окно игры гарантированно помещалось на экране (и координаты доли окна
снимались корректно), а после запуска возвращаем прежнее значение.

Кодировка: побайтово через latin-1, чтобы не повредить существующие байты.

Использует тот же механизм определения APPDATA, что и network_prefs.py
(устойчиво к UAC-повышению).
"""

import os
from pathlib import Path

from bridge import network_prefs as _nprefs

DEFAULT_FOLDER = "My Rise of the Witch-king Files"
DEFAULT_FILENAME = "Options.ini"


def options_path(folder=None, filename=None):
    """Полный путь к Options.ini."""
    folder = folder or DEFAULT_FOLDER
    filename = filename or DEFAULT_FILENAME
    return Path(_nprefs._appdata()) / folder / filename


def _is_key(line, key):
    """True, если строка задаёт настройку key (формат `Key = value`)."""
    s = line.strip().lower()
    k = key.lower()
    if s == k:
        return True
    return s.startswith(k) and len(s) > len(k) and s[len(k)] in " =\t"


def read_option(key, folder=None, filename=None):
    """Прочитать значение настройки key из Options.ini (или None)."""
    path = Path(options_path(folder, filename))
    if not path.exists():
        return None
    text = path.read_bytes().decode("latin-1", errors="replace")
    for line in text.splitlines():
        if not line.strip() or "=" not in line:
            continue
        if _is_key(line, key):
            return line.split("=", 1)[1].strip()
    return None


def set_option(key, value, folder=None, filename=None):
    """Записать значение настройки key (создать файл, если нет)."""
    path = Path(options_path(folder, filename))
    path.parent.mkdir(parents=True, exist_ok=True)

    if path.exists():
        lines = path.read_bytes().decode("latin-1", errors="replace").splitlines()
    else:
        lines = []

    out = []
    written = False
    for ln in lines:
        if _is_key(ln, key):
            out.append(f"{key} = {value}")
            written = True
        else:
            out.append(ln)
    if not written:
        out.append(f"{key} = {value}")

    content = "\n".join(out)
    if content:
        content += "\n"
    path.write_bytes(content.encode("latin-1"))
    return str(path)
