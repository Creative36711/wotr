#!/usr/bin/env python3
"""
Подготовка настроек сетевой игры БОЯ ПЕРЕД запуском игры.

BFME2:RotWK хранит настройки (правила, фракция игрока, цвет) в файле:

    %APPDATA%\\My Rise of the Witch-king Files\\NetworkPref.ini

в строках вида:

    Rts:Rules          = 0 0 0 400 1000 -1 -1 -1 -1 -1
    Rts:PlayerTemplate = 6
    Rts:Color          = 0

Файл нужно готовить ДО запуска игры — она читает его при старте. Модуль умеет:
  * создавать папку и файл, если их нет;
  * заменять нужные строки, не трогая остальные настройки;
  * добавлять недостающие строки в конец.

Кодировка: побайтово через latin-1, чтобы не повредить существующие байты.

APPDATA И ПОВЫШЕНИЕ ПРИВИЛЕГИЙ (UAC):
  При elevate.ensure_admin() скрипт перезапускается от имени администратора.
  Переменная %APPDATA% после UAC может указывать на ДРУГОЙ профиль
  (Administrator), а не на профиль реального пользователя. Игра пишет
  NetworkPref.ini в профиль ТОГО пользователя, который её запускает.

  Стратегия поиска (от надёжной к запасной):
    1. Переменная окружения _REAL_APPDATA (если main.py сохранил до elevate).
    2. Win32 SHGetKnownFolderPath(FOLDERID_RoamingAppData) — всегда текущий
       пользователь, даже после UAC.
    3. Обычная %APPDATA% (fallback).
    4. Прямой поиск: перебираем C:\\Users\\*\\AppData\\Roaming\\<folder> и ищем
       папку, где уже есть NetworkPref.ini или Options.ini.

  Логика кэширует результат при первом вызове.
"""

import ctypes
import os
from pathlib import Path

from bridge.log import log

DEFAULT_FOLDER = "My Rise of the Witch-king Files"
DEFAULT_FILENAME = "NetworkPref.ini"

# Rts:Rules — 10 значений через пробел (подробности в README).
DEFAULT_RULES = "0 0 0 400 1000 -1 -1 -1 -1 -1"

# Rts:PlayerTemplate — фракция.
PLAYER_TEMPLATES = {
    "random":    -1,   # Случайно
    "men":        3,   # Люди
    "elves":      5,   # Эльфы
    "dwarves":    6,   # Гномы
    "isengard":   7,   # Изенгард
    "mordor":     8,   # Мордор
    "goblins":    9,   # Гоблины
    "angmar":    10,   # Ангмар
    "spectator": -2,   # Зритель
}

# Rts:Color — цвет игрока.
COLORS = {
    "random":     -1,  # случайно
    "blue":        0,  # синий
    "red":         1,  # красный
    "yellow":      2,  # жёлтый
    "green":       3,  # зелёный
    "orange":      4,  # оранжевый
    "light_blue":  5,  # голубой
    "purple":      6,  # фиолетовый
    "pink":        7,  # розовый
    "black":       8,  # чёрный
    "white":       9,  # белый
}

# Фракция -> цвет игрока (автоматическая привязка).
FACTION_COLORS = {
    "men":      "blue",     # Люди — синий
    "elves":    "green",    # Эльфы — зелёный
    "dwarves":  "yellow",   # Гномы — жёлтый
    "isengard": "white",    # Изенгард — БЕЛЫЙ (чёрный не видно на тёмном графике)
    "mordor":   "red",      # Мордор — красный
    "goblins":  "orange",   # Гоблины — оранжевый
    "angmar":   "purple",   # Ангмар — фиолетовый
}


# ---------------------------------------------------------------------------
# Надёжное определение APPDATA (устойчиво к UAC-повышению)
# ---------------------------------------------------------------------------
_cached_appdata = None


