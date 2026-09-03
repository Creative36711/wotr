import { DEFAULT_UNIT_MAX_LEVEL } from './progression'

/**
 * Per-object veterancy caps taken verbatim from
 * `_test_integration-bfme/docs/units_rotwk_2.01.md`:
 * regular hordes cap at 5, heroic hordes at 10, and siege/ent units have no
 * veterancy at all (0 - no WOTR_Aura_Level object is ever spawned for them).
 * Used as the default whenever a roster entry has no explicit `maxLevel`.
 */
export const ROTWK_UNIT_LEVEL_CAPS: Record<string, number> = {
  AngmarDarkDunedainHorde: 5,
  AngmarDarkRangerHorde: 5,
  AngmarDireWolfHorde: 5,
  AngmarHillTrollHorde: 5,
  AngmarNecromancerHorde: 5,
  AngmarOrcWarriors: 5,
  AngmarRhudaurSlingers: 5,
  AngmarRhudaurSpearmen: 5,
  AngmarSnowTrollHorde: 5,
  AngmarThrallMaster: 5,
  AngmarTrollSling: 0,
  AngmarWolfRiders: 5,
  DwarvenAxeThrowerHorde: 5,
  DwarvenBattleWagon: 5,
  DwarvenCatapult: 0,
  DwarvenGuardianHorde: 5,
  DwarvenMenOfDaleHorde: 5,
  DwarvenPhalanxHorde: 5,
  DwarvenZerkerHorde: 10,
  ElvenLorienArcherHorde: 5,
  ElvenLorienWarriorHorde: 5,
  ElvenMirkwoodArcherHorde: 5,
  ElvenMithlondSentryHorde: 5,
  ElvenRivendellArcherHorde: 5,
  ElvenRivendellLancerHorde: 5,
  GoblinArcherHorde: 5,
  GoblinCaveTroll: 5,
  GoblinFighterHorde: 5,
  GoblinSpiderRiderHorde: 5,
  GondorArcherHorde: 5,
  GondorFighterHorde: 5,
  GondorKnightHorde: 5,
  GondorKnightsofDolHorde: 10,
  GondorRangerHorde: 5,
  GondorTowerShieldGuardHorde: 5,
  GondorTrebuchet: 0,
  IsengardBallista: 0,
  IsengardBatteringRam: 0,
  IsengardBerserkerHorde: 10,
  IsengardBeserker: 5,
  IsengardExplosiveMine: 0,
  IsengardFighterHorde: 5,
  IsengardPikemanHorde: 5,
  IsengardSiegeLadder: 0,
  IsengardUrukCrossbowHorde: 5,
  IsengardWargPackHorde: 5,
  IsengardWargRiderHorde: 5,
  IsengardWildmanAxeHorde: 5,
  IsengardWildmanHorde: 5,
  MordorArcherHorde: 5,
  MordorAttackTroll: 5,
  MordorBatteringRam: 0,
  MordorBlackOrcHorde: 5,
  MordorBlackRiderHorde: 10,
  MordorCatapult: 0,
  MordorCorsairsOfUmbarHorde: 5,
  MordorDrummerTroll: 5,
  MordorEasterlingHorde: 5,
  MordorFighterHorde: 5,
  MordorHaradrimArcherHorde: 5,
  MordorHaradrimRiderHorde: 5,
  MordorMountainTroll: 5,
  MordorMumakil: 5,
  MordorSiegeTower: 0,
  NoldorWarriorHorde: 10,
  RohanEntFir: 0,
  RohanGenericEnt: 0,
  RohanRohirrimHorde: 5,
  RohanSpearmenHorde: 5,
  WildBabyDrakeHorde: 10,
  WildMarauderHorde: 5,
  WildMarauderSwordHorde: 5,
  WildMountainGiant: 5,
  WildSpiderlingHorde: 5,
}

/** Cap for a BFME object id; unknown objects fall back to the regular-unit cap. */
export function rotwkUnitLevelCap(objectId: string | undefined, fallback = DEFAULT_UNIT_MAX_LEVEL) {
  if (!objectId) return fallback
  const known = ROTWK_UNIT_LEVEL_CAPS[objectId]
  return known === undefined ? fallback : known
}
