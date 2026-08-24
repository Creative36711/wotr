import json, math, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORLD_PATH = ROOT / 'public/mods/default/world.json'
ROSTER_PATH = ROOT / 'public/mods/default/roster.json'
MOD_PATH = ROOT / 'public/mods/default/mod.json'

world = json.loads(WORLD_PATH.read_text('utf-8'))

FACTIONS = [
    ('men-of-the-west', 'Люди Запада', 'Men of the West', '#5686bd', 'good'),
    ('elves', 'Эльфы', 'Elves', '#56b6a5', 'good'),
    ('dwarves', 'Гномы', 'Dwarves', '#b65c43', 'good'),
    ('isengard', 'Изенгард', 'Isengard', '#a9aca7', 'evil'),
    ('mordor', 'Мордор', 'Mordor', '#b33f32', 'evil'),
    ('goblins', 'Гоблины', 'Goblins', '#709b4f', 'evil'),
    ('angmar', 'Ангмар', 'Angmar', '#50618e', 'evil'),
]
RTS_COLOR_BY_FACTION = {'men-of-the-west':'blue','elves':'green','dwarves':'yellow','isengard':'black','mordor':'red','goblins':'orange','angmar':'purple'}
factions = [
    {'id': id, 'label': en, 'labelTranslations': {'ru': ru}, 'color': color, 'emblem': '', 'playable': True,
     'alignment': alignment, 'rtsColor': RTS_COLOR_BY_FACTION[id], 'baseArmyLimit': 2,
     'startingTreasury': {'gold': 500, 'materials': 200}}
    for id, ru, en, color, alignment in FACTIONS
]
factions.append({'id': 'civilian', 'label': 'Neutral', 'labelTranslations': {'ru':'Нейтральные'}, 'color': '#8b918d', 'emblem': '',
                 'playable': False, 'alignment': 'neutral', 'rtsColor': 'white', 'baseArmyLimit': 0,
                 'startingTreasury': {'gold': 0, 'materials': 0}})

side_map = {
    'gondor': 'men-of-the-west', 'rohan': 'men-of-the-west', 'arnor': 'civilian',
    'lotlorien': 'elves', 'imladris': 'elves', 'dwarves': 'dwarves',
    'isengard': 'isengard', 'mordor': 'mordor', 'harad': 'mordor', 'rhun': 'mordor',
    'misty-mountains': 'goblins', 'angmar': 'angmar', 'civilian': 'civilian',
    'men-of-the-west': 'men-of-the-west', 'elves': 'elves', 'goblins': 'goblins',
}
overrides = {'moria': 'goblins', 'dol-guldur': 'goblins', 'dale': 'dwarves', 'forochel': 'angmar'}
STRONGHOLD_IDS={'helms-deep'}
def location_hex(location):
    if isinstance(location.get('hex'),str):return location['hex']
    cfg=world['grid']['config'];x=float(location.get('x',0))/100*5120;y=float(location.get('y',0))/100*4115;px=(x-cfg['originX'])/cfg['size'];py=(y-cfg['originY'])/cfg['size'];q=math.sqrt(3)/3*px-py/3;r=2/3*py;cx=q;cz=r;cy=-cx-cz;rx=round(cx);ry=round(cy);rz=round(cz);xd=abs(rx-cx);yd=abs(ry-cy);zd=abs(rz-cz)
    if xd>yd and xd>zd:rx=-ry-rz
    elif yd>zd:ry=-rx-rz
    else:rz=-rx-ry
    return f'{rx}:{rz}'

for location in world['locations']:
    if 'nameTranslations' in location:
        location.setdefault('nameTranslations', {})
    else:
        russian_name = location.get('name', '')
        english_name = location.get('en') or russian_name
        location['name'] = english_name
        location['nameTranslations'] = {'ru': russian_name} if russian_name != english_name else {}
    location.pop('en', None)
    location['hex']=location_hex(location);location['structuralType']='stronghold' if location['id'] in STRONGHOLD_IDS else 'domain';location['economicType']=location.pop('economicType',location.pop('settlementType','village'))
    location.pop('x',None);location.pop('y',None);location.pop('kind',None);location.pop('regionId',None)
    location['side'] = overrides.get(location['id'], side_map.get(location['side'], 'civilian'))
    location['culture'] = None if location['side'] == 'civilian' else location['side']
    location['recruitment'] = []
    location['locationTags'] = []
    location['extraRecruitables'] = []
    location['blockedRecruitables'] = []
    location['rtsMapId'] = ''
    location['rtsMapCache'] = None
    location['rtsFortress'] = {'defenderStartPosition':{'x':0.5203,'y':0.3083}} if location['id']=='helms-deep' else None
    if location['id'] == 'angmar':
        location['name'] = 'Carn Dûm'
        location['nameTranslations']['ru'] = 'Карн Дум'