def _shget_appdata():
    """Получить Roaming AppData через Win32 SHGetKnownFolderPath.

    Работает корректно даже после UAC-повышения: возвращает путь
    текущего пользователя (того, от чьего имени запущен процесс).
    На не-Windows возвращает None.
    """
    try:
        import ctypes.wintypes
        shell32 = ctypes.windll.shell32
        ole32 = ctypes.windll.ole32

        # FOLDERID_RoamingAppData = {3EB685DB-65F9-4CF6-A03A-E3EF65729F3D}
        class GUID(ctypes.Structure):
            _fields_ = [
                ("Data1", ctypes.c_ulong),
                ("Data2", ctypes.c_ushort),
                ("Data3", ctypes.c_ushort),
                ("Data4", ctypes.c_ubyte * 8),
            ]

        FOLDERID_RoamingAppData = GUID(
            0x3EB685DB, 0x65F9, 0x4CF6,
            (ctypes.c_ubyte * 8)(0xA0, 0x3A, 0xE3, 0xEF, 0x65, 0x72, 0x9F, 0x3D)
        )

        path_ptr = ctypes.c_wchar_p()
        hr = shell32.SHGetKnownFolderPath(
            ctypes.byref(FOLDERID_RoamingAppData),
            0,      # dwFlags = 0 (current user)
            None,   # hToken = NULL (current user token)
            ctypes.byref(path_ptr)
        )
        if hr == 0 and path_ptr.value:
            result = path_ptr.value
            ole32.CoTaskMemFree(path_ptr)
            return result
    except Exception:
        pass
    return None


def _scan_users_for_folder(folder_name):
    """Перебрать C:\\Users\\*\\AppData\\Roaming\\<folder> и найти существующую.

    Ищет папку, содержащую NetworkPref.ini или Options.ini (признак того,
    что игра уже запускалась из-под этого пользователя).
    """
    users_dir = Path(os.environ.get("SystemDrive", "C:")) / "Users"
    if not users_dir.is_dir():
        return None

    markers = ["NetworkPref.ini", "Options.ini"]
    for user_dir in users_dir.iterdir():
        candidate = user_dir / "AppData" / "Roaming" / folder_name
        if candidate.is_dir():
            for m in markers:
                if (candidate / m).exists():
                    log(f"[prefs] найдена папка игры: {candidate}")
                    return str(candidate.parent)  # возвращаем Roaming
    # если файлов нет, но папка существует — берём первую найденную
    for user_dir in users_dir.iterdir():
        candidate = user_dir / "AppData" / "Roaming" / folder_name
        if candidate.is_dir():
            log(f"[prefs] найдена папка (без маркеров): {candidate}")
            return str(candidate.parent)
    return None


def _resolve_appdata():
    """Определить правильный APPDATA (один раз, результат кэшируется).

    Порядок:
      1. _REAL_APPDATA (сохранён main.py до elevate)
      2. SHGetKnownFolderPath (Win32 API)
      3. %APPDATA% (переменная окружения)
      4. Сканирование C:\\Users\\*\\... (последний шанс)
    """
    # 1. Переданный из main.py (до UAC-повышения)
    real = os.environ.get("_REAL_APPDATA")
    if real and os.path.isdir(real):
        log(f"[prefs] APPDATA из _REAL_APPDATA: {real}")
        return real

    # 2. Win32 API (надёжно, текущий пользователь)
    shget = _shget_appdata()
    if shget and os.path.isdir(shget):
        log(f"[prefs] APPDATA из SHGetKnownFolderPath: {shget}")
        return shget

    # 3. Переменная окружения (может быть неверной после UAC)
    env = os.environ.get("APPDATA")
    if env and os.path.isdir(env):
        # Проверим, есть ли там папка игры
        game_dir = os.path.join(env, DEFAULT_FOLDER)
        if os.path.isdir(game_dir):
            log(f"[prefs] APPDATA из окружения (папка найдена): {env}")
            return env
        # Папки нет — может быть профиль админа, попробуем сканирование
        log(f"[prefs] APPDATA из окружения, но папки игры нет: {env}")

    # 4. Сканирование пользовательских профилей
    scanned = _scan_users_for_folder(DEFAULT_FOLDER)
    if scanned:
        return scanned

    # 5. Если ничего не нашли, возвращаем %APPDATA% как есть
    if env:
        log(f"[prefs] APPDATA fallback: {env}")
        return env

    raise OSError(
        "Не удалось определить APPDATA. Переменная окружения не задана, "
        "Win32 API недоступен, папка игры не найдена при сканировании.")


