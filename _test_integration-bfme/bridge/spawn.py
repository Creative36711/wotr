#!/usr/bin/env python3
"""
Генерация стартового состава армии (полный ростер + ауры апгрейдов + уровни).

МЕХАНИКА (War of the Ring mod — Aura Granter System):
  Каждый апгрейд и уровень — отдельный объект WOTR_Aura_*. Чтобы отряд получил
  апгрейд/уровень, нужно заспавнить этот aura-объект В ТОЙ ЖЕ ТОЧКЕ, что и
  отряд. Поэтому для каждого отряда спавним:
    1) сам отряд (ThingToSpawn = <Horde>);
    2) выбранные ауры апгрейдов (ThingToSpawn = WOTR_Aura_<Name>);
    3) ауру уровня (ThingToSpawn = WOTR_Aura_Level<N>), если уровень > 1.
  Все — модулями ObjectCreationUpgrade с одинаковым Offset.

УРОВНИ:
  1..10. Уровень 1 = базовый (без ауры), ауры уровня есть для 2..10.
  level_cap=0 — юнит БЕЗ УРОВНЯ (осадные орудия, энты): аура уровня
  не спавнится вообще.
  Обычные отряды — максимум 5. ГЕРОИЧЕСКИЕ/элитные — до 10:
    NoldorWarriorHorde, GondorKnightsofDolHorde, DwarvenZerkerHorde,
    IsengardBerserkerHorde, MordorBlackRiderHorde, WildBabyDrakeHorde.

РАССТАНОВКА (кольцевая система):
  Юниты размещаются концентрическими кольцами вокруг центра крепости.
  Герои — линией у ворот (направление задаётся gate_angle_deg).
  Кольцевой герой — на отдельном кольце дальше всех.

  Координатная система:
    +X — вправо, -X — влево, -Y — вверх на экране, +Y — вниз.
    Геом. угол α от +X против часовой стрелки (мат. стандарт).
    Y_screen = -R × sin(α) (экранная инверсия).

  Параметры:
    HERO_RADIUS    = 95   (герои у ворот, зазор от стены ~20)
    HERO_SPACING   = 20   (расстояние между героями вдоль касательной)
    RING1_RADIUS   = 140  (первое кольцо юнитов)
    RING_GAP       = 70   (зазор между кольцами)
    MAX_PER_RING   = 8    (макс. юнитов на одном кольце)
    Шахматка: чётные кольца +0°, нечётные +22.5°.

ФРАКЦИОННЫЕ ТРИГГЕРЫ:
  Каждый участник спавнит только «свой» состав (Upgrade_<X>Faction).

РОСТЕР — полный список юнитов игры (см. ROSTER ниже). Каждый отряд:
  (имя, короткая подпись, level_cap, [ауры апгрейдов]).
"""

import math
import struct
import os
import random

# ---------------------------------------------------------------------------
# Фракционные апгрейды (триггер спавна).
# ---------------------------------------------------------------------------
FACTION_UPGRADES = {
    "men":      "Upgrade_MenFaction",
    "elves":    "Upgrade_ElfFaction",
    "dwarves":  "Upgrade_DwarfFaction",
    "isengard": "Upgrade_IsengardFaction",
    "mordor":   "Upgrade_MordorFaction",
    "goblins":  "Upgrade_WildFaction",
    "angmar":   "Upgrade_AngmarFaction",
    "arnor":    "Upgrade_ArnorFaction",
}

# ---------------------------------------------------------------------------
# WOTR Generated Presets — новые механики (золото / ОК / сигнальный огонь / PP).
# ---------------------------------------------------------------------------
# Имя выходного файла и путь внутри .big (новый формат):
#   __wotr_generated_presets.big  ->  data\ini\object\zzz_wotr\system\zzz_spawn.ini
SPAWN_BIG_DEFAULT = r"C:\RotWK\__wotr_generated_presets.big"
SPAWN_INTERNAL_PATH = r"data\ini\object\zzz_wotr\system\zzz_spawn.ini"

# Диапазоны случайных значений (для ботов и режима «r» в опросе).
MECH_GOLD_RANGE = (500, 10000)    # бонусные стартовые деньги
MECH_CP_RANGE = (100, 1000)       # дополнительные командные очки
MECH_START_PP_RANGE = (0, 10)     # стартовые очки палантира
MECH_PP_RATE_RANGE = (1, 5)       # PP каждые 2 минуты
SIGNAL_FIRE_CHANCE = 0.5          # шанс «Да» для сигнального огня

# Уровень по умолчанию для обычных и героических отрядов.
CAP_NONE = 0       # без уровня (осадные орудия, энты и т.п.) — аура уровня не спавнится
CAP_REGULAR = 5
CAP_HEROIC = 10

