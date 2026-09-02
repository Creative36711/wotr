# Юниты RotWK 2.01 — ростер и спавнящиеся объекты

Полный список отрядов по фракциям. Для каждого отряда указаны объекты,
которые спавнятся вместе с ним (`ThingToSpawn`).

**Уровни:** обычные отряды — до 5, героические (⭐) — до 10, без уровня (🔧) — осадные орудия, энты и т.п.
**Уровень** спавнится объектом `WOTR_Aura_LevelN` (N = 2..10; уровень 1 — базовый, без ауры). Для юнитов 🔧 аура уровня не спавнится.
**Апгрейды** — объекты `WOTR_Aura_*`, спавнятся в одной точке с отрядом.

## Люди (Gondor/Rohan) (`men`)

| Отряд | Ур. лимит | Спавнящиеся ауры апгрейдов |
|---|---|---|
| `GondorFighterHorde` | 5 | `WOTR_Aura_GondorForgedBlades`, `WOTR_Aura_GondorHeavyArmor` |
| `GondorTowerShieldGuardHorde` | 5 | `WOTR_Aura_GondorForgedBlades`, `WOTR_Aura_GondorHeavyArmor` |
| `GondorArcherHorde` | 5 | `WOTR_Aura_GondorFireArrows`, `WOTR_Aura_GondorHeavyArmor` |
| `GondorRangerHorde` | 5 | `WOTR_Aura_GondorFireArrows` |
| `GondorKnightHorde` | 5 | `WOTR_Aura_GondorForgedBlades`, `WOTR_Aura_GondorHeavyArmor`, `WOTR_Aura_GondorKnightShield` |
| `RohanRohirrimHorde` | 5 | `WOTR_Aura_RohanForgedBladesForRohirrim`, `WOTR_Aura_RohanHeavyArmorForRohirrim`, `WOTR_Aura_RohanFireArrows` |
| `RohanSpearmenHorde` | 5 | `WOTR_Aura_GondorForgedBlades`, `WOTR_Aura_GondorHeavyArmor` |
| `GondorTrebuchet` | 🔧 | `WOTR_Aura_GondorFireStones` |
| `GondorKnightsofDolHorde` | 10 ⭐ | `WOTR_Aura_ElvenForgedBlades`, `WOTR_Aura_ElderRacesWarBarding` |

## Эльфы (`elves`)

| Отряд | Ур. лимит | Спавнящиеся ауры апгрейдов |
|---|---|---|
| `ElvenLorienWarriorHorde` | 5 | `WOTR_Aura_ElvenForgedBlades`, `WOTR_Aura_ElvenHeavyArmor`, `WOTR_Aura_ElvenSilverthornArrows` |
| `ElvenLorienArcherHorde` | 5 | `WOTR_Aura_ElvenForgedBlades`, `WOTR_Aura_ElvenHeavyArmor`, `WOTR_Aura_ElvenSilverthornArrows` |
| `ElvenMirkwoodArcherHorde` | 5 | `WOTR_Aura_ElvenSilverthornArrows` |
| `ElvenMithlondSentryHorde` | 5 | `WOTR_Aura_ElvenForgedBlades`, `WOTR_Aura_ElvenHeavyArmor` |
| `ElvenRivendellLancerHorde` | 5 | `WOTR_Aura_ElvenForgedBlades`, `WOTR_Aura_ElderRacesWarBarding` |
| `ElvenRivendellArcherHorde` | 5 | `WOTR_Aura_ElvenSilverthornArrows`, `WOTR_Aura_ElvenHeavyArmor` |
| `RohanGenericEnt` | 🔧 | — |
| `NoldorWarriorHorde` | 10 ⭐ | `WOTR_Aura_ElvenForgedBlades`, `WOTR_Aura_ElvenSilverthornArrows` |

## Гномы (`dwarves`)

