#!/usr/bin/env python3
"""
Генерация 68 __wotr_maps_cache.big — по одному на карту.

Структура результата:
    _wotr_mapcache_build/out/<имя папки карты>/__wotr_maps_cache.big

Внутри каждого .big (SAGE BIGF, упаковка как в bridge/spawn.py::build_big):
    maps\\MapCache.ini  — ровно один блок MapCache для этой карты.

Правки относительно исходного MapCache.ini из AppData:
  * ключ блока: отбрасываем префикс
    c_3A_5C...5Cmaps_5C  ->  maps_5C...
    (было:  MapCache c_3A_5Cusers_5C..._5Cmaps_5C<map>_5C<map>_2Emap
     стало: MapCache maps_5C<map>_5C<map>_2Emap)
  * isOfficial = no  ->  isOfficial = yes
  * displayName: байт '$' (0x24) в исходнике экранирован как '*24*',
    но движок SAGE понимает только '_XX_'-экранирование; нормализуем
    любые '*XX*' -> '_XX_', иначе имя карты в игре не отображается
  * всё остальное (CRC, таймстемпы, InitialCameraPosition, стартовые
    позиции и т.д.) — без изменений.

Запуск:
    python3 make_mapcache_bigs.py                 # собрать все 68
    python3 make_mapcache_bigs.py --only "map wor isengard" "map wor minas morgul"
"""

import argparse
import os
import re
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
sys.path.insert(0, REPO_ROOT)

from bridge.spawn import build_big  # штатный упаковщик .big (BIGF/BIG4)

SOURCE_INI = os.path.join(HERE, "source_MapCache.ini")
OUT_DIR = os.path.join(HERE, "out")
BIG_NAME = "__wotr_maps_cache.big"
INTERNAL_PATH = r"maps\MapCache.ini"
FOURCC = b"BIGF"


def parse_blocks(text):
    """Разбить исходный MapCache.ini на блоки MapCache ... END."""
    blocks = []
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        if lines[i].lstrip().startswith("MapCache "):
            block = [lines[i]]
            i += 1
            while i < len(lines) and lines[i].strip() != "END":
                block.append(lines[i])
                i += 1
            if i < len(lines):
                block.append(lines[i])  # строка END
            blocks.append(block)
        i += 1
    return blocks


_STAR_ESCAPE = re.compile(r"\*([0-9A-Fa-f]{2})\*")


def normalize_sage_string(s):
    """Привести SAGE-строку (displayName/description) к канону движка:
    экранирование байтов только через '_XX_'; '*XX*' -> '_XX_'.

    Кодировка строк — UTF-16LE: ASCII-символ пишется как сам символ +
    '_00', непечатные/служебные байты — как '_XX' + '_00'. Байт '$'
    (0x24) в исходном MapCache.ini записан как '*24*', и игра не
    распознавала ссылку на CSF-ключ имени карты."""
    return _STAR_ESCAPE.sub(r"_\1_", s)


def decode_sage_string(s):
    """Декодировать SAGE-строку ('_XX_00M_00a_00...') в обычный текст.

    Токены '_XX' дают байт XX, голый ASCII-символ — свой байт; младший
    байт каждого UTF-16 code unit формируется так, старший — '_00'."""
    out = bytearray()
    for tok in re.split(r"(_[0-9A-Fa-f]{2})", s):
        if not tok:
            continue
        if tok.startswith("_") and len(tok) == 3:
            out.append(int(tok[1:], 16))
        else:
            out.extend(tok.encode("latin-1"))
    return out.decode("utf-16-le", errors="replace")


def fix_block(block):
    """Вернуть (folder_name, ini_text) для блока, с исправленным ключом,
    isOfficial = yes и нормализованным displayName. Пустые строки внутри
    блока выбрасываем (как в настоящем MapCache.ini игры)."""
    fixed = []
    folder = None
    for line in block:
        if not line.strip():
            continue  # пустые строки внутри блока не нужны
        stripped = line.lstrip()
        indent = line[:len(line) - len(stripped)]
        if stripped.startswith("MapCache "):
            key = stripped.split(None, 1)[1].strip()
            # Оставляем только часть, начиная с maps_5C:
            idx = key.find("maps_5C")
            if idx < 0:
                raise ValueError(f"в ключе нет maps_5C: {key}")
            new_key = key[idx:]
            # maps_5C<folder>_5C<folder>_2Emap -> читаемое имя папки
            m = re.match(r"maps_5C(.+)_5C.+\.map$",
                         new_key.replace("_2E", "."))
            folder_enc = m.group(1)
            folder = folder_enc.replace("_20", " ")
            fixed.append(f"MapCache {new_key}")
        elif stripped.startswith("isOfficial"):
            fixed.append("  isOfficial = yes")
        elif stripped.startswith("displayName"):
            field, _, value = stripped.partition(" = ")
            fixed.append(f"{indent}{field} = {normalize_sage_string(value)}")
        else:
            fixed.append(line.rstrip("\r\n"))
    ini = "\n".join(fixed).rstrip() + "\n"
    return folder, ini