# ---------------------------------------------------------------------------
# Полный ростер. Формат: "фракция" -> [(unit, label, level_cap, [upgrades])].
# ---------------------------------------------------------------------------
ROSTER = {
    "men": [
        ("GondorFighterHorde", "мечники Гондора", CAP_REGULAR,
         ["WOTR_Aura_GondorForgedBlades", "WOTR_Aura_GondorHeavyArmor"]),
        ("GondorTowerShieldGuardHorde", "копейщики Гондора", CAP_REGULAR,
         ["WOTR_Aura_GondorForgedBlades", "WOTR_Aura_GondorHeavyArmor"]),
        ("GondorArcherHorde", "лучники Гондора", CAP_REGULAR,
         ["WOTR_Aura_GondorFireArrows", "WOTR_Aura_GondorHeavyArmor"]),
        ("GondorRangerHorde", "следопыты Гондора", CAP_REGULAR,
         ["WOTR_Aura_GondorFireArrows"]),
        ("GondorKnightHorde", "рыцари Гондора", CAP_REGULAR,
         ["WOTR_Aura_GondorForgedBlades", "WOTR_Aura_GondorHeavyArmor",
          "WOTR_Aura_GondorKnightShield"]),
        ("RohanRohirrimHorde", "рохиррим", CAP_REGULAR,
         ["WOTR_Aura_RohanForgedBladesForRohirrim",
          "WOTR_Aura_RohanHeavyArmorForRohirrim", "WOTR_Aura_RohanFireArrows"]),
        ("RohanSpearmenHorde", "копейщики Рохана", CAP_REGULAR,
         ["WOTR_Aura_GondorForgedBlades", "WOTR_Aura_GondorHeavyArmor"]),
        ("GondorTrebuchet", "требушет", CAP_NONE,
         ["WOTR_Aura_GondorFireStones"]),
        ("GondorKnightsofDolHorde", "рыцари Дол Амрота", CAP_HEROIC,
         ["WOTR_Aura_ElvenForgedBlades", "WOTR_Aura_ElderRacesWarBarding"]),
    ],
    "elves": [
        ("ElvenLorienWarriorHorde", "воины Лориэна", CAP_REGULAR,
         ["WOTR_Aura_ElvenForgedBlades", "WOTR_Aura_ElvenHeavyArmor",
          "WOTR_Aura_ElvenSilverthornArrows"]),
        ("ElvenLorienArcherHorde", "лучники Лориэна", CAP_REGULAR,
         ["WOTR_Aura_ElvenForgedBlades", "WOTR_Aura_ElvenHeavyArmor",
          "WOTR_Aura_ElvenSilverthornArrows"]),
        ("ElvenMirkwoodArcherHorde", "лучники Лихолесья", CAP_REGULAR,
         ["WOTR_Aura_ElvenSilverthornArrows"]),
        ("ElvenMithlondSentryHorde", "стражи Митлонда", CAP_REGULAR,
         ["WOTR_Aura_ElvenForgedBlades", "WOTR_Aura_ElvenHeavyArmor"]),
        ("ElvenRivendellLancerHorde", "ланцеры Ривенделла", CAP_REGULAR,
         ["WOTR_Aura_ElvenForgedBlades", "WOTR_Aura_ElderRacesWarBarding"]),
        ("ElvenRivendellArcherHorde", "лучники Ривенделла", CAP_REGULAR,
         ["WOTR_Aura_ElvenSilverthornArrows", "WOTR_Aura_ElvenHeavyArmor"]),
        ("RohanGenericEnt", "энт", CAP_NONE, []),
        ("NoldorWarriorHorde", "нолдор", CAP_HEROIC,
         ["WOTR_Aura_ElvenForgedBlades", "WOTR_Aura_ElvenSilverthornArrows"]),
    ],
    "dwarves": [
        ("DwarvenGuardianHorde", "стражи гномов", CAP_REGULAR,
         ["WOTR_Aura_DwarvenForgedBlades", "WOTR_Aura_DwarvenMithrilMail",
          "WOTR_Aura_DwarvenSiegeHammer"]),
        ("DwarvenAxeThrowerHorde", "метатели топоров", CAP_REGULAR,
         ["WOTR_Aura_DwarvenForgedBlades", "WOTR_Aura_DwarvenMithrilMail"]),
        ("DwarvenPhalanxHorde", "фаланга гномов", CAP_REGULAR,
         ["WOTR_Aura_DwarvenForgedBlades", "WOTR_Aura_DwarvenMithrilMail"]),
        ("DwarvenMenOfDaleHorde", "люди Дейла", CAP_REGULAR,
         ["WOTR_Aura_DwarvenFireArrows", "WOTR_Aura_DwarvenMithrilMail"]),
        ("DwarvenBattleWagon", "боевая повозка", CAP_REGULAR, []),
        ("DwarvenCatapult", "катапульта гномов", CAP_NONE,
         ["WOTR_Grant_DwarvenFlamingShot"]),
        ("DwarvenZerkerHorde", "берсерки гномов", CAP_HEROIC, []),
    ],
    "isengard": [
        ("IsengardFighterHorde", "урук-хаи", CAP_REGULAR,
         ["WOTR_Aura_IsengardForgedBlades", "WOTR_Aura_IsengardHeavyArmor"]),
        ("IsengardPikemanHorde", "копейщики урук-хаев", CAP_REGULAR,
         ["WOTR_Aura_IsengardForgedBlades", "WOTR_Aura_IsengardHeavyArmor"]),
        ("IsengardWildmanHorde", "дикари Дунланда", CAP_REGULAR,
         ["WOTR_Aura_IsengardTorches", "WOTR_Aura_IsengardHeavyArmor"]),
        ("IsengardWildmanAxeHorde", "дикари-топорщики", CAP_REGULAR,
         ["WOTR_Aura_DwarvenFireArrows", "WOTR_Aura_IsengardHeavyArmor"]),
        ("IsengardUrukCrossbowHorde", "арбалетчики урук-хаев", CAP_REGULAR,
         ["WOTR_Aura_IsengardFireArrows", "WOTR_Aura_IsengardHeavyArmor"]),
        ("IsengardWargRiderHorde", "варги", CAP_REGULAR,
         ["WOTR_Aura_IsengardForgedBlades", "WOTR_Aura_IsengardHeavyArmor"]),
        ("IsengardWargPackHorde", "стая варгов", CAP_REGULAR,
         ["WOTR_Aura_IsengardForgedBlades", "WOTR_Aura_IsengardHeavyArmor"]),
        ("IsengardBallista", "баллиста", CAP_NONE, []),
        ("IsengardBatteringRam", "таран Изенгарда", CAP_NONE, []),
        ("IsengardExplosiveMine", "подрывная мина", CAP_NONE, []),
        ("IsengardSiegeLadder", "осадная лестница", CAP_NONE, []),
        ("IsengardBeserker", "берсерк", CAP_REGULAR, []),
        ("IsengardBerserkerHorde", "берсерки урук-хаев", CAP_HEROIC, []),
    ],
    "mordor": [
        ("MordorFighterHorde", "орки", CAP_REGULAR,
         ["WOTR_Aura_MordorForgedBlades", "WOTR_Aura_MordorHeavyArmor"]),
        ("MordorArcherHorde", "орки-лучники", CAP_REGULAR,
         ["WOTR_Aura_MordorFireArrows", "WOTR_Aura_MordorHeavyArmor"]),
        ("MordorCorsairsOfUmbarHorde", "корсары Умбара", CAP_REGULAR,
         ["WOTR_Aura_MordorForgedBlades"]),
        ("MordorHaradrimArcherHorde", "харадримы-лучники", CAP_REGULAR,
         ["WOTR_Aura_MordorFireArrows", "WOTR_Aura_MordorHeavyArmor"]),
        ("MordorEasterlingHorde", "истерлинги", CAP_REGULAR,
         ["WOTR_Aura_MordorHeavyArmor"]),
        ("MordorBlackOrcHorde", "чёрные орки", CAP_REGULAR,
         ["WOTR_Aura_MordorForgedBlades", "WOTR_Aura_MordorHeavyArmor"]),
        ("MordorHaradrimRiderHorde", "харадримы-всадники", CAP_REGULAR,
         ["WOTR_Aura_MordorForgedBlades", "WOTR_Aura_MordorHeavyArmor"]),
        ("MordorMountainTroll", "горный тролль", CAP_REGULAR, []),
        ("MordorAttackTroll", "атакующий тролль", CAP_REGULAR, []),
        ("MordorDrummerTroll", "барабанный тролль", CAP_REGULAR, []),
        ("MordorCatapult", "катапульта Мордора", CAP_NONE, []),
        ("MordorBatteringRam", "таран Мордора", CAP_NONE, []),
        ("MordorSiegeTower", "осадная башня", CAP_NONE, []),
        ("MordorMumakil", "мумак", CAP_REGULAR, []),
        ("MordorBlackRiderHorde", "чёрные всадники", CAP_HEROIC, []),
    ],
    "goblins": [
        ("GoblinFighterHorde", "гоблины-мечники", CAP_REGULAR,
         ["WOTR_Aura_WildForgedBlades", "WOTR_Aura_WildHeavyArmor"]),
        ("GoblinArcherHorde", "гоблины-лучники", CAP_REGULAR,
         ["WOTR_Aura_WildFireArrows", "WOTR_Aura_WildHeavyArmor"]),
        ("WildSpiderlingHorde", "паучата", CAP_REGULAR,
         ["WOTR_Aura_WildSpiderVenomSacks"]),
        ("GoblinSpiderRiderHorde", "всадники на пауках", CAP_REGULAR,
         ["WOTR_Aura_WildForgedBlades", "WOTR_Aura_WildFireArrows"]),
        ("WildMarauderHorde", "мародёры", CAP_REGULAR,
         ["WOTR_Aura_WildForgedBlades", "WOTR_Aura_WildHeavyArmor"]),
        ("WildMarauderSwordHorde", "мародёры-мечники", CAP_REGULAR,
         ["WOTR_Aura_WildForgedBlades", "WOTR_Aura_WildHeavyArmor"]),
        ("WildMountainGiant", "горный великан", CAP_REGULAR, []),
        ("GoblinCaveTroll", "пещерный тролль", CAP_REGULAR, []),
        ("WildBabyDrakeHorde", "драконы", CAP_HEROIC, []),
    ],
    "angmar": [
        ("AngmarDarkDunedainHorde", "дунэдайн", CAP_REGULAR,
         ["WOTR_Aura_AngmarDarkIronBlades", "WOTR_Aura_AngmarDarkIronArmor"]),
        ("AngmarDarkRangerHorde", "тёмные следопыты", CAP_REGULAR,
         ["WOTR_Aura_AngmarIceArrows"]),
        ("AngmarDireWolfHorde", "лютоволки", CAP_REGULAR,
         ["WOTR_Aura_AngmarSpikedCollar"]),
        ("AngmarSnowTrollHorde", "снежные тролли", CAP_REGULAR,
         ["WOTR_Aura_AngmarDarkIronBlades", "WOTR_Aura_AngmarDarkIronArmor"]),
        ("AngmarHillTrollHorde", "горные тролли", CAP_REGULAR,
         ["WOTR_Aura_AngmarDarkIronBlades", "WOTR_Aura_AngmarDarkIronArmor"]),
        ("AngmarOrcWarriors", "орки Ангмара", CAP_REGULAR, []),
        ("AngmarWolfRiders", "волчьи всадники", CAP_REGULAR,
         ["WOTR_Aura_IsengardForgedBlades", "WOTR_Aura_IsengardHeavyArmor"]),
        ("AngmarRhudaurSpearmen", "копейщики Рудаура", CAP_REGULAR, []),
        ("AngmarRhudaurSlingers", "пращники Рудаура", CAP_REGULAR,
         ["WOTR_Aura_DwarvenFireArrows", "WOTR_Aura_DwarvenMithrilMail"]),
        ("AngmarThrallMaster", "мастер рабов", CAP_REGULAR, []),
        ("AngmarTrollSling", "тролль-пращник", CAP_NONE,
         ["WOTR_Aura_AngmarIceShot"]),
        ("AngmarNecromancerHorde", "некроманты", CAP_REGULAR, []),
    ],
}