| Отряд | Ур. лимит | Спавнящиеся ауры апгрейдов |
|---|---|---|
| `DwarvenGuardianHorde` | 5 | `WOTR_Aura_DwarvenForgedBlades`, `WOTR_Aura_DwarvenMithrilMail`, `WOTR_Aura_DwarvenSiegeHammer` |
| `DwarvenAxeThrowerHorde` | 5 | `WOTR_Aura_DwarvenForgedBlades`, `WOTR_Aura_DwarvenMithrilMail` |
| `DwarvenPhalanxHorde` | 5 | `WOTR_Aura_DwarvenForgedBlades`, `WOTR_Aura_DwarvenMithrilMail` |
| `DwarvenMenOfDaleHorde` | 5 | `WOTR_Aura_DwarvenFireArrows`, `WOTR_Aura_DwarvenMithrilMail` |
| `DwarvenBattleWagon` | 5 | — |
| `DwarvenCatapult` | 🔧 | `WOTR_Grant_DwarvenFlamingShot` |
| `DwarvenZerkerHorde` | 10 ⭐ | — |

## Изенгард (`isengard`)

| Отряд | Ур. лимит | Спавнящиеся ауры апгрейдов |
|---|---|---|
| `IsengardFighterHorde` | 5 | `WOTR_Aura_IsengardForgedBlades`, `WOTR_Aura_IsengardHeavyArmor` |
| `IsengardPikemanHorde` | 5 | `WOTR_Aura_IsengardForgedBlades`, `WOTR_Aura_IsengardHeavyArmor` |
| `IsengardWildmanHorde` | 5 | `WOTR_Aura_IsengardTorches`, `WOTR_Aura_IsengardHeavyArmor` |
| `IsengardWildmanAxeHorde` | 5 | `WOTR_Aura_DwarvenFireArrows`, `WOTR_Aura_IsengardHeavyArmor` |
| `IsengardUrukCrossbowHorde` | 5 | `WOTR_Aura_IsengardFireArrows`, `WOTR_Aura_IsengardHeavyArmor` |
| `IsengardWargRiderHorde` | 5 | `WOTR_Aura_IsengardForgedBlades`, `WOTR_Aura_IsengardHeavyArmor` |
| `IsengardWargPackHorde` | 5 | `WOTR_Aura_IsengardForgedBlades`, `WOTR_Aura_IsengardHeavyArmor` |
| `IsengardBallista` | 🔧 | — |
| `IsengardBatteringRam` | 🔧 | — |
| `IsengardExplosiveMine` | 🔧 | — |
| `IsengardSiegeLadder` | 🔧 | — |
| `IsengardBeserker` | 5 | — |
| `IsengardBerserkerHorde` | 10 ⭐ | — |

## Мордор (`mordor`)

| Отряд | Ур. лимит | Спавнящиеся ауры апгрейдов |
|---|---|---|
| `MordorFighterHorde` | 5 | `WOTR_Aura_MordorForgedBlades`, `WOTR_Aura_MordorHeavyArmor` |
| `MordorArcherHorde` | 5 | `WOTR_Aura_MordorFireArrows`, `WOTR_Aura_MordorHeavyArmor` |
| `MordorCorsairsOfUmbarHorde` | 5 | `WOTR_Aura_MordorForgedBlades` |
| `MordorHaradrimArcherHorde` | 5 | `WOTR_Aura_MordorFireArrows`, `WOTR_Aura_MordorHeavyArmor` |
| `MordorEasterlingHorde` | 5 | `WOTR_Aura_MordorHeavyArmor` |
| `MordorBlackOrcHorde` | 5 | `WOTR_Aura_MordorForgedBlades`, `WOTR_Aura_MordorHeavyArmor` |
| `MordorHaradrimRiderHorde` | 5 | `WOTR_Aura_MordorForgedBlades`, `WOTR_Aura_MordorHeavyArmor` |
| `MordorMountainTroll` | 5 | — |
| `MordorAttackTroll` | 5 | — |
| `MordorDrummerTroll` | 5 | — |
| `MordorCatapult` | 🔧 | — |
| `MordorBatteringRam` | 🔧 | — |
| `MordorSiegeTower` | 🔧 | — |
| `MordorMumakil` | 5 | — |
| `MordorBlackRiderHorde` | 10 ⭐ | — |

## Гоблины (Дикие) (`goblins`)

