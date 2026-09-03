#!/usr/bin/env python3
"""One-shot importer: assign BFME MapCache BIGs + calibrated start coordinates
from _test_integration-bfme/_wotr_build to the Vanilla 2.01 default mod.

- copies each assigned cache to public/mods/default/rts/map-caches/locations/<locationId>.big
- writes rtsMapCache metadata + rtsPositions (defense 4 / attack 4) into world.json
- prints the unmatched-map report (kept for README/commit notes)
"""
import json, os, re, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, '_test_integration-bfme', '_wotr_build')
OUT = os.path.join(BUILD, 'out')
COORDS = os.path.join(BUILD, 'coordinates')
WORLD = os.path.join(ROOT, 'public', 'mods', 'default', 'world.json')
CACHE_DIR = os.path.join(ROOT, 'public', 'mods', 'default', 'rts', 'map-caches', 'locations')

# map key (folder name in out/) -> (locationId, comment)
ASSIGN = {
    # --- War of the Ring world maps ---
    'map wor ang angmar':        ('angmar-foothills', 'регион Ангмара представлен локацией «Предгорья Ангмара»'),
    'map wor ang barrow downs':  ('barrow-downs', ''),
    'map wor ang carn dum':      ('carn-dum', ''),
    'map wor ang fornost':       ('fornost', ''),
    'map wor ang gundabad':      ('gundabad', 'Mount Gundabad'),
    'map wor ang north downs':   ('north-downs', ''),
    'map wor ang rhudaur':       ('map-object-mt9cljvs', 'Рудаур'),
    'map wor belfalas':          ('belfalas', ''),
    'map wor black gate':        ('morannon', 'Black Gate = Мораннон'),
    'map wor cair andros':       ('cair-andros', ''),
    'map wor cardolan':          ('map-object-mt9cmrxz', 'Кардолан'),
    'map wor carrock':           ('map-object-mt9e95o3', 'Каррок'),
    'map wor dagorlad':          ('dagorlad', ''),
    'map wor dead marshes':      ('dead-marshes', ''),
    'map wor dol guldur':        ('dol-guldur', ''),
    'map wor dunland':           ('dunland-highlands', 'регион Дунланд представлен локацией «Дунландские нагорья»'),
    'map wor enedwaith':         ('enedwaith-plains', 'Равнины Энедвайта'),
    'map wor erebor':            ('erebor', ''),
    'map wor ettenmoors':        ('ettenmoors', ''),
    'map wor fangorn':           ('fangorn', ''),
    'map wor forlindon':         ('forlindon', ''),
    'map wor forodwaith':        ('map-object-mt9e41m0', 'Фородвайт'),
    'map wor gap of rohan':      ('gap-of-rohan', ''),
    'map wor grey havens':       ('mithlond', 'Grey Havens = Митлонд'),
    'map wor harlindon':         ('harlindon', ''),
    'map wor helms deep':        ('helms-deep', ''),
    'map wor high pass':         ('high-pass', ''),
    'map wor iron hills':        ('iron-hills', ''),
    'map wor isengard':          ('isengard', ''),
    'map wor lorien':            ('lothlorien', 'Lórien = Лотлориэн'),
    'map wor minas morgul':      ('minas-morgul', ''),
    'map wor minas tirith':      ('minas-tirith', ''),
    'map wor minhiriath':        ('minhiriath', ''),
    'map wor mount doom':        ('orodruin', 'Mount Doom = Ородруин'),
    'map wor osgiliath':         ('osgiliath', ''),
    'map wor redhorn pass':      ('redhorn-pass', ''),
    'map wor rivendell':         ('rivendell', ''),
    'map wor shire':             ('shire', 'The Shire'),
    'map wor tower hills':       ('tower-hills', ''),
    # --- multiplayer maps that match a single location ---
    'map mp anfalas':            ('anfalas', ''),
    'map mp argonath':           ('argonath', ''),
    'map mp brown lands':        ('brown-lands', ''),
    'map mp fords of isen ii':   ('fords-of-isen', 'Fords of Isen II'),
    'map mp grey mountains':     ('ered-mithrin', 'Grey Mountains = Эред Митрин'),
    'map mp paths of the dead':  ('paths-of-the-dead', ''),
    'map mp tournament udun':    ('udun', 'турнирная версия Удуна'),
    'map mp tournament westmarch': ('map-object-mt9dzg03', 'Westmarch = Западная марка'),
    'map mp weathertop':         ('amon-sul', 'Weathertop = Amon Sûl (mp-версия карты)'),
    'map mp umbar':              ('umbar', ''),
    'map mp weather hills':      ('weather-hills', ''),
    'map mp withered heath':     ('withered-heath', ''),
}