OBJECT_NAME = "WOTRTemporaryVictoryAnchor"

# ---------------------------------------------------------------------------
# ГЕРОИ. Порядок в списке = номер Upgrade_AllFactionHeroUpgrade[N] (1-based).
# ---------------------------------------------------------------------------
HEROES = {
    "men": ["RohanEowyn", "RohanEomer", "GondorBoromir", "RohanTheoden",
            "GondorFaramir", "GondorAragornMP", "GondorGandalf"],
    "elves": ["ElvenHaldir", "ElvenGlorfindel", "ElvenArwen", "ElvenLegolas",
              "ElvenThranduil", "ElvenElrond"],
    "dwarves": ["DwarvenCaptainofDale", "DwarvenGloin", "DwarvenGimli", "DwarvenDain"],
    "isengard": ["IsengardWormTongue", "IsengardLurtz", "IsengardSharku", "IsengardSaruman"],
    "mordor": ["MordorGothmog", "MordorMouthOfSauron", "KhamulFellBeast",
               "MorgomirFellBeast", "MordorWitchKingOnFellBeast"],
    "goblins": ["WildGoblinKing", "WildAzog", "WildShelob", "Drogoth"],
    "angmar": ["AngmarHwaldar", "AngmarKarsh", "AngmarMorgomir",
               "AngmarRogash", "AngmarWitchking"],
    "arnor": ["ArnorArgeleb", "ArnorArveleg", "ArnorArvedui", "ArnorCaptain"],
}