if not any(location['id'] == 'rhudaur' for location in world['locations']):
    world['locations'].append({
        'id':'rhudaur','name':'Rhudaur','nameTranslations':{'ru':'Рудаур'},'side':'angmar','structuralType':'domain','hex':'-1:14','image':'','economicType':'fortress',
        'income': {'gold': 100, 'materials': 20}, 'recruitmentSlots': 3, 'reserveLimit': 15,
        'recruitment': [], 'locationTags': [], 'culture': 'angmar', 'extraRecruitables': [],
        'blockedRecruitables': [], 'rtsMapId': '', 'rtsMapCache': None, 'rtsFortress': None,
        'armyLimitBonus': 0,
    })

used_hexes=set()
for location in world['locations']:
    if location['hex'] in used_hexes:
        q,r=map(int,location['hex'].split(':'));found=None
        for radius in range(1,20):
            for dq in range(-radius,radius+1):
                for dr in range(-radius,radius+1):
                    candidate=f'{q+dq}:{r+dr}'
                    if candidate not in used_hexes:found=candidate;break
                if found:break
            if found:break
        location['hex']=found or location['hex']
    used_hexes.add(location['hex'])
location_by_id = {location['id']: location for location in world['locations']}
previous_regions={region.get('locationId') or region.get('capitalLocationId'):region for region in world.get('regions',[])}
regions=[]
for location in world['locations']:
    if location['structuralType']!='domain':continue
    previous=previous_regions.get(location['id'],{})
    regions.append({'id':f"region-{location['id']}",'name':location['name'],'nameTranslations':dict(location.get('nameTranslations',{})),'locationId':location['id'],'ownerFactionId':None if location['side']=='civilian' else location['side'],'description':previous.get('description') or f"Region surrounding the location “{location['name']}”",'descriptionTranslations':previous.get('descriptionTranslations') or {'ru':f"Регион вокруг локации «{location.get('nameTranslations',{}).get('ru',location['name'])}»"}})
world['regions']=regions
valid_region_ids={region['id'] for region in regions}
for cell in world['grid'].get('cells', {}).values():
    if cell.get('regionId') not in valid_region_ids:cell.pop('regionId',None)
    if cell.get('owner') in side_map:
        mapped = side_map[cell['owner']]
        cell['owner'] = None if mapped == 'civilian' else mapped
    if cell.get('zoneOfControl') in side_map:
        mapped = side_map[cell['zoneOfControl']]
        cell['zoneOfControl'] = None if mapped == 'civilian' else mapped

ALL_BASIC = ['village', 'city', 'fortress', 'capital', 'port', 'farm']
ELITE = ['city', 'fortress', 'capital']
CAVALRY = ['farm', 'city', 'fortress', 'capital']
HEAVY = ['fortress', 'capital', 'mine']

def unit(id, object_id, faction, name, category, power, move=5, siege=0, gold=None, materials=None, time=None, upkeep=None, elite=False, transformation_source=None):
    if gold is None:
        gold = {'infantry': 100, 'archers': 110, 'cavalry': 170, 'monsters': 240, 'siege': 180}[category]
        gold += max(0, power - 100) // 3
    if materials is None:
        materials = {'infantry': 5, 'archers': 8, 'cavalry': 20, 'monsters': 45, 'siege': 65}[category]
    if time is None: time = 2 if category in ('monsters', 'siege') or power >= 170 else 1
    if upkeep is None: upkeep = max(5, round(gold / 10))
    types = HEAVY if category in ('monsters', 'siege') else CAVALRY if category == 'cavalry' else ELITE if elite or power >= 145 else ALL_BASIC
    return {'id': id, 'objectId': object_id, 'factionId': faction, 'name': name, 'category': category,
            'battlePower': power, 'movementPoints': move, 'siegePower': siege,
            'recruitCost': {'gold': gold, 'materials': materials}, 'recruitTime': time, 'upkeep': upkeep,
            'portrait': '', 'requiredLocationTypes': types, 'requiredLocationTags': [],
            'recruitDuringOccupation': power <= 80,
            'transformationSourceUnitId': transformation_source}