| Отряд | Ур. лимит | Спавнящиеся ауры апгрейдов |
|---|---|---|
| `GoblinFighterHorde` | 5 | `WOTR_Aura_WildForgedBlades`, `WOTR_Aura_WildHeavyArmor` |
| `GoblinArcherHorde` | 5 | `WOTR_Aura_WildFireArrows`, `WOTR_Aura_WildHeavyArmor` |
| `WildSpiderlingHorde` | 5 | `WOTR_Aura_WildSpiderVenomSacks` |
| `GoblinSpiderRiderHorde` | 5 | `WOTR_Aura_WildForgedBlades`, `WOTR_Aura_WildFireArrows` |
| `WildMarauderHorde` | 5 | `WOTR_Aura_WildForgedBlades`, `WOTR_Aura_WildHeavyArmor` |
| `WildMarauderSwordHorde` | 5 | `WOTR_Aura_WildForgedBlades`, `WOTR_Aura_WildHeavyArmor` |
| `WildMountainGiant` | 5 | — |
| `GoblinCaveTroll` | 5 | — |
| `WildBabyDrakeHorde` | 10 ⭐ | — |

## Ангмар (`angmar`)

| Отряд | Ур. лимит | Спавнящиеся ауры апгрейдов |
|---|---|---|
| `AngmarDarkDunedainHorde` | 5 | `WOTR_Aura_AngmarDarkIronBlades`, `WOTR_Aura_AngmarDarkIronArmor` |
| `AngmarDarkRangerHorde` | 5 | `WOTR_Aura_AngmarIceArrows` |
| `AngmarDireWolfHorde` | 5 | `WOTR_Aura_AngmarSpikedCollar` |
| `AngmarSnowTrollHorde` | 5 | `WOTR_Aura_AngmarDarkIronBlades`, `WOTR_Aura_AngmarDarkIronArmor` |
| `AngmarHillTrollHorde` | 5 | `WOTR_Aura_AngmarDarkIronBlades`, `WOTR_Aura_AngmarDarkIronArmor` |
| `AngmarOrcWarriors` | 5 | — |
| `AngmarWolfRiders` | 5 | `WOTR_Aura_IsengardForgedBlades`, `WOTR_Aura_IsengardHeavyArmor` |
| `AngmarRhudaurSpearmen` | 5 | — |
| `AngmarRhudaurSlingers` | 5 | `WOTR_Aura_DwarvenFireArrows`, `WOTR_Aura_DwarvenMithrilMail` |
| `AngmarThrallMaster` | 5 | — |
| `AngmarTrollSling` | 🔧 | `WOTR_Aura_AngmarIceShot` |
| `AngmarNecromancerHorde` | 5 | — |

---

Всего отрядов: **73**
*(включая осадные машины, троллей-одиночек и монстров; из них 11 без уровня 🔧)*

## Герои

Герои спавнятся объектом героя и модифицируются апгрейдом
`Upgrade_AllFactionHeroUpgrade[N]` (N — порядковый номер в списке фракции, с 1).

### Люди (Gondor/Rohan) (`men`)

- `RohanEowyn` → `Upgrade_AllFactionHeroUpgrade1`
- `RohanEomer` → `Upgrade_AllFactionHeroUpgrade2`
- `GondorBoromir` → `Upgrade_AllFactionHeroUpgrade3`
- `RohanTheoden` → `Upgrade_AllFactionHeroUpgrade4`
- `GondorFaramir` → `Upgrade_AllFactionHeroUpgrade5`
- `GondorAragornMP` → `Upgrade_AllFactionHeroUpgrade6`
- `GondorGandalf` → `Upgrade_AllFactionHeroUpgrade7`

### Эльфы (`elves`)

- `ElvenHaldir` → `Upgrade_AllFactionHeroUpgrade1`
- `ElvenGlorfindel` → `Upgrade_AllFactionHeroUpgrade2`
- `ElvenArwen` → `Upgrade_AllFactionHeroUpgrade3`
- `ElvenLegolas` → `Upgrade_AllFactionHeroUpgrade4`
- `ElvenThranduil` → `Upgrade_AllFactionHeroUpgrade5`
- `ElvenElrond` → `Upgrade_AllFactionHeroUpgrade6`

### Гномы (`dwarves`)

- `DwarvenCaptainofDale` → `Upgrade_AllFactionHeroUpgrade1`
- `DwarvenGloin` → `Upgrade_AllFactionHeroUpgrade2`
- `DwarvenGimli` → `Upgrade_AllFactionHeroUpgrade3`
- `DwarvenDain` → `Upgrade_AllFactionHeroUpgrade4`

### Изенгард (`isengard`)

- `IsengardWormTongue` → `Upgrade_AllFactionHeroUpgrade1`
- `IsengardLurtz` → `Upgrade_AllFactionHeroUpgrade2`
- `IsengardSharku` → `Upgrade_AllFactionHeroUpgrade3`
- `IsengardSaruman` → `Upgrade_AllFactionHeroUpgrade4`