# Кольцевые герои: добро/зло (выбираются любой фракцией соответствующей стороны,
# без апгрейдов и уровня — у них всегда 10).
RING_HEROES = {
    "good": ["ElvenGaladriel_RingHero"],
    "evil": ["MordorSauron_RingHero"],
}

# Стороны по фракции (для выбора кольцевого героя).
GOOD_FACTIONS = {"men", "elves", "dwarves"}
EVIL_FACTIONS = {"isengard", "mordor", "goblins", "angmar"}

# Уровень героев: 1..10 (все герои — «героические», лимит 10).
HERO_LEVEL_CAP = 10

# ---------------------------------------------------------------------------
# Параметры кольцевой расстановки
# ---------------------------------------------------------------------------
HERO_RADIUS = 95        # радиус линии героев (у ворот крепости)
HERO_SPACING = 20       # расстояние между героями вдоль касательной
RING1_RADIUS = 140      # радиус первого кольца юнитов
RING_GAP = 70           # зазор между кольцами
MAX_PER_RING = 8        # макс. юнитов на одном кольце
RING_HERO_RADIUS = 280  # кольцевой герой — дальнее кольцо

# Направление ворот по фракциям (геом. угол в градусах от +X против ч.с.).
# 45° = северо-восток (вверх-вправо на экране).
GATE_ANGLES = {
    "men":      45,
    "elves":    45,
    "dwarves":  45,
    "isengard": 45,
    "mordor":   45,
    "goblins":  45,
    "angmar":   45,
}


# ---------------------------------------------------------------------------
# Хелперы по ростеру
# ---------------------------------------------------------------------------
def roster(faction):
    """Список кортежей (unit, label, level_cap, upgrades) для фракции."""
    return ROSTER.get(faction, [])


def upgrade_for(faction):
    return FACTION_UPGRADES.get(faction, "Upgrade_AllFactionUpgrade")


def heroes_for(faction):
    """Список имён героев фракции (в порядке нумерации апгрейдов)."""
    return HEROES.get(faction, [])


def hero_number(faction, hero_name):
    """1-based номер героя во фракции (для Upgrade_AllFactionHeroUpgrade[N])."""
    hlist = HEROES.get(faction, [])
    if hero_name in hlist:
        return hlist.index(hero_name) + 1
    return None


def faction_alignment(faction):
    """'good' / 'evil' / None — сторона фракции (для кольцевого героя)."""
    if faction in GOOD_FACTIONS:
        return "good"
    if faction in EVIL_FACTIONS:
        return "evil"
    return None


def level_aura(level):
    if level and level >= 2:
        return f"WOTR_Aura_Level{level}"
    return None


def random_squads(faction, max_squads=5):
    """Случайный состав отрядов: случайные юниты, апгрейды и уровни.

    Возвращает [{"unit":..., "level":N, "upgrades":[...]}].
    """
    roster_list = roster(faction)
    if not roster_list:
        return []
    n = random.randint(1, min(max_squads, len(roster_list)))
    squads = []
    for _ in range(n):
        unit, _label, cap, upg = random.choice(roster_list)
        level = random.randint(1, cap) if cap >= 1 else 0
        chosen = random.sample(upg, random.randint(0, len(upg))) if upg else []
        squads.append({"unit": unit, "level": level, "upgrades": chosen})
    return squads


def random_heroes(faction):
    """Случайный выбор героев: каждый герой с шансом 50% (0..все), уровни 1..10."""
    out = []
    for h in heroes_for(faction):
        if random.random() < 0.5:
            out.append({"hero": h, "level": random.randint(1, 10)})
    return out