U = []
# Official RotWK WotR buildable list: Men
U += [
 unit('gondor-soldiers','GondorFighterHorde','men-of-the-west','Воины Гондора','infantry',105),
 unit('gondor-archers','GondorArcherHorde','men-of-the-west','Лучники Гондора','archers',90),
 unit('ithilien-rangers','GondorRangerHorde','men-of-the-west','Следопыты Итилиэна','archers',125,elite=True),
 unit('gondor-knights','GondorKnightHorde','men-of-the-west','Рыцари Гондора','cavalry',140,move=7),
 unit('rohirrim','RohanRohirrimHorde','men-of-the-west','Рохиррим','cavalry',150,move=7,elite=True),
 unit('knights-of-dol-amroth','GondorKnightsofDolHorde','men-of-the-west','Рыцари Дол Амрота','cavalry',195,move=7,gold=300,materials=40,time=2,upkeep=28,elite=True),
 unit('tower-guards','GondorTowerShieldGuardHorde','men-of-the-west','Стражи Цитадели','infantry',150,elite=True),
 unit('gondor-trebuchet','GondorTrebuchet','men-of-the-west','Требушет','siege',70,move=3,siege=130),
 unit('rohan-spearmen','RohanSpearmenHorde','men-of-the-west','Копейщики Рохана','infantry',95),
]
# Elves
U += [
 unit('lorien-warriors','ElvenLorienWarriorHorde','elves','Воины Лориэна','infantry',120),
 unit('lorien-archers','ElvenLorienArcherHorde','elves','Лучники Лориэна','archers',130),
 unit('mirkwood-archers','ElvenMirkwoodArcherHorde','elves','Лучники Лихолесья','archers',155,elite=True),
 unit('noldor-warriors','NoldorWarriorHorde','elves','Воины-нолдор','infantry',190,gold=300,materials=35,time=2,upkeep=28,elite=True),
 unit('rivendell-lancers','ElvenRivendellLancerHorde','elves','Всадники Ривенделла','cavalry',150,move=7,elite=True),
 unit('lindon-horse-archers','ElvenRivendellArcherHorde','elves','Конные лучники Линдона','cavalry',145,move=7,elite=True),
 unit('mithlond-sentries','ElvenMithlondSentryHorde','elves','Стражи Митлонда','infantry',140),
 unit('ents','RohanEntFir','elves','Энты','monsters',250,move=3,siege=110,gold=330,materials=55,time=3,upkeep=30),
]
# Dwarves
U += [
 unit('dwarven-guardians','DwarvenGuardianHorde','dwarves','Стражники','infantry',135),
 unit('dwarven-axe-throwers','DwarvenAxeThrowerHorde','dwarves','Метатели топоров','archers',110),
 unit('men-of-dale','DwarvenMenOfDaleHorde','dwarves','Люди Дейла','archers',125),
 unit('battle-wagon','DwarvenBattleWagon','dwarves','Боевая повозка','cavalry',135,move=7,siege=25,gold=230,materials=40,time=2,upkeep=22),
 unit('dwarven-phalanx','DwarvenPhalanxHorde','dwarves','Фаланга гномов','infantry',145,elite=True),
 unit('dwarven-zealots','DwarvenZerkerHorde','dwarves','Гномы-убийцы','infantry',185,gold=280,materials=35,time=2,upkeep=26,elite=True),
 unit('dwarven-catapult','DwarvenCatapult','dwarves','Катапульта гномов','siege',75,move=3,siege=135),
]
# Isengard
U += [
 unit('uruk-fighters','IsengardFighterHorde','isengard','Урук-хай с мечами','infantry',120),
 unit('uruk-berserker','IsengardBeserker','isengard','Берсерк','infantry',155,gold=210,materials=20,time=2,upkeep=20,elite=True),
 unit('uruk-deathbringers','IsengardBerserkerHorde','isengard','Уруки-каратели','infantry',190,gold=290,materials=35,time=2,upkeep=27,elite=True),
 unit('wildmen-of-dunland','IsengardWildmanHorde','isengard','Дикари Дунланда','infantry',75),
 unit('wildmen-axe-throwers','IsengardWildmanAxeHorde','isengard','Метатели топоров Дунланда','archers',80),
 unit('uruk-crossbows','IsengardUrukCrossbowHorde','isengard','Арбалетчики урук-хай','archers',115),
 unit('warg-pack','IsengardWargPackHorde','isengard','Стая варгов','cavalry',80,move=7),
 unit('warg-riders','IsengardWargRiderHorde','isengard','Всадники на варгах','cavalry',130,move=7),
 unit('uruk-pikes','IsengardPikemanHorde','isengard','Пикинёры урук-хай','infantry',125),
 unit('isengard-ballista','IsengardBallista','isengard','Баллиста Изенгарда','siege',75,move=3,siege=120),
]
# Mordor
U += [
 unit('mordor-orcs','MordorFighterHorde','mordor','Орки Мордора','infantry',65,gold=55,materials=0,upkeep=5),
 unit('black-orcs','MordorBlackOrcHorde','mordor','Чёрные орки','infantry',130),
 unit('corsairs-of-umbar','MordorCorsairsOfUmbarHorde','mordor','Корсары Умбара','infantry',110),
 unit('mordor-archers','MordorArcherHorde','mordor','Орки-лучники','archers',60,gold=55,materials=0,upkeep=5),
 unit('haradrim-archers','MordorHaradrimArcherHorde','mordor','Лучники Харада','archers',110),
 unit('haradrim-lancers','MordorHaradrimRiderHorde','mordor','Харадримские всадники','cavalry',125,move=7),
 unit('mountain-troll','MordorMountainTroll','mordor','Горный тролль','monsters',180,move=4,siege=45),
 unit('drummer-troll','MordorDrummerTroll','mordor','Тролль-барабанщик','monsters',130,move=4,siege=20),
 unit('attack-troll','MordorAttackTroll','mordor','Боевой тролль','monsters',230,move=4,siege=65),
 unit('mumakil','MordorMumakil','mordor','Мумакил','monsters',285,move=3,siege=90,gold=400,materials=80,time=3,upkeep=36),
 unit('easterlings','MordorEasterlingHorde','mordor','Истерлинги','infantry',125),
 unit('mordor-catapult','MordorCatapult','mordor','Катапульта Мордора','siege',75,move=3,siege=125),
 unit('black-riders','MordorBlackRiderHorde','mordor','Чёрные всадники','cavalry',225,move=7,gold=340,materials=45,time=3,upkeep=32,elite=True),
]
# Goblins
U += [
 unit('goblin-fighters','GoblinFighterHorde','goblins','Гоблины-воины','infantry',55,gold=45,materials=0,upkeep=4),
 unit('spiderlings','WildSpiderlingHorde','goblins','Паучата','cavalry',70,move=7,gold=75,materials=5,upkeep=7),
 unit('goblin-archers','GoblinArcherHorde','goblins','Гоблины-лучники','archers',50,gold=45,materials=0,upkeep=4),
 unit('cave-troll','GoblinCaveTroll','goblins','Пещерный тролль','monsters',190,move=4,siege=55),
 unit('spider-riders','GoblinSpiderRiderHorde','goblins','Всадники на пауках','cavalry',125,move=7),
 unit('half-troll-marauders','WildMarauderHorde','goblins','Полутролли-мародёры','infantry',155,elite=True),
 unit('half-troll-swordsmen','WildMarauderSwordHorde','goblins','Полутролли-мечники','infantry',160,elite=True),
 unit('mountain-giant','WildMountainGiant','goblins','Горный великан','monsters',270,move=3,siege=125,gold=360,materials=65,time=3,upkeep=33),
 unit('fire-drake-brood','WildBabyDrakeHorde','goblins','Выводок огненных драконов','monsters',240,move=4,siege=40,gold=330,materials=70,time=3,upkeep=31),
]
# Angmar
U += [
 unit('black-numenoreans','AngmarDarkDunedainHorde','angmar','Чёрные нуменорцы','infantry',150,elite=True),
 unit('dark-rangers','AngmarDarkRangerHorde','angmar','Тёмные следопыты','archers',140,elite=True),
 unit('dire-wolves','AngmarDireWolfHorde','angmar','Волки-мстители','cavalry',75,move=7,gold=85,materials=5,upkeep=8),
 unit('snow-trolls','AngmarSnowTrollHorde','angmar','Снежные тролли','cavalry',185,move=7,gold=260,materials=40,time=2,upkeep=25,elite=True),
 unit('hill-trolls','AngmarHillTrollHorde','angmar','Холмовые тролли','infantry',175,gold=240,materials=35,time=2,upkeep=23,elite=True),
 unit('angmar-sorcerers','AngmarNecromancerHorde','angmar','Колдуны Ангмара','archers',135,gold=220,materials=30,time=2,upkeep=21,elite=True),
 unit('thrall-masters','AngmarThrallMaster','angmar','Заклинатель','infantry',35,gold=200,materials=0,upkeep=8),
 unit('gundabad-orcs','AngmarOrcWarriors','angmar','Орки Гундабада','infantry',65,gold=0,materials=0,upkeep=6,transformation_source='thrall-masters'),
 unit('gundabad-wolf-riders','AngmarWolfRiders','angmar','Волчьи всадники Гундабада','cavalry',110,move=7,gold=350,materials=0,upkeep=14,transformation_source='thrall-masters'),
 unit('rhudaur-spearmen','AngmarRhudaurSpearmen','angmar','Рудаурские пикинёры','infantry',90,gold=100,materials=0,upkeep=10,transformation_source='thrall-masters'),
 unit('rhudaur-axe-throwers','AngmarRhudaurSlingers','angmar','Метатели топоров Рудаура','archers',75,gold=0,materials=0,upkeep=7,transformation_source='thrall-masters'),
 unit('troll-stone-thrower','AngmarTrollSling','angmar','Тролль-камнемёт','siege',80,move=3,siege=135),
]

