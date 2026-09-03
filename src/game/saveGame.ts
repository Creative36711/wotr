import type { Army, Hero, SaveGameData, WorldData } from '../types'
import { armyMovementCap } from './army'
import { GAME_VERSION, SAVEGAME_DATA_VERSION } from '../version'
import { normalizeSlotProgression, unitMaxLevel, heroMaxLevel } from './progression'
import { normalizeRingState } from './ring'

const cloneArmies = (armies: Army[]) => armies.map((army) => ({
  ...army,
  commander: army.commander ? { ...army.commander } : null,
  unitSlots: army.unitSlots.map((slot) => ({ ...slot })),
  heroSlots: army.heroSlots.map((slot) => ({ ...slot })),
}))
const cloneCampaign = (campaign: WorldData['campaign']) => ({
  ...campaign,
  aiDifficulty: { ...campaign.aiDifficulty },
  turnOrder: [...campaign.turnOrder],
  treasuries: Object.fromEntries(Object.entries(campaign.treasuries).map(([id, treasury]) => [id, { ...treasury, lastIncome: { ...treasury.lastIncome } }])),
  locationStates: Object.fromEntries(Object.entries(campaign.locationStates).map(([id, state]) => [id, { locationId: state.locationId, recruitmentQueue: state.recruitmentQueue.map((item) => ({ ...item })), reserve: state.reserve.map((slot) => ({ ...slot })), occupationTurnsLeft: state.occupationTurnsLeft }])),
  heroStates: Object.fromEntries(Object.entries(campaign.heroStates).map(([id, hero]) => [id, { ...hero }])),
  pendingOrders:campaign.pendingOrders.map((order)=>({...order,path:[...order.path]})),
  alliedPlans:campaign.alliedPlans.map((plan)=>({...plan,path:[...plan.path]})),
  turnMovements:campaign.turnMovements.map((entry)=>({...entry})),
  factionStates: Object.fromEntries(Object.entries(campaign.factionStates).map(([id, faction]) => [id, { ...faction, statistics: { ...faction.statistics } }])),
  freeCaptains: Object.fromEntries(Object.entries(campaign.freeCaptains).map(([id, captains]) => [id, captains.map((captain) => ({ ...captain }))])),
  fogOfWar: { ...campaign.fogOfWar, lastSeenArmies: campaign.fogOfWar.lastSeenArmies.map((intel) => ({ ...intel })), lastSeenLocations: campaign.fogOfWar.lastSeenLocations.map((intel) => ({ ...intel })) },
  conflicts: campaign.conflicts.map((conflict) => ({ ...conflict, attackerArmyIds: [...conflict.attackerArmyIds], defenderArmyIds: [...conflict.defenderArmyIds], attackerReinforcementArmyIds: [...conflict.attackerReinforcementArmyIds], defenderReinforcementArmyIds: [...conflict.defenderReinforcementArmyIds], attackerDistantReinforcementArmyIds: [...conflict.attackerDistantReinforcementArmyIds], defenderDistantReinforcementArmyIds: [...conflict.defenderDistantReinforcementArmyIds], optionalPlayerReinforcements: conflict.optionalPlayerReinforcements.map((option) => ({ ...option })) })),
  log: campaign.log.map((entry) => ({ ...entry })),
  buildings: (campaign.buildings ?? []).map((building) => ({ ...building })),
  heroLevels: { ...(campaign.heroLevels ?? {}) },
  ringState: normalizeRingState(campaign.ringState),
  turnEvents: (campaign.turnEvents ?? []).map((event) => ({ ...event })),
})
const cloneBattles = (battles: WorldData['battles']) => battles.map((battle) => ({ ...battle, attackerArmyIds: [...(battle.attackerArmyIds ?? [battle.attackerArmyId])], defenderArmyIds: [...(battle.defenderArmyIds ?? [battle.defenderArmyId])], attackerReinforcementArmyIds: [...(battle.attackerReinforcementArmyIds ?? [])], defenderReinforcementArmyIds: [...(battle.defenderReinforcementArmyIds ?? [])], attackerLosses: battle.attackerLosses.map((loss) => ({ ...loss })), defenderLosses: battle.defenderLosses.map((loss) => ({ ...loss })), garrisonLosses: (battle.garrisonLosses ?? []).map((loss) => ({ ...loss })) }))

