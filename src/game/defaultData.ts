import { DEFAULT_FACTIONS } from '../constants'
import { createDefaultRingState } from './ring'
import type { Army, CampaignState, CaptainType, FactionDefinition, Hero, HexGridData, MapLocation, Region, UnitType } from '../types'

/**
 * The engine no longer embeds a second copy of a particular mod roster.
 * Built-in content lives only in public/mods/default; these empty catalogs are
 * defensive fallbacks for incomplete user mods and templates.
 */
export const DEFAULT_UNIT_TYPES: UnitType[] = []
export const DEFAULT_HEROES: Hero[] = []
export const DEFAULT_CAPTAINS: CaptainType[] = []

/** Empty regions list for brand-new mods; authors paint regions in the editor. */
export function createDefaultRegions(_locations: MapLocation[] = []): Region[] {
  return []
}

export function createDefaultArmies(_locations: MapLocation[], _grid: HexGridData): Army[] {
  return []
}

export function createDefaultCampaign(
  factions: FactionDefinition[] = DEFAULT_FACTIONS,
  locations: MapLocation[] = [],
  heroes: Hero[] = DEFAULT_HEROES,
): CampaignState {
  const turnOrder = factions.filter((faction) => faction.playable).map((faction) => faction.id)
  const activeFactionId = turnOrder[0] ?? 'civilian'
  const treasuries = Object.fromEntries(factions.map((faction) => [faction.id, {
    gold: faction.startingTreasury.gold,
    materials: faction.startingTreasury.materials,
    lastIncome: { gold: 0, materials: 0 },
    lastUpkeep: 0,
  }]))
  const locationStates = Object.fromEntries(locations.map((location) => [location.id, {
    locationId: location.id,
    recruitmentQueue: [],
    reserve: [],
    occupationTurnsLeft: 0,
  }]))
  const heroStates = Object.fromEntries(heroes.map((hero) => [hero.id, {
    status: !hero.alive ? 'dead' as const : hero.unlockType === 'starting' ? 'active' as const : 'locked' as const,
    summoned: hero.alive && hero.unlockType === 'starting',
    availableSinceRound: null,
    summonLocationId: hero.requiredLocationId,
    healTurnsLeft: 0,
    recoveryLocationId: null,
    diedRound: null,
    diedLocationId: null,
  }]))
  const factionStates = Object.fromEntries(factions.filter((faction) => faction.playable).map((faction) => [faction.id, {
    status: 'active' as const,
    eliminatedOnRound: null,
    statistics: { battlesWon: 0, battlesLost: 0, locationsCaptured: 0, heroesLost: 0 },
  }]))
  return {
    round: 1,
    activeFactionId,
    turnOrder,
    phase: 'planning_good',
    firstMoverThisRound: 'good',
    playerFactionId: null,
    playerSide: 'good',
    aiEnabled: true,
    aiDifficulty: { strategic: 'warrior', rts: 'warrior' },
    gameStatus: 'active',
    gameResultDismissed: false,
    factionStates,
    freeCaptains: Object.fromEntries(factions.map((faction) => [faction.id, []])),
    fogOfWar: { enabled: true, overlayVisible: true, lastSeenArmies: [], lastSeenLocations: [] },
    treasuries,
    locationStates,
    heroStates,
    pendingOrders: [],
    alliedPlans: [],
    turnMovements: [],
    conflicts: [],
    currentConflictId: null,
    buildings: [],
    heroLevels: Object.fromEntries(heroes.map((hero) => [hero.id, 1])),
    ringState: createDefaultRingState(),
    turnEvents: [],
    log: [],
  }
}