H = []
def hero(id, object_id, faction, name, title, power, command, move, unlock, turn, location, cost):
    H.append({'id': id, 'objectId': object_id, 'factionId': faction, 'name': name, 'title': title,
              'battlePower': power, 'command': command, 'movementBonus': move, 'alive': True, 'portrait': '',
              'unlockType': unlock, 'requiredTurn': turn, 'requiredLocationId': location,
              'summonCostGold': cost})
# Men
hero('aragorn','GondorAragornMP','men-of-the-west','Арагорн','Наследник Исилдура',700,10,1,'starting',1,'minas-tirith',0)
hero('boromir','GondorBoromir','men-of-the-west','Боромир','Капитан Белой Башни',520,8,0,'starting',1,'minas-tirith',0)
hero('theoden','RohanTheoden','men-of-the-west','Теоден','Король Рохана',500,9,1,'starting',1,'edoras',0)
hero('eomer','RohanEomer','men-of-the-west','Эомер','Маршал Риддермарка',480,8,1,'starting',1,'edoras',0)
hero('gandalf','GondorGandalf','men-of-the-west','Гэндальф','Белый всадник',760,10,1,'turn_location',3,'minas-tirith',300)
hero('faramir','GondorFaramir','men-of-the-west','Фарамир','Капитан Гондора',460,7,0,'turn_location',2,'minas-tirith',180)
hero('eowyn','RohanEowyn','men-of-the-west','Эовин','Щитовая дева Рохана',410,5,0,'turn_location',3,'edoras',180)
# Elves
hero('elrond','ElvenElrond','elves','Элронд','Владыка Ривенделла',650,10,1,'starting',1,'rivendell',0)
hero('glorfindel','ElvenGlorfindel','elves','Глорфиндел','Лорд Имладриса',620,8,1,'starting',1,'rivendell',0)
hero('thranduil','ElvenThranduil','elves','Трандуил','Король Лесного королевства',570,8,0,'starting',1,'mirkwood',0)
hero('haldir','ElvenHaldir','elves','Халдир','Страж Лориэна',450,7,0,'starting',1,'lorien',0)
hero('arwen','ElvenArwen','elves','Арвен','Вечерняя звезда',400,5,1,'turn_location',2,'rivendell',170)
hero('legolas','ElvenLegolas','elves','Леголас','Принц Лихолесья',540,6,1,'turn_location',3,'mirkwood',230)
# Dwarves
hero('gimli','DwarvenGimli','dwarves','Гимли','Сын Глоина',620,8,0,'starting',1,'erebor',0)
hero('gloin','DwarvenGloin','dwarves','Глоин','Владыка Эред Луина',480,7,0,'starting',1,'erebor',0)
hero('dain','DwarvenDain','dwarves','Король Даин','Король-под-Горой',580,10,0,'starting',1,'erebor',0)
hero('prince-brand','DwarvenCaptainofDale','dwarves','Принц Бранд','Капитан Дейла',470,7,0,'turn_location',2,'dale',190)
# Isengard
hero('saruman','IsengardSaruman','isengard','Саруман','Владыка Изенгарда',760,11,1,'starting',1,'isengard',0)
hero('lurtz','IsengardLurtz','isengard','Лурц','Предводитель урук-хай',500,7,0,'starting',1,'isengard',0)
hero('sharku','IsengardSharku','isengard','Шарку','Вожак варгов',410,6,1,'turn_location',2,'isengard',180)
hero('wormtongue','IsengardWormTongue','isengard','Грима Гнилоуст','Советник-предатель',180,3,0,'turn_location',2,'isengard',100)
# Mordor
hero('mordor-witch-king','MordorWitchKingOnFellBeast','mordor','Король-чародей','Повелитель назгулов',820,11,1,'starting',1,'minas-morgul',0)
hero('mouth-of-sauron','MordorMouthOfSauron','mordor','Уста Саурона','Наместник Барад-дура',520,8,1,'starting',1,'barad-dur',0)
hero('gothmog','MordorGothmog','mordor','Готмог','Наместник Минас Моргула',540,8,0,'turn_location',2,'minas-morgul',170)
hero('khamul','KhamulFellBeast','mordor','Кхамул','Тень Востока',650,7,1,'turn_location',3,'barad-dur',280)
hero('mordor-morgomir','MorgomirFellBeast','mordor','Моргомир','Чёрный всадник',640,7,1,'turn_location',4,'barad-dur',300)
# Goblins
hero('gorkil','WildGoblinKing','goblins','Горкил','Король гоблинов',460,7,0,'starting',1,'gundabad',0)
hero('azog','WildAzog','goblins','Азог','Осквернитель',500,7,0,'starting',1,'gundabad',0)
hero('shelob','WildShelob','goblins','Шелоб','Великая паучиха',470,3,1,'turn_location',2,'moria',200)
hero('drogoth','Drogoth','goblins','Дрогот','Повелитель драконов',680,6,1,'turn_location',4,'gundabad',350)
# Angmar
hero('angmar-witch-king','AngmarWitchking','angmar','Король-чародей','Владыка Ангмара',820,11,1,'starting',1,'angmar',0)
hero('morgomir','AngmarMorgramir','angmar','Моргомир','Наместник Карн Дума',570,8,1,'starting',1,'angmar',0)
hero('hwaldar','AngmarHwaldar','angmar','Халдар','Вождь Рудаура',380,7,0,'starting',1,'rhudaur',0)
hero('rogash','AngmarRogash','angmar','Рогаш','Тролль Севера',620,5,0,'turn_location',2,'angmar',220)
hero('karsh','AngmarKarsh','angmar','Карш','Шепчущий призрак',500,6,1,'turn_location',3,'angmar',250)

