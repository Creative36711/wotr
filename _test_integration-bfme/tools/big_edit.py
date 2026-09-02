#!/usr/bin/env python3
"""
Инструмент для редактирования .big-файлов (SAGE-архив, BFME2:RotWK).

ТЕСТОВАЯ ЗАДАЧА:
  Открыть C:\\RotWK\\__wotr_ini.big, найти data\\ini\\object\\system\\systemwotr.ini,
  внутри объекта `Object WOTRTemporaryVictoryAnchor` заменить отряд
  GondorFighterHorde -> GondorArcherHorde.

ФОРМАТ .big (по OpenSAGE):
  Заголовок (16 байт):
      0  FourCC           4 байта  "BIGF" / "BIG4"
      4  Size             uint32   little-endian  (полный размер архива)
      8  NumEntries       uint32   big-endian
     12  OffsetFirst      uint32   big-endian  (смещение до списка входов)
  Список входов (начинается в OffsetFirst), по одному на файл:
      EntryOffset  uint32  big-endian  (смещение данных файла в архиве)
      EntrySize    uint32  big-endian  (размер данных файла)
      EntryName    CString (null-terminated путь, напр. data\\ini\\...)
  После входов — сырые данные файлов (без сжатия, один за другим).

ПРАВИЛО РЕДАКТИРОВАНИЯ:
  Если новая строка ТОЙ ЖЕ длины, что старая — перезаписываем байты на месте
  (структура архива не меняется). Если длина ИНАЯ — нужна пересборка архива
  (отдельный режим). В этой задаче обе строки по 17 символов — правка на месте.

Запуск (на машине с игрой):
    python tools\\big_edit.py
"""

import struct
import sys

# --- Параметры задачи ------------------------------------------------------
BIG_PATH = r"C:\RotWK\__wotr_ini.big"
INTERNAL_PATH = "systemwotr.ini"          # ищем по суффиксу имени внутри архива
OBJECT_NAME = b"Object WOTRTemporaryVictoryAnchor"
OLD = b"GondorFighterHorde"
NEW = b"GondorArcherHorde"


# --- Парсинг .big ----------------------------------------------------------
def hexdump(b, n=64):
    return " ".join(f"{x:02x}" for x in b[:n])


def read_entries(big_path):
    """Вернуть список (name, offset, size) для всех файлов архива."""
    with open(big_path, "rb") as f:
        data = f.read()

    if len(data) < 16:
        raise ValueError("файл слишком короткий — это не .big")

    fourcc = data[0:4]
    print(f"[diag] первые 64 байта файла:\n  {hexdump(data)}")

    # Size — LE, NumEntries/OffsetFirst — BE.
    size = struct.unpack("<I", data[4:8])[0]
    num = struct.unpack(">I", data[8:12])[0]
    first = struct.unpack(">I", data[12:16])[0]
    print(f"[diag] fourcc={fourcc!r}  size={size}  num_entries={num}  "
          f"offset_first={first}  (реальный размер файла={len(data)})")

    if fourcc not in (b"BIGF", b"BIG4"):
        raise ValueError(f"неверная сигнатура: {fourcc!r} (ожидалась BIGF/BIG4)")

    # Некоторые .big хранят смещение до первого входа в поле OffsetFirst,
    # другие — до конца списка. Пробуем оба: сначала first, при неудаче 16.
    for candidate in (first, 16):
        try:
            entries = _parse_entries(data, candidate, num)
            print(f"[diag] список входов разобран со смещения {candidate}: "
                  f"{len(entries)} файлов")
            return entries, size
        except Exception as e:
            print(f"[diag] разбор со смещения {candidate} не удался: {e}")
    raise ValueError("не удалось разобрать список входов (см. [diag] выше)")


def _parse_entries(data, start, num):
    entries = []
    pos = start
    for _ in range(num):
        if pos + 8 > len(data):
            raise ValueError(f"вход обрезан на позиции {pos}")
        eoff = struct.unpack(">I", data[pos:pos + 4])[0]
        esize = struct.unpack(">I", data[pos + 4:pos + 8])[0]
        pos += 8
        # имя — null-terminated
        null = data.find(b"\x00", pos)
        if null < 0:
            raise ValueError(f"нет null-терминатора имени на позиции {pos}")
        name = data[pos:null].decode("latin-1", errors="replace")
        pos = null + 1
        entries.append((name, eoff, esize))
    return entries


def read_entry_data(big_path, offset, size):
    with open(big_path, "rb") as f:
        f.seek(offset)
        return f.read(size)


def write_entry_data(big_path, offset, data):
    """Перезаписать байты на месте (только если длина совпадает)."""
    with open(big_path, "r+b") as f:
        f.seek(offset)
        f.write(data)


# --- Основная задача -------------------------------------------------------
def main():
    print(f"[big] читаю {BIG_PATH} ...")
    entries, archive_size = read_entries(BIG_PATH)
    print(f"[big] файлов в архиве: {len(entries)}")

    target = None
    for name, off, sz in entries:
        if INTERNAL_PATH.lower() in name.lower():
            target = (name, off, sz)
            break
    if target is None:
        print(f"ERROR: не найден файл {INTERNAL_PATH!r} в архиве", file=sys.stderr)
        print("Содержимое архива (первые 30 имён):")
        for name, _, _ in entries[:30]:
            print("   ", name)
        return 1

    name, off, sz = target
    print(f"[big] найден: {name}  (offset={off}, size={sz})")

    content = read_entry_data(BIG_PATH, off, sz)

    # Проверяем, что объект и старая строка действительно есть.
    obj_pos = content.find(OBJECT_NAME)
    if obj_pos < 0:
        print(f"ERROR: объект {OBJECT_NAME.decode()!r} не найден в файле",
              file=sys.stderr)
        return 1

    old_pos = content.find(OLD, obj_pos)   # ищем именно внутри объекта
    if old_pos < 0:
        print(f"ERROR: строка {OLD.decode()!r} не найдена в объекте",
              file=sys.stderr)
        return 1

    if len(OLD) != len(NEW):
        print(f"ERROR: длины строк различаются ({len(OLD)} vs {len(NEW)}) — "
              f"нужна пересборка архива, а не правка на месте", file=sys.stderr)
        return 1

    print(f"[big] объект найден @ {obj_pos}, строка @ {old_pos}")
    print(f"[big] было:   {OLD.decode()}")
    print(f"[big] станет: {NEW.decode()}")

    new_content = content[:old_pos] + NEW + content[old_pos + len(OLD):]
    write_entry_data(BIG_PATH, off, new_content)

    # Проверка.
    check = read_entry_data(BIG_PATH, off, sz)
    if check.find(NEW, obj_pos) >= 0 and check.find(OLD, obj_pos) < 0:
        print("[big] УСПЕХ: строка заменена, проверка пройдена.")
        return 0
    print("ERROR: проверка после записи не прошла", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