def unpack_big(big_path):
    """Прочитать готовый .big: (fourcc, data_start, [(name, off, size)], data).

    Раскладка по OpenSAGE (src/OpenSage.FileFormats.Big/BigArchive.cs):
    заголовок 16 байт: FourCC | archive_size(BE) | num_entries(BE) |
    data_start(BE); сразу после заголовка — таблица входов, затем данные.
    """
    with open(big_path, "rb") as f:
        data = f.read()
    fourcc = data[0:4]
    num = struct.unpack(">I", data[8:12])[0]
    data_start = struct.unpack(">I", data[12:16])[0]
    entries = []
    pos = 16
    for _ in range(num):
        eoff = struct.unpack(">I", data[pos:pos + 4])[0]
        esize = struct.unpack(">I", data[pos + 4:pos + 8])[0]
        pos += 8
        null = data.find(b"\x00", pos)
        name = data[pos:null].decode("latin-1")
        pos = null + 1
        entries.append((name, eoff, esize))
    return fourcc, data_start, entries, data


def validate(folder, big_path):
    """Проверить собранный big. Вернуть список ошибок (пустой — ОК)."""
    errs = []
    fourcc, data_start, entries, data = unpack_big(big_path)
    if fourcc != FOURCC:
        errs.append(f"fourcc={fourcc!r}")
    if len(entries) != 1:
        errs.append(f"записей {len(entries)} вместо 1")
        return errs
    name, eoff, esize = entries[0]
    if name != INTERNAL_PATH:
        errs.append(f"имя внутри {name!r}")
    if eoff != data_start or eoff + esize != len(data):
        errs.append(f"смещения не сходятся: off={eoff} start={data_start} "
                    f"size={esize} file={len(data)}")
    payload = data[eoff:eoff + esize].decode("latin-1")
    if "c_3A_5Cusers" in payload:
        errs.append("остался пользовательский префикс c_3A_...")
    if not re.search(r"^MapCache maps_5C" +
                     re.escape(folder.replace(" ", "_20")) + r"_5C",
                     payload, re.M):
        errs.append("ключ не соответствует папке карты")
    if not re.search(r"^\s*isOfficial\s*=\s*yes\s*$", payload, re.M):
        errs.append("isOfficial != yes")
    if "isOfficial = no" in payload:
        errs.append("осталось isOfficial = no")
    if payload.count("MapCache ") != 1 or not payload.rstrip().endswith("END"):
        errs.append("в ini не ровно один корректный блок")
    if len(re.findall(r"Player_\d_Start", payload)) != 8:
        errs.append("не 8 стартовых позиций")
    if "*" in payload:
        errs.append("остались '*XX*'-экранирования (должно быть '_XX_')")
    # displayName должен декодироваться в ссылку на CSF-ключ $Map:<map>
    m = re.search(r"^\s*displayName\s*=\s*(.+?)\s*$", payload, re.M)
    if not m:
        errs.append("нет displayName")
    else:
        name = decode_sage_string(m.group(1))
        expect = "$Map:" + folder.replace(" ", "").lower()
        if name != expect:
            errs.append(f"displayName декодируется в {name!r}, ожидалось {expect!r}")
    return errs


def main(argv=None):
    ap = argparse.ArgumentParser(description="собрать __wotr_maps_cache.big по картам")
    ap.add_argument("--only", nargs="*", metavar="FOLDER",
                    help="собрать только указанные папки карт")
    args = ap.parse_args(argv)

    with open(SOURCE_INI, "r", encoding="latin-1") as f:
        text = f.read()

    blocks = parse_blocks(text)
    print(f"[mapcache] найдено блоков MapCache: {len(blocks)}")

    os.makedirs(OUT_DIR, exist_ok=True)
    only = set(args.only) if args.only else None
    seen = set()
    built = 0
    bad = 0

    for block in blocks:
        folder, ini = fix_block(block)
        if folder in seen:
            raise ValueError(f"дубликат папки карты: {folder}")
        seen.add(folder)
        if only is not None and folder not in only:
            continue

        map_dir = os.path.join(OUT_DIR, folder)
        os.makedirs(map_dir, exist_ok=True)
        big_path = os.path.join(map_dir, BIG_NAME)

        big = build_big(FOURCC, [(INTERNAL_PATH, ini.encode("latin-1"))])
        with open(big_path, "wb") as f:
            f.write(big)
        built += 1

        errs = validate(folder, big_path)
        if errs:
            bad += 1
            print(f"  FAIL {folder}: {'; '.join(errs)}")

    print(f"[mapcache] собрано big-файлов: {built}, ошибок: {bad}")
    if bad:
        return 1
    print(f"[mapcache] проверка пройдена для всех собранных файлов")
    return 0


if __name__ == "__main__":
    sys.exit(main())