CAPTAIN_NAMES = {
 'men-of-the-west':['Берен','Мардил','Хурин','Гримбольд','Хама'],
 'elves':['Эрестор','Линдир','Румиль','Орофин','Галадор'],
 'dwarves':['Дори','Нори','Борин','Нарви','Фрар'],
 'isengard':['Углук','Маухур','Варгул','Радбуг','Горбаг'],
 'mordor':['Шаграт','Горбаг','Гришнах','Музгаш','Радбуг'],
 'goblins':['Больдур','Гришак','Музгар','Снагур','Рагаш'],
 'angmar':['Моркант','Варгрим','Гулдар','Карн','Таргон'],
}
captains=[]
for id,ru,_,_,alignment in FACTIONS:
    captains.append({'id':f'{id}-captain','factionId':id,'name':f'Капитан: {ru}',
                     'battlePower':40 if alignment=='good' else 35,'command':5,'movementBonus':0,
                     'portrait':'','namePool':CAPTAIN_NAMES[id]})

unit_by_id={u['id']:u for u in U}
hero_by_id={h['id']:h for h in H}

def pixel_to_hex(location):
    return location['hex']

def army(id,faction,location_id,commander,units,support=(),captain_name=None,status='ready'):
    loc=location_by_id[location_id]
    if commander:
        cmd={'kind':'hero','entityId':commander,'objectId':hero_by_id[commander]['objectId']}
    else:
        cmd={'kind':'captain','entityId':f'{faction}-captain','displayName':captain_name or CAPTAIN_NAMES[faction][0],
             'instanceId':f'captain-start-{id}'}
    unit_slots=[]; index=0
    for unit_id,count in units:
        for _ in range(count):
            index+=1; u=unit_by_id[unit_id]
            unit_slots.append({'slotId':f'{id}-unit-{index}','kind':'unit','entityId':unit_id,'objectId':u['objectId']})
    hero_slots=[{'slotId':f'{id}-hero-{i+1}','kind':'hero','entityId':hid,'objectId':hero_by_id[hid]['objectId']} for i,hid in enumerate(support)]
    return {'id':id,'name':'','factionId':faction,'hexId':pixel_to_hex(loc),'movementRemaining':5,
            'baseUnitSlotLimit':15,'heroSlotLimit':2,'commander':cmd,'unitSlots':unit_slots,'heroSlots':hero_slots,
            'status':status,'canInitiateBattle':True,'engaged':False,'movedRound':None,'movedInPhase':None,'exhaustedUntilRound':None}