export function createNewSaveGame(world: WorldData, modId = 'default'): SaveGameData {
  const now = new Date().toISOString()
  return {
    version: SAVEGAME_DATA_VERSION,
    gameVersion: GAME_VERSION,
    modId,
    name: 'Main Campaign',
    createdAt: now,
    updatedAt: now,
    locationOwners: Object.fromEntries(world.locations.map((location) => [location.id, location.side])),
    regionOwners: Object.fromEntries(world.regions.map((region) => [region.id, region.ownerFactionId])),
    heroAlive: Object.fromEntries(world.heroes.map((hero) => [hero.id, hero.alive])),
    armies: cloneArmies(world.armies).map((army) => ({ ...army, movementRemaining: armyMovementCap(army, world.heroes, world.captains, world.unitTypes) })),
    campaign: cloneCampaign(world.campaign),
    battles: [],
  }
}

export function applySaveGame(world: WorldData, save: SaveGameData): WorldData {
  const syncedArmies = cloneArmies(save.armies).map((army) => ({
    ...army,
    commander: army.commander ? (() => {
      const entity = army.commander!.kind === 'hero'
        ? world.heroes.find((item) => item.id === army.commander!.entityId)
        : world.captains.find((item) => item.id === army.commander!.entityId)
      if (!entity) return null
      return army.commander!.kind === 'hero'
        ? { ...army.commander!, objectId: (entity as Hero).objectId }
        : { kind: 'captain' as const, entityId: entity.id, displayName: army.commander!.displayName }
    })() : null,
    heroSlots: army.heroSlots.flatMap((slot) => {
      const entity = world.heroes.find((item) => item.id === slot.entityId)
      return entity ? [{ ...slot, objectId: entity.objectId, ...normalizeSlotProgression(slot, heroMaxLevel(entity, world.defaultHeroMaxLevel)) }] : []
    }),
    unitSlots: army.unitSlots.flatMap((slot) => {
      const entity = world.unitTypes.find((item) => item.id === slot.entityId)
      return entity ? [{ ...slot, objectId: entity.objectId, ...normalizeSlotProgression(slot, unitMaxLevel(entity, world.defaultUnitMaxLevel)) }] : []
    }),
  }))
  return {
    ...world,
    locations: world.locations.map((location) => ({ ...location, side: save.locationOwners[location.id] ?? location.side })),
    regions: world.regions.map((region) => ({ ...region, ownerFactionId: save.regionOwners[region.id] !== undefined ? save.regionOwners[region.id] : region.ownerFactionId })),
    heroes: world.heroes.map((hero) => ({ ...hero, alive: save.heroAlive[hero.id] ?? hero.alive })),
    armies: syncedArmies,
    campaign: cloneCampaign(save.campaign),
    battles: cloneBattles(save.battles),
  }
}

export function extractSaveGame(world: WorldData, previous?: SaveGameData | null, modId = previous?.modId ?? 'default'): SaveGameData {
  const now = new Date().toISOString()
  return {
    version: SAVEGAME_DATA_VERSION,
    gameVersion: GAME_VERSION,
    modId,
    name: previous?.name ?? 'Main Campaign',
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    locationOwners: Object.fromEntries(world.locations.map((location) => [location.id, location.side])),
    regionOwners: Object.fromEntries(world.regions.map((region) => [region.id, region.ownerFactionId])),
    heroAlive: Object.fromEntries(world.heroes.map((hero) => [hero.id, hero.alive])),
    armies: cloneArmies(world.armies),
    campaign: cloneCampaign(world.campaign),
    battles: cloneBattles(world.battles),
  }
}