UNMATCHED = {
    'map wor arnor':        'область Арнор: на глобальной карте нет отдельной локации «Арнор» (есть Артедайн/Кардолан/Рудаур, у Кардолана и Рудаура свои карты)',
    'map wor buckland':     'Бакленд отсутствует на глобальной карте',
    'map wor celduin':      'река Келдуин не представлена отдельной локацией',
    'map wor gondor':       'имя региона Гондор; отдельной локации «Гондор» нет (Минас Тирит и Дол Амрот имеют собственные карты — карты Гондора у нас нет)',
    'map wor harad':        'двусмысленно: на карте есть «Ближний Харад» и «Дальний Харад», отдельной локации «Харад» нет',
    'map wor ithilien':     'имя региона Итилиэн; есть «Северный Итилиэн» и «Южный Итилиэн» — без калибровки не выбрать',
    'map wor lostriand':    'карта «Лострианд» не соответствует ни одной локации глобальной карты',
    'map wor mirkwood':     'имя региона Лихолесье; есть Северное/Южное Лихолесье, Горы Лихолесья и Чертоги Трандуила — без калибровки не выбрать',
    'map wor mordor':       'имя региона Мордор; отдельной локации «Мордор» нет (Барад-дур, Горгорот и Ородруин — другие карты)',
    'map wor rhun':         'имя региона Рун; есть «Море Рун» и «Прирунье» — без калибровки не выбрать',
    'map wor rohan':        'имя региона Рохан; отдельной локации «Рохан» нет (Эдорас и Хельмова Падь имеют собственные карты)',
    'map wor ang amon sul':  'дубль: Заверти назначена mp-версия map mp weathertop',
    'map mp amon sul fortress': 'дубль: Заверти назначена mp-версия map mp weathertop',
    'map mp harlindon':     'дубль: Харлиндону уже назначена карта map wor harlindon',
    'map mp tournament gundabad': 'дубль: Гундабаду уже назначена карта map wor ang gundabad',
    'map mp fall back 4p':  'турнирная карта без соответствия на глобальной карте',
    'map mp the heubris':   'турнирная карта без соответствия на глобальной карте',
    'map mp tournament mp1':'универсальная турнирная карта без соответствия на глобальной карте',
}

def parse_cache(path):
    data = open(path, 'rb').read()
    text = data.decode('latin1')
    key = re.search(r'MapCache\s+(\S+)', text).group(1).strip()
    map_path = re.sub(r'_([0-9a-fA-F]{2})', lambda m: chr(int(m.group(1), 16)), key)
    map_name = map_path.split('\\')[-1].replace('.map', '')
    num_players = int(re.search(r'numPlayers\s*=\s*(\d+)', text).group(1))
    starts = [{'slot': int(m[0]), 'x': float(m[1]), 'y': float(m[2]), 'z': float(m[3])}
              for m in re.findall(r'Player_(\d+)_Start\s*=\s*X:([-\d.]+)\s+Y:([-\d.]+)\s+Z:([-\d.]+)', text)]
    return {'cacheKey': key, 'mapPath': map_path, 'mapName': map_name,
            'numPlayers': num_players, 'playerStarts': starts, 'size': len(data)}

def parse_coords(map_key):
    path = os.path.join(COORDS, map_key + '.txt')
    if not os.path.isfile(path):
        return None
    points = []
    for line in open(path, encoding='utf-8'):
        m = re.search(r'frac=\(([-\d.]+),\s*([-\d.]+)\)', line)
        if m:
            points.append((round(float(m.group(1)), 4), round(float(m.group(2)), 4)))
    if len(points) < 8:
        return None
    points = points[-8:]  # последняя полная калибровочная сессия
    return points

def main():
    world = json.load(open(WORLD, encoding='utf-8'))
    by_id = {l['id']: l for l in world['locations']}
    os.makedirs(CACHE_DIR, exist_ok=True)
    report, assigned = [], 0
    for map_key, (location_id, note) in sorted(ASSIGN.items()):
        location = by_id.get(location_id)
        if not location:
            report.append(f'!! {map_key}: локация {location_id} не найдена в world.json')
            continue
        cache_path = os.path.join(OUT, map_key, '__wotr_maps_cache.big')
        if not os.path.isfile(cache_path):
            report.append(f'!! {map_key}: файл кэша отсутствует')
            continue
        meta = parse_cache(cache_path)
        shutil.copyfile(cache_path, os.path.join(CACHE_DIR, f'{location_id}.big'))
        location['rtsMapId'] = meta['mapPath']
        location['rtsMapCache'] = {
            'assetId': location_id,
            'originalFileName': '__wotr_maps_cache.big',
            'storageName': f'rts/map-caches/locations/{location_id}.big',
            'size': meta['size'],
            'cacheKey': meta['cacheKey'],
            'mapPath': meta['mapPath'],
            'mapName': meta['mapName'],
            'numPlayers': meta['numPlayers'],
            'playerStarts': meta['playerStarts'],
        }
        points = parse_coords(map_key)
        if points:
            location['rtsPositions'] = {
                'defense': [{'x': x, 'y': y} for x, y in points[:4]],
                'attack': [{'x': x, 'y': y} for x, y in points[4:8]],
            }
        else:
            report.append(f'~  {map_key}: кэш назначен, но координаты не найдены/неполные')
        assigned += 1
    # чистим rts-поля у локаций без кэша (совместимость версий не сохраняем)
    for location in world['locations']:
        if location['id'] not in ASSIGN.values() and location['id'] not in {v[0] for v in ASSIGN.values()}:
            location['rtsMapId'] = ''
            location['rtsMapCache'] = None
            if 'rtsPositions' in location:
                del location['rtsPositions']
    world['version'] = 43
    json.dump(world, open(WORLD, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'Назначено кэшей: {assigned} из {len(ASSIGN)}')
    print(f'\nНЕ НАЗНАЧЕНО ({len(UNMATCHED)}):')
    for key, reason in sorted(UNMATCHED.items()):
        print(f'  - {key}: {reason}')
    if report:
        print('\nЗАМЕЧАНИЯ:')
        for line in report:
            print('  ' + line)

if __name__ == '__main__':
    main()