armies=[
 army('men-minas-host','men-of-the-west','minas-tirith','aragorn',[('gondor-soldiers',3),('gondor-archers',2),('gondor-knights',1),('ithilien-rangers',1)],['boromir']),
 army('men-rohan-host','men-of-the-west','edoras','theoden',[('rohirrim',2),('rohan-spearmen',2),('gondor-archers',1)],['eomer']),
 army('elves-rivendell-host','elves','rivendell','elrond',[('lorien-warriors',2),('lorien-archers',2),('rivendell-lancers',1)],['glorfindel']),
 army('elves-mirkwood-host','elves','mirkwood','thranduil',[('mirkwood-archers',3),('lorien-warriors',1),('mithlond-sentries',1)]),
 army('dwarves-erebor-host','dwarves','erebor','gimli',[('dwarven-guardians',3),('dwarven-axe-throwers',2),('men-of-dale',1)],['gloin']),
 army('isengard-main-host','isengard','isengard','saruman',[('uruk-fighters',3),('uruk-pikes',2),('uruk-crossbows',2),('warg-riders',1)],['lurtz']),
 army('isengard-dunland-raiders','isengard','dunland',None,[('wildmen-of-dunland',3),('wildmen-axe-throwers',2),('uruk-fighters',1)],captain_name='Углук'),
 army('mordor-minas-morgul-host','mordor','minas-morgul','mordor-witch-king',[('mordor-orcs',4),('mordor-archers',2),('easterlings',2),('attack-troll',1)],['mouth-of-sauron']),
 army('mordor-barad-dur-host','mordor','barad-dur',None,[('mordor-orcs',5),('black-orcs',2),('mordor-archers',2)],captain_name='Шаграт'),
 army('goblins-gundabad-host','goblins','gundabad','gorkil',[('goblin-fighters',4),('goblin-archers',3),('spider-riders',1),('cave-troll',1)],['azog']),
 army('goblins-moria-host','goblins','moria',None,[('goblin-fighters',4),('spiderlings',2),('half-troll-marauders',1)],captain_name='Больдур'),
 army('angmar-carn-dum-host','angmar','angmar','angmar-witch-king',[('black-numenoreans',2),('dark-rangers',2),('snow-trolls',1),('gundabad-orcs',1)],['morgomir']),
 army('angmar-rhudaur-host','angmar','rhudaur','hwaldar',[('thrall-masters',1),('rhudaur-spearmen',2),('rhudaur-axe-throwers',1),('dire-wolves',1)]),
]