### Мордор (`mordor`)

- `MordorGothmog` → `Upgrade_AllFactionHeroUpgrade1`
- `MordorMouthOfSauron` → `Upgrade_AllFactionHeroUpgrade2`
- `KhamulFellBeast` → `Upgrade_AllFactionHeroUpgrade3`
- `MorgomirFellBeast` → `Upgrade_AllFactionHeroUpgrade4`
- `MordorWitchKingOnFellBeast` → `Upgrade_AllFactionHeroUpgrade5`

### Гоблины (Дикие) (`goblins`)

- `WildGoblinKing` → `Upgrade_AllFactionHeroUpgrade1`
- `WildAzog` → `Upgrade_AllFactionHeroUpgrade2`
- `WildShelob` → `Upgrade_AllFactionHeroUpgrade3`
- `Drogoth` → `Upgrade_AllFactionHeroUpgrade4`

### Ангмар (`angmar`)

- `AngmarHwaldar` → `Upgrade_AllFactionHeroUpgrade1`
- `AngmarKarsh` → `Upgrade_AllFactionHeroUpgrade2`
- `AngmarMorgomir` → `Upgrade_AllFactionHeroUpgrade3`
- `AngmarRogash` → `Upgrade_AllFactionHeroUpgrade4`
- `AngmarWitchking` → `Upgrade_AllFactionHeroUpgrade5`

### Arnor (`arnor`)

- `ArnorArgeleb` → `Upgrade_AllFactionHeroUpgrade1`
- `ArnorArveleg` → `Upgrade_AllFactionHeroUpgrade2`
- `ArnorArvedui` → `Upgrade_AllFactionHeroUpgrade3`
- `ArnorCaptain` → `Upgrade_AllFactionHeroUpgrade4`

## Кольцевые герои

- Добро: `ElvenGaladriel_RingHero`
- Зло: `MordorSauron_RingHero`

Кольцевые герои без апгрейдов и уровня (всегда 10).

---

## Полный список аура-объектов (существуют в моде)

**Уровневые:** `WOTR_Aura_Level2` … `WOTR_Aura_Level10`.

**Апгрейды (полные имена):**

- **Люди:** `WOTR_Aura_GondorForgedBlades`, `WOTR_Aura_GondorHeavyArmor`, `WOTR_Aura_GondorFireArrows`, `WOTR_Aura_GondorKnightShield`, `WOTR_Aura_GondorFireStones`
- **Рохан:** `WOTR_Aura_RohanForgedBladesForRohirrim`, `WOTR_Aura_RohanHeavyArmorForRohirrim`, `WOTR_Aura_RohanFireArrows`
- **Эльфы:** `WOTR_Aura_ElvenForgedBlades`, `WOTR_Aura_ElvenHeavyArmor`, `WOTR_Aura_ElvenSilverthornArrows`, `WOTR_Aura_ElvenCloak`, `WOTR_Aura_ElderRacesWarBarding`
- **Гномы:** `WOTR_Aura_DwarvenForgedBlades`, `WOTR_Aura_DwarvenMithrilMail`, `WOTR_Aura_DwarvenFireArrows`, `WOTR_Aura_DwarvenSiegeHammer`, `WOTR_Grant_DwarvenFlamingShot`
- **Изенгард:** `WOTR_Aura_IsengardForgedBlades`, `WOTR_Aura_IsengardHeavyArmor`, `WOTR_Aura_IsengardFireArrows`, `WOTR_Aura_IsengardTorches`
- **Мордор:** `WOTR_Aura_MordorForgedBlades`, `WOTR_Aura_MordorHeavyArmor`, `WOTR_Aura_MordorFireArrows`
- **Гоблины:** `WOTR_Aura_WildForgedBlades`, `WOTR_Aura_WildHeavyArmor`, `WOTR_Aura_WildFireArrows`, `WOTR_Aura_WildSpiderVenomSacks`
- **Ангмар:** `WOTR_Aura_AngmarDarkIronBlades`, `WOTR_Aura_AngmarDarkIronArmor`, `WOTR_Aura_AngmarIceArrows`, `WOTR_Aura_AngmarSpikedCollar`, `WOTR_Aura_AngmarIceShot`