def _appdata():
    """Кэширующая обёртка над _resolve_appdata()."""
    global _cached_appdata
    if _cached_appdata is None:
        _cached_appdata = _resolve_appdata()
    return _cached_appdata


def save_real_appdata():
    """Сохранить текущий %APPDATA% в _REAL_APPDATA (вызвать ДО elevate).

    После elevate.ensure_admin() %APPDATA% может указывать на профиль
    администратора. Эта функция сохраняет НАСТОЯЩИЙ путь, чтобы
    _resolve_appdata() нашла его первым.
    """
    appdata = os.environ.get("APPDATA")
    if appdata:
        os.environ["_REAL_APPDATA"] = appdata


def prefs_path(folder=None, filename=None):
    """Полный путь к NetworkPref.ini (по умолчанию — в %APPDATA%)."""
    folder = folder or DEFAULT_FOLDER
    filename = filename or DEFAULT_FILENAME
    return Path(_appdata()) / folder / filename


def _is_key(line, key):
    """True, если строка line задаёт настройку key (формат `Key = value`)."""
    s = line.strip().lower()
    k = key.lower()
    if s == k:
        return True
    return s.startswith(k) and len(s) > len(k) and s[len(k)] in " =\t"


def apply_settings(settings, folder=None, filename=None):
    """
    Записать набор настроек {ключ: значение} в NetworkPref.ini.

    Существующие строки с теми же ключами заменяются, остальные не трогаются;
    отсутствующие ключи дописываются в конец. Возвращает путь к файлу.
    """
    path = Path(prefs_path(folder, filename))
    path.parent.mkdir(parents=True, exist_ok=True)

    if path.exists():
        lines = path.read_bytes().decode("latin-1", errors="replace").splitlines()
    else:
        lines = []

    out = []
    written = set()
    for ln in lines:
        replaced = False
        for key, val in settings.items():
            if key not in written and _is_key(ln, key):
                out.append(f"{key} = {val}")
                written.add(key)
                replaced = True
                break
        if not replaced:
            out.append(ln)

    for key, val in settings.items():
        if key not in written:
            out.append(f"{key} = {val}")
            written.add(key)

    content = "\n".join(out)
    if content:
        content += "\n"
    path.write_bytes(content.encode("latin-1"))

    for key, val in settings.items():
        log(f"[prefs] {key} = {val}")
    log(f"[prefs] -> {path}")
    return str(path)


# ---------------------------------------------------------------------------
# Резолв значений (имя или число -> код)
# ---------------------------------------------------------------------------
def _resolve(table, value):
    if value is None:
        return None
    if isinstance(value, str):
        if value in table:
            return table[value]
        try:
            return int(value)
        except ValueError:
            return None
    if isinstance(value, int):
        return value
    return None


def resolve_template(value):
    return _resolve(PLAYER_TEMPLATES, value)


def resolve_color(value):
    return _resolve(COLORS, value)


def settings_for_faction(rules, template_key):
    """Настройки игрока: правила + фракция + авто-цвет по фракции."""
    settings = {}
    if rules:
        settings["Rts:Rules"] = str(rules).strip()
    pt = resolve_template(template_key)
    if pt is not None:
        settings["Rts:PlayerTemplate"] = str(pt)
    color = FACTION_COLORS.get(template_key)
    if color is not None:
        c = resolve_color(color)
        if c is not None:
            settings["Rts:Color"] = str(c)
    return settings