faction_states={id:{'status':'active','eliminatedOnRound':None,'statistics':{'battlesWon':0,'battlesLost':0,'locationsCaptured':0,'heroesLost':0}} for id,_,_,_,_ in FACTIONS}
treasuries={f['id']:{'gold':f['startingTreasury']['gold'],'materials':f['startingTreasury']['materials'],'lastIncome':{'gold':0,'materials':0},'lastUpkeep':0} for f in factions}
location_states={l['id']:{'locationId':l['id'],'recruitmentQueue':[],'reserve':[],'occupationTurnsLeft':0} for l in world['locations']}
hero_states={h['id']:{'status':'active' if h['unlockType']=='starting' else 'locked','summoned':h['unlockType']=='starting',
                      'availableSinceRound':None,'summonLocationId':h['requiredLocationId'],'healTurnsLeft':0,
                      'recoveryLocationId':None,'diedRound':None,'diedLocationId':None} for h in H}
world['factions']=factions
world['armies']=armies
world.pop('unitTypes',None);world.pop('heroes',None);world.pop('captains',None)
world['campaign']={
    'round':1,'activeFactionId':'men-of-the-west','turnOrder':[id for id,_,_,_,_ in FACTIONS],
    'phase':'planning_good','firstMoverThisRound':'good','playerFactionId':None,'playerSide':'good','aiEnabled':True,
    'aiDifficulty':{'strategic':'warrior','rts':'warrior'},'gameStatus':'active','gameResultDismissed':False,'factionStates':faction_states,
    'freeCaptains':{f['id']:[] for f in factions},
    'fogOfWar':{'enabled':True,'overlayVisible':True,'lastSeenArmies':[],'lastSeenLocations':[]},
    'treasuries':treasuries,'locationStates':location_states,'heroStates':hero_states,'pendingOrders':[],
    'conflicts':[],'currentConflictId':None,
    'log':[{'id':'campaign-template','round':1,'factionId':None,'phase':'planning_good','kind':'system','text':'Шаблон кампании Vanilla 2.01 готов к началу.'}],
}
world['battles']=[]
world['version']=29