def random_ring_hero(faction):
    """Случайно включить кольцевого героя (50%) или нет."""
    alignment = faction_alignment(faction)
    if alignment and random.random() < 0.5:
        return [RING_HEROES[alignment][0]]
    return []


def random_hero_names(faction):
    """Случайный набор имён героев (без уровней) — каждый с шансом 50%."""
    return [h for h in heroes_for(faction) if random.random() < 0.5]


def random_mechanics():
    """Случайные значения новых WOTR-механик (золото / ОК / огонь / PP).

    Возвращает dict:
        gold            — бонусные стартовые деньги (int)
        command_points  — дополнительные командные очки (int)
        signal_fire     — True/False (сигнальный огонь)
        start_pp        — стартовые очки палантира 0..10 (int)
        pp_rate         — прирост PP каждые 2 минуты 1..5 (int)
    """
    return {
        "gold": random.randint(*MECH_GOLD_RANGE),
        "command_points": random.randint(*MECH_CP_RANGE),
        "signal_fire": random.random() < SIGNAL_FIRE_CHANCE,
        "start_pp": random.randint(*MECH_START_PP_RANGE),
        "pp_rate": random.randint(*MECH_PP_RATE_RANGE),
    }


def _short(aura):
    return aura.replace("WOTR_Aura_", "").replace("WOTR_Grant_", "")


# ---------------------------------------------------------------------------
# Кольцевая расстановка — геометрия
# ---------------------------------------------------------------------------
def unit_position(index, total, radius, ring_offset_deg=0.0):
    """Позиция юнита на кольце.

    index:           порядковый номер (0..total-1)
    total:           сколько юнитов в этом кольце
    radius:          радиус кольца
    ring_offset_deg: 0 для ring0, 22.5 для ring1 (шахматка)

    Возвращает (x, y, face_angle).
    """
    step = 360.0 / total
    alpha = index * step + ring_offset_deg
    alpha_rad = math.radians(alpha)

    x = round(radius * math.cos(alpha_rad))
    y = round(-radius * math.sin(alpha_rad))       # экранная инверсия
    face_angle = round((360 - alpha) % 360)         # лицом наружу

    return x, y, face_angle


def hero_positions(heroes, gate_angle_deg, radius=HERO_RADIUS,
                   spacing=HERO_SPACING):
    """Позиции героев вдоль линии у ворот.

    heroes:          список героев (любые объекты — просто пробрасываются)
    gate_angle_deg:  направление ворот (геом. угол)
    radius:          расстояние от центра до линии героев
    spacing:         расстояние между героями вдоль касательной

    Центральный герой — посередине списка.
    Остальные расходятся симметрично вдоль касательной.

    Возвращает [(hero, x, y, face_angle), ...].
    """
    alpha = math.radians(gate_angle_deg)
    cx = radius * math.cos(alpha)
    cy = -radius * math.sin(alpha)

    # касательная (по часовой от направления ворот)
    tx = math.sin(alpha)
    ty = math.cos(alpha)

    n = len(heroes)
    mid = n // 2

    positions = []
    for i, hero in enumerate(heroes):
        offset = (i - mid) * spacing
        hx = round(cx + offset * tx)
        hy = round(cy + offset * ty)
        face_angle = round((360 - gate_angle_deg) % 360)
        positions.append((hero, hx, hy, face_angle))
    return positions


def distribute_units(units):
    """Раскладывает юнитов по кольцам.

    units: список любых объектов.

    Возвращает список колец:
      [[ {"item": unit, "x": x, "y": y, "angle": angle}, ... ], ...]

    Неполное кольцо → шаг увеличивается автоматически (360/N).
    Чётные кольца: offset=0°, нечётные: offset=22.5° (шахматка).
    """
    rings = []
    remaining = list(units)
    ring_index = 0

    while remaining:
        batch = remaining[:MAX_PER_RING]
        remaining = remaining[MAX_PER_RING:]
        radius = RING1_RADIUS + ring_index * RING_GAP
        offset = (ring_index % 2) * 22.5       # шахматка

        ring = []
        for i, unit in enumerate(batch):
            x, y, angle = unit_position(i, len(batch), radius, offset)
            ring.append({"item": unit, "x": x, "y": y, "angle": angle})
        rings.append(ring)
        ring_index += 1

    return rings


# ---------------------------------------------------------------------------
# Сборка ini и .big
# ---------------------------------------------------------------------------
# Базовый объект золота — генерируется ОДИН раз (проверенный рабочий код:
# арт PchestTreasure, SalvageCrateCollide + DeletionUpdate). Дочерние объекты
# (WOTR_StartingGold_Player_N) переопределяют суммы и «вечность» через
# ReplaceModule ModuleTag_02 / ModuleTag_03.
GOLD_BASE_OBJECT = """\
Object WOTR_StartingGold

  ; *** ART Parameters *** (Any art changes made to this Object, please copy over to SalvageCrate_Final below)
  Draw = W3DScriptedModelDraw ModuleTag_01
    DefaultModelConditionState
      Model = PchestTreasure
      ParticleSysBone NONE GoldChestGlimmer
      ParticleSysBone NONE GoldChestGlimmer02
      ParticleSysBone NONE GoldChestRedGlimmer
      ParticleSysBone NONE GoldChestGreenGlimmer
      ParticleSysBone NONE GoldChestAura
    End
  End
  ; ***DESIGN parameters ***
  EditorSorting   = MISC_MAN_MADE
  DisplayName        = OBJECT:TreasureChest
    Side             = Civilian
  ; *** ENGINEERING Parameters ***
  KindOf = SELECTABLE PARACHUTABLE IMMOBILE NOT_AUTOACQUIRABLE UNATTACKABLE CRATE
  ThreatLevel = 0.0

  Body = HighlanderBody ModuleTag_04
    MaxHealth      = 1.0
  End

  Behavior = SalvageCrateCollide ModuleTag_02
    ForbiddenKindOf = PROJECTILE ENVIRONMENT IGNORED_IN_GUI
    ExecuteFX = FX_GoldChestPickup
    BannerChance = 10%
    LevelUpChance = 100%
    LevelUpRadius = 100.0
    ResourceChance = 20%
    MinResource = 25
    MaxResource = 75
    AllowAIPickup = No
  End
  Behavior = DeletionUpdate ModuleTag_03
    MinLifetime = 30000
    MaxLifetime = 35000
  End
  Geometry = BOX
  GeometryMajorRadius = 12.0
  GeometryMinorRadius = 12.0
  GeometryHeight = 12.0
  GeometryIsSmall = Yes
  Shadow          = SHADOW_VOLUME
End
"""