# Add English content fields from the built-in localization catalog. The
# catalog is parsed as JSON string pairs so this generator remains dependency-free.
content_en = {}
translation_path = ROOT / 'src/contentTranslations.ts'
if translation_path.exists():
    pair = re.compile(r'^\s*("(?:[^"\\]|\\.)*"):\s*("(?:[^"\\]|\\.)*"),?\s*$')
    for line in translation_path.read_text('utf-8').splitlines():
        match = pair.match(line)
        if match:
            content_en[json.loads(match.group(1))] = json.loads(match.group(2))
for item in U:
    russian=item['name'];item['name']=content_en.get(russian,russian);item['nameTranslations']={'ru':russian} if item['name']!=russian else {}
for item in H:
    russian_name=item['name'];russian_title=item['title']
    item['name']=content_en.get(russian_name,russian_name);item['nameTranslations']={'ru':russian_name} if item['name']!=russian_name else {}
    item['title']=content_en.get(russian_title,russian_title);item['titleTranslations']={'ru':russian_title} if item['title']!=russian_title else {}
for item in captains:
    russian=item['name'];item['name']=content_en.get(russian,russian);item['nameTranslations']={'ru':russian} if item['name']!=russian else {}
    russian_pool=list(item['namePool']);item['namePool']=[content_en.get(name,name) for name in russian_pool];item['namePoolTranslations']={'ru':russian_pool}
for item in armies:
    if item.get('commander',{}).get('kind')=='captain':
        name=item['commander'].get('displayName','');item['commander']['displayName']=content_en.get(name,name)

roster={'version':14,'unitTypes':U,'heroes':H,'captains':captains}
mod={
    'id':'default','name':'Vanilla 2.01',
    'description':'Стандартная глобальная кампания по фракциям, войскам и героям The Rise of the Witch-king 2.01.',
    'author':'WOTR Team','version':'2.01.0','createdAt':'2026-08-16T00:00:00.000Z','updatedAt':'2026-08-16T00:00:00.000Z',
    'bfmeVersion':'The Rise of the Witch-king 2.01','mapImage':None,
    'rts': {
        'enabled': True,
        'factionOrder': ['men-of-the-west','elves','dwarves','isengard','mordor','goblins','angmar'],
        'moduleFiles': [],
        'mapsFile': None,
        'mapCacheTargetFileName': '__wotr_maps_cache.big',
        'networkRules': '0 0 0 400 1000 -1 -1 -1 -1 -1',
    },
    'dataVersions':{'world':29,'roster':14},
}

WORLD_PATH.write_text(json.dumps(world,ensure_ascii=False,indent=2)+'\n','utf-8')
ROSTER_PATH.write_text(json.dumps(roster,ensure_ascii=False,indent=2)+'\n','utf-8')
MOD_PATH.write_text(json.dumps(mod,ensure_ascii=False,indent=2)+'\n','utf-8')
print(json.dumps({'locations':len(world['locations']),'regions':len(regions),'factions':len(FACTIONS),'units':len(U),'heroes':len(H),'captains':len(captains),'armies':len(armies)},ensure_ascii=False))