def build_gold_base():
    """Базовый объект WOTR_StartingGold (полный код, генерируется один раз)."""
    return GOLD_BASE_OBJECT + "\n"


def build_gold_child(slot, amount):
    """ChildObject WOTR_StartingGold_Player_N — суммы золота для конкретного
    игрока. Переопределяет модули базового объекта:
      * ModuleTag_02 (SalvageCrateCollide): 100% шанс, Min = Max = amount
        (рандома нет), AllowAIPickup = Yes, ExecuteFX сохранён;
      * ModuleTag_03 (DeletionUpdate): Min/MaxLifetime = -1 (сундук НЕ исчезает,
        пока игрок не подберёт золото)."""
    return "\n".join([
        f"ChildObject WOTR_StartingGold_Player_{slot} WOTR_StartingGold",
        "",
        "    ReplaceModule ModuleTag_02",
        "",
        "        Behavior = SalvageCrateCollide ModuleTag_022",
        "",
        "            ForbiddenKindOf = PROJECTILE ENVIRONMENT IGNORED_IN_GUI NEUTRALGOLLUM",
        "            BannerChance = 0%",
        "            LevelUpChance = 0%",
        "            LevelUpRadius = 0.0",
        "            ResourceChance = 100%",
        f"            MinResource = {amount}",
        f"            MaxResource = {amount}",
        "            AllowAIPickup = Yes",
        "            ExecuteFX = FX_GoldChestPickup",
        "        End",
        "",
        "    End",
        "",
        "    ReplaceModule ModuleTag_03",
        "",
        "        Behavior = DeletionUpdate ModuleTag_033",
        "",
        "            MinLifetime = -1",
        "            MaxLifetime = -1",
        "        End",
        "",
        "    End",
        "",
        "End",
        "",
    ])


def build_command_point_child(slot, cp):
    """ChildObject WOTR_CommandPointBonus_Player_N — доп. командные очки."""
    return "\n".join([
        f"ChildObject WOTR_CommandPointBonus_Player_{slot} WOTR_CommandPointBonus",
        f"    CommandPointBonus = {cp}",
        "End",
        "",
    ])


def _spawn_module(tag, trigger, thing, x=0, y=0, indent=0):
    """AddModule-блок ObjectCreationUpgrade (спавн в якоре).

    indent — отступ в пробелах (4 = внутри Object WOTRTemporaryVictoryAnchor).
    """
    pad = " " * indent
    return "\n".join([
        f"{pad}AddModule",
        f"{pad}    Behavior = ObjectCreationUpgrade {tag}",
        f"{pad}        TriggeredBy  = {trigger}",
        f"{pad}        ThingToSpawn = {thing}",
        f"{pad}        Offset       = X:{x} Y:{y} Z:0",
        f"{pad}    End",
        f"{pad}End",
    ])


def _module_lines(e):
    """AddModule-блок для записи из словаря (для тегов U*/R*/H*/B* и т.п.)."""
    x, y = e.get("x", 0), e.get("y", 0)
    lines = [
        "    AddModule",
        f"        Behavior = ObjectCreationUpgrade {e['tag']}",
        f"            TriggeredBy  = {e['trigger']}",
        f"            ThingToSpawn = {e['unit']}",
        f"            Offset       = X:{x} Y:{y} Z:0",
    ]
    if "angle" in e and e["angle"] is not None:
        lines.append(f"            Angle        = {e['angle']}")
    lines += ["        End", "    End"]
    return lines


def build_ini(entries):
    """; starting armies + auras (generated by bridge/spawn.py)"""
    lines = ["; starting armies + auras (generated by bridge/spawn.py)",
             f"Object {OBJECT_NAME}"]
    for e in entries:
        lines.extend(_module_lines(e))
    lines.append("End")
    lines.append("")
    return "\n".join(lines)


def build_hero_mod(hero_name, upgrade_num, level):
    """Object-блок модификации героя: GrantUpgradeCreate + ExperienceLevelCreate."""
    lines = [f"Object {hero_name}"]
    lines.append("    AddModule")
    lines.append("        Behavior = GrantUpgradeCreate ModuleTag_HeroUpgradeGrant")
    lines.append(f"            UpgradeToGrant = Upgrade_AllFactionHeroUpgrade{upgrade_num}")
    lines.append("        End")
    lines.append("    End")
    lines.append("    AddModule")
    lines.append("        Behavior = ExperienceLevelCreate ModuleTag_MPLevelBonus")
    lines.append(f"            LevelToGrant = {level}")
    lines.append("        End")
    lines.append("    End")
    lines.append("End")
    lines.append("")
    return "\n".join(lines)


def build_big(fourcc, files):
    header_len = 16
    entries_len = sum(8 + len(n.encode("latin-1")) + 1 for n, _ in files)
    data_start = header_len + entries_len

    data_block = b""
    offsets = []
    cur = data_start
    for _n, d in files:
        offsets.append(cur)
        data_block += d
        cur += len(d)
    total = cur

    out = bytearray()
    out += fourcc
    out += struct.pack("<I", total)
    out += struct.pack(">I", len(files))
    out += struct.pack(">I", data_start)
    for (n, _d), off in zip(files, offsets):
        out += struct.pack(">I", off)
        out += struct.pack(">I", len(_d))
        out += n.encode("latin-1") + b"\x00"
    out += data_block
    return bytes(out)


def generate_spawn_big(out_path, factions_by_slot, player_squads,
                       player_heroes=None, ring_heroes=None,
                       player_mechanics=None,
                       gate_angle_deg=None,
                       internal_path=SPAWN_INTERNAL_PATH,
                       fourcc=b"BIGF"):
    """Сгенерировать .big-патч спавна «WOTR Generated Presets».

    Выходной файл: __wotr_generated_presets.big (по умолчанию), внутри:
      data\\ini\\object\\zzz_wotr\\system\\zzz_spawn.ini

    Содержимое (порядок как в ТЗ):
      1. Object WOTR_StartingGold — базовый объект золота (один раз, полный
         код) + ChildObject WOTR_StartingGold_Player_N с ReplaceModule
         (Min = Max = значение);
      2. ChildObject WOTR_CommandPointBonus_Player_N — доп. командные очки;
      3. Object WOTRTemporaryVictoryAnchor — якорь, который спавнит:
           - золото (модули ModuleTag_Gold_N, Offset 0:0:0);
           - командные очки (ModuleTag_CP_N, Offset 0:0:0);
           - сигнальный огонь (ModuleTag_SignalFire_N, за картой 9999:9999)
             — только если signal_fire = True;
           - стартовые PP (ModuleTag_StartPP_N → WOTR_StartPP_<N>);
           - прирост PP (ModuleTag_PPRate_N → WOTR_PPRate_<N>);
           - стартовую армию (кольцевая расстановка) — «всё остальное».

    Аргументы:
      factions_by_slot — {slot: faction_key}, слот 0 = игрок, 2..N = боты.
      player_squads — отряды игрока: [{"unit":..., "level":N,
                       "upgrades":[aura...]}, ...] (может быть пустым).
      player_heroes — герои игрока: [{"hero":..., "level":N}, ...].
      ring_heroes  — кольцевые герои (без уровня/апгрейдов).
      player_mechanics — значения новых механик для игрока (слот 1):
          {"gold": int, "command_points": int, "signal_fire": bool,
           "start_pp": int, "pp_rate": int}
          None = случайные (random_mechanics()).
      gate_angle_deg — направление ворот; None = авто по фракции.

    Боты получают случайные значения всех механик (random_mechanics()) и
    случайный состав войск — как и раньше.

    Возвращает (True, ini_text) или (False, [ошибки]).
    """
    # --- Армия (кольцевая расстановка, как раньше) ---
    entries = []
    hero_mods = []
    tag_i = 0

    def add(thing, trigger, x, y, prefix, angle=None):
        nonlocal tag_i
        e = {"unit": thing, "trigger": trigger,
             "x": int(x), "y": int(y), "tag": f"ModuleTag_{prefix}{tag_i}"}
        if angle is not None:
            e["angle"] = int(angle)
        entries.append(e)
        tag_i += 1

    player_faction = factions_by_slot.get(0)
    if player_faction is None:
        return False, ["не задана фракция игрока (слот 0)"]

    trig = upgrade_for(player_faction)
    gate = gate_angle_deg if gate_angle_deg is not None \
        else GATE_ANGLES.get(player_faction, 45)

    def add_squad(sq, trigger, x, y, angle, prefix):
        """Спавнить отряд (с Angle) + ауры + ауру уровня (без Angle)."""
        add(sq["unit"], trigger, x, y, prefix, angle=angle)
        for aura in sq.get("upgrades", []):
            add(aura, trigger, x, y, prefix + "a")
        la = level_aura(sq.get("level"))
        if la:
            add(la, trigger, x, y, prefix + "l")

    # --- Игрок: отряды (кольцами) ---
    unit_rings = distribute_units(player_squads)
    ring_prefixes = ["U", "R2", "R3", "R4", "R5", "R6", "R7", "R8"]
    for ri, ring in enumerate(unit_rings):
        prefix = ring_prefixes[ri] if ri < len(ring_prefixes) else f"R{ri}"
        for slot in ring:
            sq = slot["item"]
            add_squad(sq, trig, slot["x"], slot["y"], slot["angle"], prefix)

    # --- Игрок: герои (линия у ворот) ---
    heroes = player_heroes or []
    if heroes:
        hero_items = [h["hero"] for h in heroes]
        hpos = hero_positions(hero_items, gate)
        for (hname, hx, hy, hangle), hdata in zip(hpos, heroes):
            add(hname, trig, hx, hy, "H", angle=hangle)
            num = hero_number(player_faction, hname)
            if num is None:
                return False, [f"герой {hname} не найден у фракции {player_faction}"]
            hero_mods.append(build_hero_mod(hname, num, hdata["level"]))

    # --- Игрок: кольцевые герои (дальнее кольцо) ---
    rings_list = ring_heroes or []
    if rings_list:
        for i, r in enumerate(rings_list):
            step = 360.0 / max(len(rings_list), 1)
            alpha = gate + i * step
            alpha_rad = math.radians(alpha)
            rx = round(RING_HERO_RADIUS * math.cos(alpha_rad))
            ry = round(-RING_HERO_RADIUS * math.sin(alpha_rad))
            rangle = round((360 - alpha) % 360)
            add(r, trig, rx, ry, "RH", angle=rangle)

    # --- Боты (кольцевая расстановка, случайный состав) ---
    for slot, fac in sorted(factions_by_slot.items()):
        if slot == 0:
            continue
        trig_b = upgrade_for(fac)
        bgate = GATE_ANGLES.get(fac, 45)

        # случайные отряды
        bsquads = random_squads(fac)
        bot_rings = distribute_units(bsquads)
        for ri, ring in enumerate(bot_rings):
            for s in ring:
                sq = s["item"]
                add_squad(sq, trig_b, s["x"], s["y"], s["angle"], "B")

        # случайные герои бота (линия у ворот)
        bheroes_names = random_hero_names(fac)
        if bheroes_names:
            bhpos = hero_positions(bheroes_names, bgate)
            for bname, bx, by, bangle in bhpos:
                add(bname, trig_b, bx, by, "BH", angle=bangle)
                num = hero_number(fac, bname)
                if num is not None:
                    hero_mods.append(build_hero_mod(bname, num,
                                                    random.randint(1, 10)))

    # --- Новые механики (золото / ОК / огонь / PP) по слотам ---
    # Игрок (слот 1) — из опроса (или рандом), боты — всегда рандом.
    mech = {}
    for slot, fac in sorted(factions_by_slot.items()):
        if slot == 0:
            # слот 0 в словаре = игрок; в файле он слот 1
            mech[1] = dict(player_mechanics) if player_mechanics \
                else random_mechanics()
        else:
            mech[slot] = random_mechanics()

    # --- Сборка ini ---
    header = "\n".join([
        "; ============================================================",
        "; WOTR Generated Presets",
        f"; Путь: {SPAWN_INTERNAL_PATH}",
        "; ВНИМАНИЕ: файл генерируется автоматически, не редактировать",
        "; ============================================================",
        "",
    ])

    # 1. Стартовое золото: базовый объект (один раз) + дочерние по слотам
    ini_text = header
    ini_text += ("; --- Стартовое золото: базовый объект + дочерние "
                 "(все игроки) ---\n")
    ini_text += build_gold_base()
    for slot in sorted(mech):
        ini_text += build_gold_child(slot, mech[slot]["gold"])
    ini_text += "\n"

    # 2. Командные очки (все игроки)
    ini_text += "; --- Командные очки (все игроки) ---\n"
    for slot in sorted(mech):
        ini_text += build_command_point_child(slot, mech[slot]["command_points"])
    ini_text += "\n"

    # 3. Якорь (спавн всего)
    ini_text += f"; --- Якорь (спавн всего) ---\nObject {OBJECT_NAME}\n\n"
    for slot in sorted(mech):
        m = mech[slot]
        trig_slot = upgrade_for(factions_by_slot.get(0 if slot == 1 else slot))
        ini_text += f"    ; Золото (слот {slot})\n"
        ini_text += _spawn_module(f"ModuleTag_Gold_{slot}", trig_slot,
                                  f"WOTR_StartingGold_Player_{slot}", indent=4)
        ini_text += "\n\n"
        ini_text += f"    ; Командные очки (слот {slot})\n"
        ini_text += _spawn_module(f"ModuleTag_CP_{slot}", trig_slot,
                                  f"WOTR_CommandPointBonus_Player_{slot}", indent=4)
        ini_text += "\n\n"
        if m["signal_fire"]:
            ini_text += f"    ; Сигнальный огонь (слот {slot}) — за пределами карты\n"
            ini_text += _spawn_module(f"ModuleTag_SignalFire_{slot}", trig_slot,
                                      "SignalFire", x=9999, y=9999, indent=4)
            ini_text += "\n\n"
        ini_text += f"    ; Стартовые PP (слот {slot})\n"
        ini_text += _spawn_module(f"ModuleTag_StartPP_{slot}", trig_slot,
                                  f"WOTR_StartPP_{m['start_pp']}", indent=4)
        ini_text += "\n\n"
        ini_text += f"    ; Прирост PP каждые 2 минуты (слот {slot})\n"
        ini_text += _spawn_module(f"ModuleTag_PPRate_{slot}", trig_slot,
                                  f"WOTR_PPRate_{m['pp_rate']}", indent=4)
        ini_text += "\n\n"

    # 4. Стартовая армия (кольцевая расстановка) — «всё остальное»
    ini_text += "    ; --- Стартовая армия (кольцевая расстановка) ---\n"
    for e in entries:
        ini_text += "\n".join(_module_lines(e)) + "\n"
    ini_text += "End\n"
    ini_text += "\n"

    if hero_mods:
        ini_text += "\n".join(hero_mods)

    # cp1251: для чистого ASCII байты идентичны latin-1, но позволяет
    # писать русские комментарии в шапке файла (см. WOTR Generated Presets).
    ini = ini_text.encode("cp1251", errors="replace")
    big = build_big(fourcc, [(internal_path, ini)])

    parent = os.path.dirname(os.path.abspath(out_path))
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(big)
    return True, ini_text
