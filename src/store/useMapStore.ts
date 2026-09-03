import { create } from 'zustand'
import { areFactionsHostile, DEFAULT_GRID_CONFIG, TERRAIN_BY_ID } from '../constants'
import { armyCommanderName, movementTargetLabel, planAlliedMovement, runAiMovement, runAiPlanning } from '../game/ai'
import { armyCommandPointLimit, armyCommandPoints, reserveCommandPoints, armyMovementCap, armyUnitSlotCap, captainInstanceFromCommander, captainNamesForFaction, createCaptainCommander, createHeroCommander, factionArmyLimit, factionCaptainCount, factionCaptainLimit, generateArmyName, generateUniqueCaptainName } from '../game/army'
import { canFactionPlan, canPlayerMoveArmy, factionIsActive, factionSide, firstFactionForSide, oppositeSide } from '../game/campaign'
import { calculateConflictBattle, scanHotSpots, updateConflictRtsCompatibility } from '../game/conflicts'
import { createDefaultCampaign } from '../game/defaultData'
import { heroIsDeployed, heroSummonLocation, heroUnlockSatisfied } from '../game/heroes'
import { refreshFogIntel } from '../game/fogOfWar'
import { OCCUPATION_COUNTER_ON_CAPTURE, recruitableUnitsAtLocation } from '../game/recruitment'
import { createDefaultEconomicTypes, economicDefaultsPatch, getEconomicType, setActiveEconomicTypes } from '../game/economicTypes'
import { applySaveGame, createNewSaveGame, extractSaveGame } from '../game/saveGame'
import { hexDistance, locationHexId, neighborIds, parseHexId, pathMovementCost, resolveGrid } from '../hex/hexGrid'
import {
  emptyRegion,
  makeRegionId,
  regenerateDomainHexes,
  refreshRegionOwners,
  regionIdForHex,
  syncMapObjectRegionIds,
} from '../game/regions'
import { WORLD_DATA_VERSION } from '../version'
import type {
  Army,
  AutoBattleReport,
  CampaignConflict,
  CampaignState,
  CaptainType,
  FactionDefinition,
  Hero,
  HexCellOverride,
  HexGridData,
  SettlementType,
  StructuralType,
  EconomicTypeDefinition,
  MapLocation,
  MapViewMode,
  Region,
  SaveGameData,
  StrategicSide,
  TerrainType,
  UnitType,
  WorldData,
  AppMode,
} from '../types'

const HISTORY_LIMIT = 50

interface WorldSnapshot {
  locations: MapLocation[]
  grid: HexGridData
  factions: FactionDefinition[]
  economicTypes: EconomicTypeDefinition[]
  unitTypes: UnitType[]
  heroes: Hero[]
  captains: CaptainType[]
  armies: Army[]
  regions: Region[]
  campaign: CampaignState
  battles: AutoBattleReport[]
}

interface MapState extends WorldSnapshot {
  editorTemplate: WorldSnapshot | null
  gameSave: SaveGameData | null
  selectedId: string | null
  selectedHexId: string | null
  selectedHexIds: string[]
  selectedArmyId: string | null
  latestBattleId: string | null
  mode: AppMode
  viewMode: MapViewMode
  hexEdit: boolean
  addKind: StructuralType | null
  history: WorldSnapshot[]
  future: WorldSnapshot[]
  revision: number
  initialize: (world: WorldData, saveGame: SaveGameData) => void
  newGame: (playerFactionId: string, fogEnabled?: boolean, modId?: string, activeFactionIds?: string[], strategicDifficulty?: CampaignState['aiDifficulty']['strategic'], rtsDifficulty?: CampaignState['aiDifficulty']['rts']) => void
  setFogOverlayVisible: (visible: boolean) => void
  dismissGameResult: () => void
  select: (id: string | null) => void
  selectArmy: (id: string | null) => void
  selectHex: (id: string | null, behavior?: 'replace' | 'add' | 'toggle') => void
  selectHexes: (ids: string[], behavior?: 'replace' | 'add') => void
  clearSelection: () => void
  dismissBattle: () => void
  setMode: (mode: AppMode) => void
  setViewMode: (mode: MapViewMode) => void
  setHexEdit: (enabled: boolean) => void
  setAddKind: (kind: StructuralType | null) => void
  updateLocation: (id: string, patch: Partial<MapLocation>) => void
  moveLocation: (id: string, hexId: string) => void
  addLocation: (structuralType: StructuralType, hexId: string) => void
  duplicateLocation: (id: string) => void
  removeLocation: (id: string) => void
  updateHex: (id: string, patch: Partial<HexCellOverride>) => void
  updateHexes: (ids: string[], patch: Partial<HexCellOverride>) => void
  setHexTerrain: (id: string, terrain: TerrainType) => void
  setHexesTerrain: (ids: string[], terrain: TerrainType) => void
  resetHex: (id: string) => void
  resetHexes: (ids: string[]) => void
  setMovementBudget: (budget: number) => void
  addFaction: () => void
  updateFaction: (id: string, patch: Partial<FactionDefinition>) => void
  removeFaction: (id: string) => void
  addUnitType: () => void
  updateUnitType: (id: string, patch: Partial<UnitType>) => void
  removeUnitType: (id: string) => void
  addHero: () => void
  updateHero: (id: string, patch: Partial<Hero>) => void
  removeHero: (id: string) => void
  updateCaptain: (id: string, patch: Partial<CaptainType>) => void
  addArmy: (factionId: string, locationId: string, commanderChoice: string, initialUnitId: string) => void
  updateArmy: (id: string, patch: Partial<Army>) => void
  removeArmy: (id: string) => void
  updateRegion: (id: string, patch: Partial<Region>) => void
  updateEconomicType: (id: SettlementType, patch: Partial<EconomicTypeDefinition>) => void
  applyEconomicTypeDefaults: (locationId: string) => void
  addRegion: () => void
  removeRegion: (id: string) => void
  setRegionHexes: (id: string, hexes: string[], mode?: 'replace' | 'add' | 'remove') => void
  paintRegionHexes: (id: string, hexes: string[]) => void
  advancePhase: () => void
  moveArmy: (armyId: string, destinationId: string, path: string[], cost: number, terrain: TerrainType, locationId: string | null) => void
  cancelArmyOrder:(armyId:string)=>void
  retreatEngagedArmy: (armyId: string) => void
  selectConflict: (conflictId: string) => void
  setReinforcementParticipation: (conflictId: string, armyId: string, participate: boolean) => void
  resolveConflict: (conflictId: string) => void
  retreatConflictDefender: (conflictId: string) => void
  resolveConflictRts: (conflictId: string, winnerSide: 'good' | 'evil', detail?: string) => void
  summonHero: (locationId: string, heroId: string) => void
  queueRecruitment: (locationId: string, unitId: string) => void
  transformReserveUnit: (locationId: string, slotId: string, targetUnitId: string) => void
  transferReserveToArmy: (locationId: string, armyId: string, slotId: string) => void
  transferArmyToReserve: (locationId: string, armyId: string, slotId: string) => void
  formArmy: (locationId: string, commanderChoice: string) => void
  disbandArmy: (locationId: string, armyId: string) => void
  cancelRecruitment: (locationId: string, queueId: string) => void
  undo: () => void
  redo: () => void
}

const cloneLocations = (items: MapLocation[]) => items.map((item) => ({ ...item }))
const cloneGrid = (grid: HexGridData): HexGridData => ({ config: { ...grid.config }, cells: Object.fromEntries(Object.entries(grid.cells).map(([id, cell]) => [id, { ...cell }])) })
const cloneArmies = (items: Army[]) => items.map((army) => ({
  ...army,
  commander: army.commander ? { ...army.commander } : null,
  unitSlots: army.unitSlots.map((slot) => ({ ...slot })),
  heroSlots: army.heroSlots.map((slot) => ({ ...slot })),
}))
const cloneCampaign = (campaign: CampaignState): CampaignState => ({
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
})
const cloneBattles = (items: AutoBattleReport[]) => items.map((item) => ({ ...item, attackerArmyIds: [...(item.attackerArmyIds ?? [item.attackerArmyId])], defenderArmyIds: [...(item.defenderArmyIds ?? [item.defenderArmyId])], attackerReinforcementArmyIds: [...(item.attackerReinforcementArmyIds ?? [])], defenderReinforcementArmyIds: [...(item.defenderReinforcementArmyIds ?? [])], attackerLosses: item.attackerLosses.map((loss) => ({ ...loss })), defenderLosses: item.defenderLosses.map((loss) => ({ ...loss })), garrisonLosses: (item.garrisonLosses ?? []).map((loss) => ({ ...loss })) }))
const cloneSnapshot = (snapshot: WorldSnapshot): WorldSnapshot => ({
  locations: cloneLocations(snapshot.locations),
  grid: cloneGrid(snapshot.grid),
  factions: snapshot.factions.map((item) => ({ ...item })),
  economicTypes: (snapshot.economicTypes?.length ? snapshot.economicTypes : createDefaultEconomicTypes()).map((item) => ({ ...item, nameTranslations: { ...(item.nameTranslations ?? {}) } })),
  unitTypes: snapshot.unitTypes.map((item) => ({ ...item })),
  heroes: snapshot.heroes.map((item) => ({ ...item })),
  captains: snapshot.captains.map((item) => ({ ...item })),
  armies: cloneArmies(snapshot.armies),
  regions: snapshot.regions.map((item) => ({ ...item, hexes: [...(item.hexes ?? [])] })),
  campaign: cloneCampaign(snapshot.campaign),
  battles: cloneBattles(snapshot.battles),
})
const currentSnapshot = (state: MapState): WorldSnapshot => ({
  locations: state.locations, grid: state.grid, factions: state.factions, economicTypes: state.economicTypes, unitTypes: state.unitTypes,
  heroes: state.heroes, captains: state.captains, armies: state.armies, regions: state.regions, campaign: state.campaign, battles: state.battles,
})
const snapshotToWorld = (snapshot: WorldSnapshot): WorldData => ({ version: WORLD_DATA_VERSION, ...cloneSnapshot(snapshot) })
const cloneSaveGame = (save: SaveGameData): SaveGameData => ({
  ...save,
  locationOwners: { ...save.locationOwners },
  regionOwners: { ...save.regionOwners },
  heroAlive: { ...save.heroAlive },
  armies: cloneArmies(save.armies),
  campaign: cloneCampaign(save.campaign),
  battles: cloneBattles(save.battles),
})
/** Keep map-object regionIds and domain hex sets consistent with authored regions. */
function rebuildTerritory(locations: MapLocation[], regions: Region[]) {
  const withRegionIds = syncMapObjectRegionIds(locations, regions)
  const withDomainHexes = regenerateDomainHexes(withRegionIds, regions)
  const nextRegions = refreshRegionOwners(regions, withDomainHexes)
  return { locations: withDomainHexes, regions: nextRegions }
}

const makeId = (base: string, used: string[]) => {
  const root = base.toLowerCase().trim().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-|-$/g, '') || 'item'
  let id = root
  let suffix = 2
  while (used.includes(id)) id = `${root}-${suffix++}`
  return id
}
const logEntry = (state: MapState, text: string, kind: CampaignState['log'][number]['kind'], factionId: string | null = state.campaign.activeFactionId) => ({
  id: `log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
  round: state.campaign.round,
  factionId,
  phase: state.campaign.phase,
  text,
  kind,
})

function pushHistory(state: MapState, next: WorldSnapshot) {
  return { ...next, history: [...state.history, cloneSnapshot(currentSnapshot(state))].slice(-HISTORY_LIMIT), future: [], revision: state.revision + 1 }
}

function gameCommit(state: MapState, patch: Partial<WorldSnapshot>) {
  return { ...patch, revision: state.revision + 1 }
}

function uniqueCaptainNameForState(state: MapState, factionId: string, captain: CaptainType) {
  const assigned = state.armies.filter((army) => army.factionId === factionId && army.commander?.kind === 'captain').map((army) => army.commander!.displayName ?? '')
  const free = (state.campaign.freeCaptains[factionId] ?? []).map((instance) => instance.displayName)
  return generateUniqueCaptainName(factionId, captain.namePool, [...assigned, ...free])
}

const campaignEvent = (campaign: CampaignState, text: string, kind: CampaignState['log'][number]['kind'], factionId: string | null = campaign.activeFactionId) => ({
  id: `log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
  round: campaign.round,
  factionId,
  phase: campaign.phase,
  text,
  kind,
})

function preparePlanningSide(state: MapState, campaign: CampaignState, sourceArmies: Army[], sourceHeroes: Hero[], side: StrategicSide) {
  let armies = cloneArmies(sourceArmies)
  let heroes = sourceHeroes.map((hero) => ({ ...hero }))
  campaign.activeFactionId = campaign.playerFactionId && factionSide(state.factions, campaign.playerFactionId) === side ? campaign.playerFactionId : firstFactionForSide(state.factions, side, campaign)
  armies = armies.map((army) => factionSide(state.factions, army.factionId) === side && factionIsActive(campaign, army.factionId) ? {
    ...army,
    movementRemaining: army.exhaustedUntilRound !== null && army.exhaustedUntilRound >= campaign.round ? 0 : armyMovementCap(army, heroes, state.captains, state.unitTypes),
    status: army.exhaustedUntilRound !== null && army.exhaustedUntilRound >= campaign.round ? 'retreating' as const : army.status === 'garrison' ? 'garrison' as const : 'ready' as const,
    engaged: false,
    movedRound: null,
    movedInPhase: null,
  } : army)

  for (const hero of heroes.filter((candidate) => factionSide(state.factions, candidate.factionId) === side && factionIsActive(campaign, candidate.factionId))) {
    const heroState = campaign.heroStates[hero.id] ?? {
      status: !hero.alive ? 'dead' as const : hero.unlockType === 'starting' ? 'active' as const : 'locked' as const,
      summoned: hero.alive && hero.unlockType === 'starting',
      availableSinceRound: null,
      summonLocationId: hero.requiredLocationId,
      healTurnsLeft: 0,
      recoveryLocationId: null,
      diedRound: null,
      diedLocationId: null,
    }
    campaign.heroStates[hero.id] = heroState
    if (heroState.status === 'dead') continue
    if (!heroState.summoned && (heroState.status === 'locked' || heroState.status === 'available')) {
      const unlocked = heroUnlockSatisfied(hero, campaign, state.locations)
      const summonLocation = unlocked ? heroSummonLocation(hero, state.locations) : null
      if (unlocked && summonLocation) {
        if (heroState.status !== 'available') {
          heroState.status = 'available'
          heroState.availableSinceRound = campaign.round
          campaign.log.unshift(campaignEvent(campaign, `${hero.name} теперь доступен к призыву в «${summonLocation.name}».`, 'hero', hero.factionId))
        }
        heroState.summonLocationId = summonLocation.id
      } else {
        heroState.status = 'locked'
        heroState.summonLocationId = hero.requiredLocationId
      }
      continue
    }
    if (heroState.status !== 'wounded') continue
    heroState.healTurnsLeft = Math.max(0, heroState.healTurnsLeft - 1)
    if (heroState.healTurnsLeft > 0) continue
    const ownRecovery = heroState.recoveryLocationId && state.locations.find((location) => location.id === heroState.recoveryLocationId && location.side === hero.factionId)
      ? heroState.recoveryLocationId
      : state.locations.find((location) => location.side === hero.factionId)?.id ?? null
    const alliedRecovery = state.locations.find((location) => factionSide(state.factions, location.side) === factionSide(state.factions, hero.factionId))?.id ?? null
    const recovery = ownRecovery ?? alliedRecovery
    if (!recovery) { heroState.healTurnsLeft = 1; continue }
    heroState.status = 'active'
    heroState.summoned = true
    heroState.recoveryLocationId = recovery
    if (recovery) {
      const locationState = campaign.locationStates[recovery] ?? { locationId: recovery, recruitmentQueue: [], reserve: [], occupationTurnsLeft: 0 }
      const alreadyPresent = locationState.reserve.some((slot) => slot.kind === 'hero' && slot.entityId === hero.id)
        || armies.some((army) => army.commander?.entityId === hero.id || army.heroSlots.some((slot) => slot.entityId === hero.id))
      if (!alreadyPresent) locationState.reserve.push({ slotId: `recovered-${hero.id}-${campaign.round}`, kind: 'hero', entityId: hero.id, objectId: hero.objectId })
      campaign.locationStates[recovery] = locationState
    }
    campaign.log.unshift(campaignEvent(campaign, `${hero.name} оправился от ран и снова доступен.`, 'hero', hero.factionId))
  }

  const sideFactions = state.factions.filter((faction) => faction.playable && faction.alignment === side && factionIsActive(campaign, faction.id))
  for (const faction of sideFactions) {
    const ownedLocations = state.locations.filter((location) => location.side === faction.id)
    const income = ownedLocations.reduce((total, location) => ({ gold: total.gold + location.income.gold, materials: total.materials + location.income.materials }), { gold: 0, materials: 0 })
    const armyUpkeep = armies.filter((army) => army.factionId === faction.id).reduce((total, army) => total
      + army.unitSlots.reduce((sum, slot) => sum + (state.unitTypes.find((unit) => unit.id === slot.entityId)?.upkeep ?? 0), 0)
      + (army.commander?.kind === 'captain' ? 15 : 0), 0)
    const reserveUpkeep = ownedLocations.reduce((total, location) => total + (campaign.locationStates[location.id]?.reserve ?? []).reduce((sum, slot) => sum + (slot.kind === 'unit' ? state.unitTypes.find((unit) => unit.id === slot.entityId)?.upkeep ?? 0 : 0), 0), 0)
    const freeCaptainUpkeep = (campaign.freeCaptains[faction.id]?.length ?? 0) * 15
    const totalUpkeep = armyUpkeep + reserveUpkeep + freeCaptainUpkeep
    const treasury = campaign.treasuries[faction.id] ?? { gold: 0, materials: 0, lastIncome: { gold: 0, materials: 0 }, lastUpkeep: 0 }
    treasury.gold += income.gold - totalUpkeep
    treasury.materials += income.materials
    treasury.lastIncome = income
    treasury.lastUpkeep = totalUpkeep
    campaign.treasuries[faction.id] = treasury

    for (const location of ownedLocations) {
      const locationState = campaign.locationStates[location.id] ?? { locationId: location.id, recruitmentQueue: [], reserve: [], occupationTurnsLeft: 0 }
      if (locationState.occupationTurnsLeft > 0) locationState.occupationTurnsLeft = Math.max(0, locationState.occupationTurnsLeft - 1)
      const remaining = [] as typeof locationState.recruitmentQueue
      for (const item of locationState.recruitmentQueue) {
        const turnsLeft = Math.max(0, item.turnsLeft - 1)
        const unit = state.unitTypes.find((candidate) => candidate.id === item.entityId)
        if (turnsLeft === 0 && unit && reserveCommandPoints(locationState.reserve, state.unitTypes, state.heroes) + (unit.commandPoints ?? 0) <= location.commandPointLimit) {
          locationState.reserve.push({ slotId: `reserve-${location.id}-${Date.now().toString(36)}-${locationState.reserve.length}`, kind: 'unit', entityId: unit.id, objectId: unit.objectId })
        } else remaining.push({ ...item, turnsLeft })
      }
      locationState.recruitmentQueue = remaining
      campaign.locationStates[location.id] = locationState
    }

    let desertion = ''
    if (treasury.gold < -200) {
      const largest = armies.filter((army) => army.factionId === faction.id && army.unitSlots.length).sort((left, right) => right.unitSlots.length - left.unitSlots.length)[0]
      if (largest) {
        const weakest = largest.unitSlots.slice().sort((left, right) => (state.unitTypes.find((unit) => unit.id === left.entityId)?.battlePower ?? 0) - (state.unitTypes.find((unit) => unit.id === right.entityId)?.battlePower ?? 0))[0]
        largest.unitSlots = largest.unitSlots.filter((slot) => slot.slotId !== weakest?.slotId)
        const unit = state.unitTypes.find((candidate) => candidate.id === weakest?.entityId)
        desertion = ` Из-за долгов дезертировал отряд «${unit?.name ?? weakest?.entityId}».`
      }
    }
    campaign.log.unshift(campaignEvent(campaign, `Фракция «${faction.label}»: доход ${income.gold} золота и ${income.materials} материалов, содержание ${totalUpkeep} золота.${desertion}`, 'turn', faction.id))
  }
  return { armies, heroes }
}

function releaseCaptain(campaign: CampaignState, factionId: string, commander: Army['commander']) {
  const released = captainInstanceFromCommander(commander)
  if (!released) return null
  const pool = campaign.freeCaptains[factionId] ?? []
  if (!pool.some((captain) => captain.instanceId === released.instanceId)) pool.push(released)
  campaign.freeCaptains[factionId] = pool
  return released
}

function takeFreeCaptain(campaign: CampaignState, factionId: string, captains: CaptainType[]) {
  const pool = campaign.freeCaptains[factionId] ?? []
  while (pool.length) {
    const instance = pool.shift()!
    const type = captains.find((captain) => captain.id === instance.captainTypeId && captain.factionId === factionId)
    if (type) {
      campaign.freeCaptains[factionId] = pool
      return createCaptainCommander(type, instance.displayName, instance.instanceId)
    }
  }
  campaign.freeCaptains[factionId] = pool
  return null
}

function initializeNewCampaignHeroes(state: MapState, campaign: CampaignState, sourceArmies: Army[], sourceHeroes: Hero[]) {
  const heroes = sourceHeroes.map((hero) => ({ ...hero }))
  const armies = cloneArmies(sourceArmies)
  campaign.heroStates = Object.fromEntries(heroes.map((hero) => {
    const factionActive = factionIsActive(campaign, hero.factionId)
    return [hero.id, {
      status: !hero.alive ? 'dead' as const : factionActive && hero.unlockType === 'starting' ? 'active' as const : 'locked' as const,
      summoned: factionActive && hero.alive && hero.unlockType === 'starting',
      availableSinceRound: null,
      summonLocationId: hero.requiredLocationId,
      healTurnsLeft: 0,
      recoveryLocationId: null,
      diedRound: null,
      diedLocationId: null,
    }]
  }))
  const activeHeroIds = new Set(heroes.filter((hero) => factionIsActive(campaign, hero.factionId) && hero.alive && hero.unlockType === 'starting').map((hero) => hero.id))
  for (const army of armies) {
    if (army.commander?.kind === 'hero' && !activeHeroIds.has(army.commander.entityId)) army.commander = null
    army.heroSlots = army.heroSlots.filter((slot) => activeHeroIds.has(slot.entityId))
    if (!army.commander && army.heroSlots.length) {
      const promoted = army.heroSlots.shift()!
      army.commander = { kind: 'hero', entityId: promoted.entityId, objectId: promoted.objectId }
    }
  }
  for (const locationState of Object.values(campaign.locationStates)) locationState.reserve = locationState.reserve.filter((slot) => slot.kind !== 'hero' || activeHeroIds.has(slot.entityId))
  for (const hero of heroes.filter((candidate) => activeHeroIds.has(candidate.id))) {
    if (heroIsDeployed(hero.id, armies, campaign.locationStates)) continue
    const destination = heroSummonLocation(hero, state.locations)
    if (!destination) continue
    const locationState = campaign.locationStates[destination.id] ?? { locationId: destination.id, recruitmentQueue: [], reserve: [], occupationTurnsLeft: 0 }
    locationState.reserve.push({ slotId: `starting-hero-${hero.id}`, kind: 'hero', entityId: hero.id, objectId: hero.objectId })
    campaign.locationStates[destination.id] = locationState
  }
  for (const army of armies) army.name = generateArmyName(army, armies, state.factions, state.locations, heroes, state.grid.config)
  return { armies, heroes }
}

function factionCampaignState(campaign: CampaignState, factionId: string) {
  if (!campaign.factionStates[factionId]) campaign.factionStates[factionId] = {
    status: 'active',
    eliminatedOnRound: null,
    statistics: { battlesWon: 0, battlesLost: 0, locationsCaptured: 0, heroesLost: 0 },
  }
  return campaign.factionStates[factionId]
}

function evacuateLocationReserveHeroes(state: MapState, campaign: CampaignState, locations: MapLocation[], regions: Region[], locationId: string, oldFactionId: string) {
  const locationState = campaign.locationStates[locationId]
  const heroSlots = locationState?.reserve.filter((slot) => slot.kind === 'hero') ?? []
  if (!heroSlots.length) return
  locationState.reserve = locationState.reserve.filter((slot) => slot.kind !== 'hero')
  const resolved = resolveGrid(state.grid, locations, regions)
  const originHexId = locationHexId(locations.find((location) => location.id === locationId)!, state.grid.config)
  const origin = resolved.byId.get(originHexId)
  const side = factionSide(state.factions, oldFactionId)
  const own = locations.filter((location) => location.id !== locationId && location.side === oldFactionId)
  const allied = locations.filter((location) => location.id !== locationId && factionSide(state.factions, location.side) === side)
  const pool = own.length ? own : allied
  const destination = pool.map((location) => {
    const target = resolved.byId.get(locationHexId(location, state.grid.config))
    return { location, distance: origin && target ? hexDistance(origin, target) : Number.POSITIVE_INFINITY }
  }).sort((left, right) => left.distance - right.distance)[0]?.location ?? null
  for (const slot of heroSlots) {
    const hero = state.heroes.find((candidate) => candidate.id === slot.entityId)
    if (!hero || campaign.heroStates[hero.id]?.status === 'dead') continue
    if (destination) {
      const targetState = campaign.locationStates[destination.id] ?? { locationId: destination.id, recruitmentQueue: [], reserve: [], occupationTurnsLeft: 0 }
      targetState.reserve.push({ ...slot })
      campaign.locationStates[destination.id] = targetState
      campaign.log.unshift(campaignEvent(campaign, `${hero.name} эвакуирован из захваченной локации в «${destination.name}».`, 'hero', hero.factionId))
    } else {
      const previous = campaign.heroStates[hero.id]
      campaign.heroStates[hero.id] = { ...previous, status: 'wounded', summoned: true, healTurnsLeft: Math.max(2, previous?.healTurnsLeft ?? 0), recoveryLocationId: null }
      campaign.log.unshift(campaignEvent(campaign, `${hero.name} пропал при эвакуации из захваченной локации и временно недоступен.`, 'hero', hero.factionId))
    }
  }
}

function captureLocation(locations: MapLocation[], regions: Region[], campaign: CampaignState, locationId: string, factionId: string) {
  const location = locations.find((candidate) => candidate.id === locationId)
  if (!location) return
  const previousOwner = location.side
  location.side = factionId
  if (previousOwner !== factionId) factionCampaignState(campaign, factionId).statistics.locationsCaptured += 1
  // Region control is derived from all domains/strongholds inside it — refresh after capture.
  const refreshed = refreshRegionOwners(regions, locations)
  for (let index = 0; index < regions.length; index += 1) regions[index] = refreshed[index]
  campaign.locationStates[location.id] = { locationId: location.id, recruitmentQueue: [], reserve: [], occupationTurnsLeft: previousOwner !== factionId ? OCCUPATION_COUNTER_ON_CAPTURE : 0 }
}

function conflictInvolvesPlayer(conflict: CampaignConflict, campaign: CampaignState, armies: Army[], locations: MapLocation[]) {
  if (!campaign.playerFactionId) return false
  const armyIds = [...conflict.attackerArmyIds, ...conflict.defenderArmyIds, ...conflict.attackerReinforcementArmyIds, ...conflict.defenderReinforcementArmyIds, ...conflict.optionalPlayerReinforcements.map((option) => option.armyId)]
  if (armyIds.some((id) => armies.find((army) => army.id === id)?.factionId === campaign.playerFactionId)) return true
  return Boolean(conflict.locationId && locations.find((location) => location.id === conflict.locationId)?.side === campaign.playerFactionId)
}

function resolveConflictBattle(state: MapState, campaign: CampaignState, conflictId: string, sourceArmies: Army[], sourceBattles: AutoBattleReport[], forcedWinner?: StrategicSide | null, resolution: 'auto_battle' | 'rts_battle' = 'auto_battle') {
  const conflict = campaign.conflicts.find((candidate) => candidate.id === conflictId)
  if (!conflict || conflict.status !== 'pending') return { armies: sourceArmies, battles: sourceBattles, report: null as AutoBattleReport | null }
  const armies = cloneArmies(sourceArmies)
  const battles = cloneBattles(sourceBattles)
  const cell = resolveGrid(state.grid, state.locations, state.regions).byId.get(conflict.hexId)
  if (!cell) return { armies, battles, report: null as AutoBattleReport | null }
  const outcome = calculateConflictBattle(conflict, armies, state.locations, campaign.locationStates, state.unitTypes, state.heroes, state.captains, cell.terrain, state.factions, forcedWinner)
  const participantIds = new Set([...conflict.attackerArmyIds, ...conflict.defenderArmyIds, ...conflict.attackerReinforcementArmyIds, ...conflict.defenderReinforcementArmyIds])
  for (const army of armies) {
    army.unitSlots = army.unitSlots.filter((slot) => !outcome.destroyedArmyKeys.has(slot.slotId))
    if (army.commander?.kind === 'captain' && outcome.destroyedArmyKeys.has(`${army.id}-commander`)) army.commander = null
    if (participantIds.has(army.id)) army.movementRemaining = 0
  }
  if (conflict.garrisonLocationId) {
    const locationState = campaign.locationStates[conflict.garrisonLocationId]
    if (locationState) locationState.reserve = locationState.reserve.filter((slot) => slot.kind === 'hero' || !outcome.destroyedGarrisonKeys.has(slot.slotId))
  }
  conflict.status = 'resolved'
  conflict.resolution = resolution
  conflict.winnerSide = outcome.winnerSide
  conflict.attackerPower = outcome.attackerPower
  conflict.defenderPower = outcome.defenderPower
  conflict.attackerLosses = outcome.attackerResults.filter((result) => result.destroyed).length
  conflict.defenderLosses = [...outcome.defenderResults, ...outcome.garrisonResults].filter((result) => result.destroyed).length
  const attackerFactions = new Set([...conflict.attackerArmyIds, ...conflict.attackerReinforcementArmyIds].map((id) => armies.find((army) => army.id === id)?.factionId).filter(Boolean) as string[])
  const defenderFactions = new Set([...conflict.defenderArmyIds, ...conflict.defenderReinforcementArmyIds].map((id) => armies.find((army) => army.id === id)?.factionId).filter(Boolean) as string[])
  if (conflict.garrisonLocationId) {
    const owner = state.locations.find((location) => location.id === conflict.garrisonLocationId)?.side
    if (owner) defenderFactions.add(owner)
  }
  for (const factionId of outcome.winnerSide === conflict.attackerSide ? attackerFactions : defenderFactions) factionCampaignState(campaign, factionId).statistics.battlesWon += 1
  for (const factionId of outcome.winnerSide === conflict.attackerSide ? defenderFactions : attackerFactions) factionCampaignState(campaign, factionId).statistics.battlesLost += 1
  campaign.log.unshift(campaignEvent(campaign, outcome.report.summary, 'battle', outcome.report.winnerSide === conflict.attackerSide ? outcome.report.attackerFactionId : outcome.report.defenderFactionId))
  battles.unshift(outcome.report)
  return { armies, battles, report: outcome.report }
}

function enterConflictPhase(state: MapState, campaign: CampaignState, sourceArmies: Army[], sourceLocations: MapLocation[], sourceRegions: Region[], sourceHeroes: Hero[], sourceBattles: AutoBattleReport[]) {
  let armies = cloneArmies(sourceArmies)
  let battles = cloneBattles(sourceBattles)
  const locations = cloneLocations(sourceLocations)
  const regions = sourceRegions.map((region) => ({ ...region, hexes: [...(region.hexes ?? [])] }))
  const heroes = sourceHeroes.map((hero) => ({ ...hero }))
  campaign.phase = 'conflicts'
  campaign.activeFactionId = campaign.playerFactionId ?? firstFactionForSide(state.factions, campaign.playerSide, campaign)

  // Resolve head-on swaps before the hotspot scan. Movement is executed in side order,
  // so a first mover can otherwise vacate the destination before the opposing army
  // arrives and the two armies silently pass through one another.
  const movements = campaign.turnMovements.filter((movement) => movement.round === campaign.round && movement.armyId && movement.originHexId && movement.destinationHexId && movement.originHexId !== movement.destinationHexId)
  const handledCrossMovements = new Set<string>()
  for (const left of movements) {
    if (handledCrossMovements.has(left.armyId!)) continue
    const right = movements.find((candidate) => candidate.armyId !== left.armyId && !handledCrossMovements.has(candidate.armyId!) && candidate.originHexId === left.destinationHexId && candidate.destinationHexId === left.originHexId && factionSide(state.factions, candidate.factionId) !== factionSide(state.factions, left.factionId))
    if (!right) continue
    const leftArmy = armies.find((army) => army.id === left.armyId)
    const rightArmy = armies.find((army) => army.id === right.armyId)
    if (!leftArmy || !rightArmy) continue
    leftArmy.hexId = left.destinationHexId!
    rightArmy.hexId = left.destinationHexId!
    leftArmy.engaged = true
    rightArmy.engaged = true
    leftArmy.movementRemaining = 0
    rightArmy.movementRemaining = 0
    handledCrossMovements.add(left.armyId!)
    handledCrossMovements.add(right.armyId!)
    campaign.log.unshift(campaignEvent(campaign, `${leftArmy.name} и ${rightArmy.name} сталкиваются на встречном курсе.`, 'battle', null))
  }
  const scan = scanHotSpots(campaign, armies, locations, state.factions, campaign.locationStates, state.grid, regions)
  for (const capture of scan.autoCaptures) {
    const location = locations.find((candidate) => candidate.id === capture.locationId)
    if (location && location.side !== 'civilian') evacuateLocationReserveHeroes({ ...state, locations, regions } as MapState, campaign, locations, regions, capture.locationId, location.side)
    captureLocation(locations, regions, campaign, capture.locationId, capture.factionId)
    const army = armies.find((candidate) => candidate.id === capture.armyId)
    if (army) army.engaged = false
    campaign.log.unshift(campaignEvent(campaign, `${location?.name ?? 'Локация'} занята без сопротивления.`, 'capture', capture.factionId))
  }
  campaign.conflicts = scan.conflicts
  campaign.log.unshift(campaignEvent(campaign, scan.conflicts.length ? `Обнаружено горячих точек: ${scan.conflicts.length}.` : 'Горячих точек не обнаружено.', 'system', null))
  for (const conflict of campaign.conflicts.filter((candidate) => !conflictInvolvesPlayer(candidate, campaign, armies, locations))) {
    const resolved = resolveConflictBattle({ ...state, armies, locations, regions, heroes } as MapState, campaign, conflict.id, armies, battles)
    armies = resolved.armies
    battles = resolved.battles
  }
  const pending = campaign.conflicts.find((conflict) => conflict.status === 'pending')
  campaign.currentConflictId = pending?.id ?? null
  if (!pending) {
    const aftermath = processAftermath({ ...state, armies, locations, regions, heroes, battles } as MapState, campaign, armies, locations, regions, heroes, battles)
    return { ...aftermath }
  }
  return { armies, locations, regions, heroes, battles }
}

function deterministicRoll(seed: string) {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) { hash ^= seed.charCodeAt(index); hash = Math.imul(hash, 16777619) }
  return Math.abs(hash >>> 0) % 100 + 1
}

function chooseRetreatLocation(state: MapState, army: Army, originHexId: string, excludedLocationId: string | null = null) {
  const grid = resolveGrid(state.grid, state.locations, state.regions)
  const origin = grid.byId.get(originHexId)
  if (!origin) return null
  const candidates = state.locations.filter((location) => location.side === army.factionId && location.id !== excludedLocationId).map((location) => {
    const targetHexId = locationHexId(location, state.grid.config)
    const target = grid.byId.get(targetHexId)
    return { locationId: location.id, hexId: targetHexId, distance: target ? hexDistance(origin, target) : Number.POSITIVE_INFINITY, economicType: location.economicType }
  }).filter((candidate) => Number.isFinite(candidate.distance))
  return candidates.sort((left, right) => left.distance - right.distance || (left.economicType === 'capital' ? -1 : right.economicType === 'capital' ? 1 : 0) || left.locationId.localeCompare(right.locationId))[0] ?? null
}

function retreatAdditionalLosses(distance: number) {
  if (distance <= 2) return 0
  if (distance <= 5) return 1
  if (distance <= 8) return 2
  return 3
}

function removeWeakestRetreatUnits(army: Army, count: number, unitTypes: UnitType[]) {
  const weakest = army.unitSlots.slice().sort((left, right) => (unitTypes.find((unit) => unit.id === left.entityId)?.battlePower ?? 0) - (unitTypes.find((unit) => unit.id === right.entityId)?.battlePower ?? 0) || left.slotId.localeCompare(right.slotId)).slice(0, count)
  const removedIds = new Set(weakest.map((slot) => slot.slotId))
  army.unitSlots = army.unitSlots.filter((slot) => !removedIds.has(slot.slotId))
  return weakest.map((slot) => unitTypes.find((unit) => unit.id === slot.entityId)?.name ?? slot.entityId)
}

function applyHeroFate(state: MapState, campaign: CampaignState, armies: Army[], heroes: Hero[], heroId: string, conflict: CampaignConflict, destroyed: boolean, originHexId: string): 'survived' | 'wounded' | 'dead' {
  const hero = heroes.find((candidate) => candidate.id === heroId)
  if (!hero) return 'dead'
  const previousHeroState = campaign.heroStates[heroId] ?? { status: 'active' as const, summoned: true, availableSinceRound: null, summonLocationId: null, healTurnsLeft: 0, recoveryLocationId: null, diedRound: null, diedLocationId: null }
  const wasDead = previousHeroState.status === 'dead' || !hero.alive
  const roll = deterministicRoll(`${campaign.round}:${conflict.id}:${heroId}:${destroyed ? 'destroyed' : 'retreat'}`)
  const dead = destroyed ? roll > 80 : roll > 95
  const wounded = destroyed || roll > 80
  if (!dead && !wounded) {
    campaign.heroStates[heroId] = { ...previousHeroState, status: 'active', summoned: true, healTurnsLeft: 0, recoveryLocationId: null, diedRound: null, diedLocationId: null }
    return 'survived'
  }
  for (const army of armies) {
    if (army.commander?.kind === 'hero' && army.commander.entityId === heroId) army.commander = null
    army.heroSlots = army.heroSlots.filter((slot) => slot.entityId !== heroId)
  }
  if (dead) {
    hero.alive = false
    campaign.heroStates[heroId] = { ...previousHeroState, status: 'dead', summoned: true, healTurnsLeft: 0, recoveryLocationId: null, diedRound: campaign.round, diedLocationId: conflict.locationId }
    if (!wasDead) factionCampaignState(campaign, hero.factionId).statistics.heroesLost += 1
    campaign.log.unshift(campaignEvent(campaign, `${hero.name} погиб в сражении${conflict.locationId ? ` у «${state.locations.find((location) => location.id === conflict.locationId)?.name ?? 'локации'}»` : ''}.`, 'hero', hero.factionId))
    return 'dead'
  }
  const grid = resolveGrid(state.grid, state.locations, state.regions)
  const origin = grid.byId.get(originHexId)
  const heroSide = factionSide(state.factions, hero.factionId)
  const ownLocations = state.locations.filter((location) => location.side === hero.factionId)
  const alliedLocations = state.locations.filter((location) => factionSide(state.factions, location.side) === heroSide)
  const recoveryPool = ownLocations.length ? ownLocations : alliedLocations
  const recovery = recoveryPool.map((location) => {
    const target = grid.byId.get(locationHexId(location, state.grid.config))
    return { location, distance: origin && target ? hexDistance(origin, target) : Number.POSITIVE_INFINITY }
  }).sort((left, right) => left.distance - right.distance)[0]?.location ?? null
  const turns = destroyed ? (roll <= 50 ? 2 : 4) : 2
  campaign.heroStates[heroId] = { ...previousHeroState, status: 'wounded', summoned: true, healTurnsLeft: turns, recoveryLocationId: recovery?.id ?? null, diedRound: null, diedLocationId: null }
  campaign.log.unshift(campaignEvent(campaign, `${hero.name} ранен и выбыл на ${turns} ход${turns === 2 ? 'а' : 'ов'}.`, 'hero', hero.factionId))
  return 'wounded'
}

function promoteCommanders(state: MapState, campaign: CampaignState, armies: Army[]) {
  for (const army of armies) {
    if (army.commander) continue
    const promoted = army.heroSlots.shift()
    if (promoted) army.commander = { kind: 'hero', entityId: promoted.entityId, objectId: promoted.objectId }
    else army.commander = takeFreeCaptain(campaign, army.factionId, state.captains)
  }
}

function evaluateCampaignOutcome(state: MapState, campaign: CampaignState, armies: Army[], locations: MapLocation[], heroes: Hero[]) {
  for (const faction of state.factions.filter((candidate) => candidate.playable && (candidate.alignment === 'good' || candidate.alignment === 'evil'))) {
    if (campaign.factionStates[faction.id]?.status === 'inactive') continue
    const factionState = factionCampaignState(campaign, faction.id)
    if (factionState.status === 'eliminated') continue
    const hasLocations = locations.some((location) => location.side === faction.id)
    const hasArmies = armies.some((army) => army.factionId === faction.id)
    if (hasLocations || hasArmies) continue
    factionState.status = 'eliminated'
    factionState.eliminatedOnRound = campaign.round
    campaign.freeCaptains[faction.id] = []
    for (const hero of heroes.filter((candidate) => candidate.factionId === faction.id && candidate.alive)) {
      hero.alive = false
      const wasDead = campaign.heroStates[hero.id]?.status === 'dead'
      const previous = campaign.heroStates[hero.id] ?? { status: 'active' as const, summoned: true, availableSinceRound: null, summonLocationId: null, healTurnsLeft: 0, recoveryLocationId: null, diedRound: null, diedLocationId: null }
      campaign.heroStates[hero.id] = { ...previous, status: 'dead', summoned: previous.summoned, healTurnsLeft: 0, recoveryLocationId: null, diedRound: campaign.round, diedLocationId: null }
      if (!wasDead) factionState.statistics.heroesLost += 1
    }
    for (const locationState of Object.values(campaign.locationStates)) locationState.reserve = locationState.reserve.filter((slot) => slot.kind !== 'hero' || heroes.find((hero) => hero.id === slot.entityId)?.factionId !== faction.id)
    campaign.log.unshift(campaignEvent(campaign, `Фракция «${faction.label}» уничтожена и больше не участвует в кампании.`, 'system', faction.id))
  }

  const goodParticipants = state.factions.filter((faction) => faction.playable && faction.alignment === 'good' && campaign.factionStates[faction.id]?.status !== 'inactive')
  const evilParticipants = state.factions.filter((faction) => faction.playable && faction.alignment === 'evil' && campaign.factionStates[faction.id]?.status !== 'inactive')
  const goodEliminated = goodParticipants.length > 0 && goodParticipants.every((faction) => campaign.factionStates[faction.id]?.status === 'eliminated')
  const evilEliminated = evilParticipants.length > 0 && evilParticipants.every((faction) => campaign.factionStates[faction.id]?.status === 'eliminated')
  const playerEliminated = Boolean(campaign.playerFactionId && campaign.factionStates[campaign.playerFactionId]?.status === 'eliminated')
  const nextStatus = playerEliminated ? 'player_defeated' : evilEliminated ? 'victory_good' : goodEliminated ? 'victory_evil' : 'active'
  if (nextStatus !== campaign.gameStatus) {
    campaign.gameStatus = nextStatus
    campaign.gameResultDismissed = false
    if (nextStatus === 'victory_good' || nextStatus === 'victory_evil') campaign.log.unshift(campaignEvent(campaign, `${nextStatus === 'victory_good' ? 'Свет' : 'Тьма'} одерживает победу в кампании!`, 'system', campaign.playerFactionId))
    else if (nextStatus === 'player_defeated') campaign.log.unshift(campaignEvent(campaign, 'Фракция игрока уничтожена. Кампания проиграна.', 'system', campaign.playerFactionId))
  }
}

function recordHeroBattleOutcome(battles: AutoBattleReport[], conflict: CampaignConflict, hero: Hero | undefined, outcome: 'survived' | 'wounded' | 'dead') {
  if (!hero) return
  const report = battles.find((battle) => battle.conflictId === conflict.id)
    ?? battles.find((battle) => battle.round === conflict.round && battle.locationId === conflict.locationId)
  if (!report) return
  const result = [...report.attackerLosses, ...report.defenderLosses, ...report.garrisonLosses].find((loss) => loss.kind === 'hero' && loss.objectId === hero.objectId)
  if (!result) return
  result.outcome = outcome
  result.destroyed = outcome === 'dead'
}

function processAftermath(state: MapState, campaign: CampaignState, sourceArmies: Army[], sourceLocations: MapLocation[], sourceRegions: Region[], sourceHeroes: Hero[], sourceBattles: AutoBattleReport[]) {
  let armies = cloneArmies(sourceArmies)
  const locations = cloneLocations(sourceLocations)
  const regions = sourceRegions.map((region) => ({ ...region, hexes: [...(region.hexes ?? [])] }))
  const heroes = sourceHeroes.map((hero) => ({ ...hero }))
  const battles = cloneBattles(sourceBattles)
  campaign.phase = 'aftermath'

  for (const conflict of campaign.conflicts.filter((candidate) => candidate.status === 'resolved' && candidate.winnerSide)) {
    const loserSide = oppositeSide(conflict.winnerSide!)
    const loserIds = loserSide === conflict.attackerSide ? conflict.attackerArmyIds : conflict.defenderArmyIds
    const winnerIds = conflict.winnerSide === conflict.attackerSide
      ? [...conflict.attackerArmyIds, ...conflict.attackerReinforcementArmyIds]
      : [...conflict.defenderArmyIds, ...conflict.defenderReinforcementArmyIds]
    for (const armyId of winnerIds) {
      const army = armies.find((candidate) => candidate.id === armyId)
      if (!army) continue
      const heroIds = [...(army.commander?.kind === 'hero' ? [army.commander.entityId] : []), ...army.heroSlots.map((slot) => slot.entityId)]
      for (const heroId of heroIds) recordHeroBattleOutcome(battles, conflict, heroes.find((hero) => hero.id === heroId), 'survived')
    }
    for (const armyId of loserIds) {
      const army = armies.find((candidate) => candidate.id === armyId)
      if (!army) continue
      const heroIds = [...(army.commander?.kind === 'hero' ? [army.commander.entityId] : []), ...army.heroSlots.map((slot) => slot.entityId)]
      const capturedLocationId = conflict.winnerSide === conflict.attackerSide && loserSide === conflict.defenderSide ? conflict.locationId : null
      const destination = chooseRetreatLocation({ ...state, locations, regions } as MapState, army, conflict.hexId, capturedLocationId)
      if (!destination) {
        for (const heroId of heroIds) {
          const hero = heroes.find((candidate) => candidate.id === heroId)
          const outcome = applyHeroFate({ ...state, locations, regions } as MapState, campaign, armies, heroes, heroId, conflict, true, conflict.hexId)
          recordHeroBattleOutcome(battles, conflict, hero, outcome)
        }
        armies = armies.filter((candidate) => candidate.id !== armyId)
        campaign.log.unshift(campaignEvent(campaign, `${army.name} не имеет своей локации для отхода и уничтожено.`, 'army_destroyed', army.factionId))
      } else {
        const extraLosses = retreatAdditionalLosses(destination.distance)
        const voluntaryRearGuard = conflict.resolution === 'defender_retreat' ? 1 : 0
        const removed = removeWeakestRetreatUnits(army, extraLosses + voluntaryRearGuard, state.unitTypes)
        army.hexId = destination.hexId
        army.movementRemaining = 0
        army.status = 'retreating'
        army.engaged = false
        army.exhaustedUntilRound = campaign.round + 1
        for (const heroId of heroIds) {
          const hero = heroes.find((candidate) => candidate.id === heroId)
          const outcome = applyHeroFate({ ...state, locations, regions } as MapState, campaign, armies, heroes, heroId, conflict, false, conflict.hexId)
          recordHeroBattleOutcome(battles, conflict, hero, outcome)
        }
        const destinationName = locations.find((location) => location.id === destination.locationId)?.name ?? 'своей локации'
        campaign.turnMovements.push({ id: `log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, round: campaign.round, factionId: army.factionId, armyName: army.name, commanderName: armyCommanderName(army, heroes), action: 'retreated', targetLabel: destinationName === 'своей локации' ? null : destinationName, distance: destination.distance })
        campaign.log.unshift(campaignEvent(campaign, `${army.name} отступает в «${destinationName}» на ${destination.distance} гекс${destination.distance === 1 ? '' : destination.distance < 5 ? 'а' : 'ов'}${removed.length ? ` и теряет в пути: ${removed.join(', ')}` : ''}. Армия деморализована до следующего хода.`, 'retreat', army.factionId))
      }
    }
    const loserReinforcementIds = loserSide === conflict.attackerSide ? conflict.attackerReinforcementArmyIds : conflict.defenderReinforcementArmyIds
    for (const armyId of loserReinforcementIds) {
      const army = armies.find((candidate) => candidate.id === armyId)
      if (!army) continue
      army.movementRemaining = 0
      army.status = 'marched'
      const heroIds = [...(army.commander?.kind === 'hero' ? [army.commander.entityId] : []), ...army.heroSlots.map((slot) => slot.entityId)]
      for (const heroId of heroIds) {
        const hero = heroes.find((candidate) => candidate.id === heroId)
        const outcome = applyHeroFate({ ...state, locations, regions } as MapState, campaign, armies, heroes, heroId, conflict, false, army.hexId)
        recordHeroBattleOutcome(battles, conflict, hero, outcome)
      }
    }
    if (conflict.winnerSide === conflict.attackerSide && conflict.locationId) {
      const location = locations.find((candidate) => candidate.id === conflict.locationId)
      const oldOwnerSide = factionSide(state.factions, location?.side)
      if (location && oldOwnerSide === conflict.defenderSide) {
        const garrisonHeroes = (campaign.locationStates[location.id]?.reserve ?? []).filter((slot) => slot.kind === 'hero').map((slot) => slot.entityId)
        for (const heroId of garrisonHeroes) {
          const hero = heroes.find((candidate) => candidate.id === heroId)
          const outcome = applyHeroFate({ ...state, locations, regions } as MapState, campaign, armies, heroes, heroId, conflict, true, conflict.hexId)
          recordHeroBattleOutcome(battles, conflict, hero, outcome)
        }
        captureLocation(locations, regions, campaign, location.id, conflict.captorFactionId)
        const report = battles.find((battle) => battle.conflictId === conflict.id) ?? battles.find((battle) => battle.round === campaign.round && battle.locationId === location.id && !battle.capturedLocationId)
        if (report) report.capturedLocationId = location.id
        campaign.log.unshift(campaignEvent(campaign, `${location.name} захвачена фракцией «${state.factions.find((faction) => faction.id === conflict.captorFactionId)?.label ?? conflict.captorFactionId}».`, 'capture', conflict.captorFactionId))
      }
    }
  }

  for (const army of armies) army.engaged = false
  promoteCommanders(state, campaign, armies)
  const ghostArmies = armies.filter((army) => army.unitSlots.length === 0 && army.heroSlots.length === 0 && army.commander?.kind !== 'hero')
  for (const army of ghostArmies) campaign.log.unshift(campaignEvent(campaign, `${army.name} рассеяно: в составе не осталось боевых отрядов или героев.`, 'army_destroyed', army.factionId))
  const ghostIds = new Set(ghostArmies.map((army) => army.id))
  armies = armies.filter((army) => !ghostIds.has(army.id))
  for (const army of armies) army.name = generateArmyName(army, armies, state.factions, locations, heroes, state.grid.config)
  campaign.currentConflictId = null
  evaluateCampaignOutcome({ ...state, locations, regions } as MapState, campaign, armies, locations, heroes)
  campaign.log.unshift(campaignEvent(campaign, `Последствия раунда ${campaign.round} применены.`, 'system', null))
  return { armies, locations, regions, heroes, battles }
}

export const useMapStore = create<MapState>((set) => ({
  locations: [], grid: { config: { ...DEFAULT_GRID_CONFIG }, cells: {} }, factions: [], economicTypes: createDefaultEconomicTypes(), unitTypes: [], heroes: [], captains: [], armies: [], regions: [],
  campaign: createDefaultCampaign([]), battles: [], editorTemplate: null, gameSave: null, selectedId: null, selectedHexId: null, selectedHexIds: [], selectedArmyId: null, latestBattleId: null,
  mode: 'edit', viewMode: 'cinematic', hexEdit: false, addKind: null, history: [], future: [], revision: 0,

  initialize: (world, saveGame) => {
    const withEconomy = { ...world, economicTypes: world.economicTypes?.length ? world.economicTypes : createDefaultEconomicTypes() }
    setActiveEconomicTypes(withEconomy.economicTypes)
    const template = cloneSnapshot(withEconomy)
    set({ ...cloneSnapshot(template), editorTemplate: template, gameSave: cloneSaveGame(saveGame), mode: 'edit', selectedId: null, selectedHexId: null, selectedHexIds: [], selectedArmyId: null, latestBattleId: null, history: [], future: [], revision: 0 })
  },

  newGame: (playerFactionId, fogEnabled = true, modId = 'default', requestedFactionIds, strategicDifficulty = 'warrior', rtsDifficulty = 'warrior') => set((state) => {
    const template = state.mode === 'edit' ? cloneSnapshot(currentSnapshot(state)) : state.editorTemplate ? cloneSnapshot(state.editorTemplate) : cloneSnapshot(currentSnapshot(state))
    const playerFaction = template.factions.find((faction) => faction.id === playerFactionId && faction.playable && (faction.alignment === 'good' || faction.alignment === 'evil'))
    if (!playerFaction) return state
    const playableIds = new Set(template.factions.filter((faction) => faction.playable && (faction.alignment === 'good' || faction.alignment === 'evil')).map((faction) => faction.id))
    const activeFactionIds = new Set((requestedFactionIds ?? [...playableIds]).filter((id) => playableIds.has(id)))
    activeFactionIds.add(playerFaction.id)
    const hasGood = template.factions.some((faction) => faction.alignment === 'good' && activeFactionIds.has(faction.id))
    const hasEvil = template.factions.some((faction) => faction.alignment === 'evil' && activeFactionIds.has(faction.id))
    if (!hasGood || !hasEvil) return state
    const inactiveFactionIds = new Set([...playableIds].filter((id) => !activeFactionIds.has(id)))
    const initialSave = createNewSaveGame(snapshotToWorld(template), modId)
    const gameWorld = applySaveGame(snapshotToWorld(template), initialSave)
    gameWorld.locations = gameWorld.locations.map((location) => inactiveFactionIds.has(location.side) ? { ...location, side: 'civilian' } : location)
    gameWorld.regions = gameWorld.regions.map((region) => ({ ...region, hexes: [...(region.hexes ?? [])], ownerFactionId: region.ownerFactionId && inactiveFactionIds.has(region.ownerFactionId) ? null : region.ownerFactionId }))
    gameWorld.armies = gameWorld.armies.filter((army) => activeFactionIds.has(army.factionId))
    gameWorld.grid = cloneGrid(gameWorld.grid)
    for (const cell of Object.values(gameWorld.grid.cells)) {
      if (cell.owner && inactiveFactionIds.has(cell.owner)) cell.owner = null
      if (cell.zoneOfControl && inactiveFactionIds.has(cell.zoneOfControl)) cell.zoneOfControl = null
    }
    const campaign = cloneCampaign(gameWorld.campaign)
    campaign.round = 1
    campaign.phase = 'planning_good'
    campaign.firstMoverThisRound = 'good'
    campaign.playerFactionId = playerFaction.id
    campaign.playerSide = playerFaction.alignment === 'evil' ? 'evil' : 'good'
    campaign.aiEnabled = true
    campaign.aiDifficulty = { strategic: strategicDifficulty, rts: rtsDifficulty }
    campaign.gameStatus = 'active'
    campaign.gameResultDismissed = false
    campaign.pendingOrders=[]
    campaign.conflicts = []
    campaign.currentConflictId = null
    campaign.factionStates = Object.fromEntries(template.factions.filter((faction) => faction.playable).map((faction) => [faction.id, { status: activeFactionIds.has(faction.id) ? 'active' as const : 'inactive' as const, eliminatedOnRound: null, statistics: { battlesWon: 0, battlesLost: 0, locationsCaptured: 0, heroesLost: 0 } }]))
    campaign.turnOrder = template.factions.filter((faction) => activeFactionIds.has(faction.id)).map((faction) => faction.id)
    for (const locationState of Object.values(campaign.locationStates)) {
      locationState.recruitmentQueue = locationState.recruitmentQueue.filter((item) => {
        const unit = gameWorld.unitTypes.find((candidate) => candidate.id === item.entityId)
        return Boolean(unit && activeFactionIds.has(unit.factionId))
      })
      locationState.reserve = locationState.reserve.filter((slot) => {
        const factionId = slot.kind === 'unit' ? gameWorld.unitTypes.find((unit) => unit.id === slot.entityId)?.factionId : gameWorld.heroes.find((hero) => hero.id === slot.entityId)?.factionId
        return Boolean(factionId && activeFactionIds.has(factionId))
      })
    }
    campaign.freeCaptains = Object.fromEntries(template.factions.map((faction) => [faction.id, []]))
    campaign.fogOfWar = { enabled: fogEnabled, overlayVisible: true, lastSeenArmies: [], lastSeenLocations: [] }
    campaign.log = [campaignEvent(campaign, `Новая кампания началась. Фракция игрока: «${playerFaction.label}». Активных фракций: ${activeFactionIds.size}.`, 'system', playerFaction.id)]
    const workingState = { ...state, ...cloneSnapshot(gameWorld), campaign } as MapState
    const initializedHeroes = initializeNewCampaignHeroes(workingState, campaign, gameWorld.armies, gameWorld.heroes)
    let armies = initializedHeroes.armies
    let heroes = initializedHeroes.heroes
    let prepared = preparePlanningSide({ ...workingState, armies, heroes } as MapState, campaign, armies, heroes, 'good')
    armies = prepared.armies
    heroes = prepared.heroes
    if (campaign.aiEnabled && campaign.playerSide !== 'good') armies = runAiPlanning('good', campaign, armies, gameWorld.locations, gameWorld.factions, gameWorld.unitTypes, heroes, gameWorld.captains, gameWorld.grid, playerFaction.id)
    if (campaign.playerSide === 'evil') {
      campaign.phase = 'planning_evil'
      prepared = preparePlanningSide({ ...workingState, armies, heroes, campaign } as MapState, campaign, armies, heroes, 'evil')
      armies = prepared.armies
      heroes = prepared.heroes
    }
    campaign.activeFactionId = playerFaction.id
    campaign.turnMovements = []
    campaign.alliedPlans = campaign.aiEnabled ? planAlliedMovement(campaign.playerSide, campaign, armies, gameWorld.locations, gameWorld.factions, gameWorld.grid, gameWorld.regions, playerFaction.id) : []
    refreshFogIntel(campaign, armies, gameWorld.locations, gameWorld.factions, gameWorld.grid, gameWorld.regions, true)
    const nextWorld: WorldData = { ...gameWorld, version: WORLD_DATA_VERSION, armies, heroes, campaign, battles: [] }
    const gameSave = extractSaveGame(nextWorld, initialSave)
    return { ...cloneSnapshot(nextWorld), editorTemplate: template, gameSave, mode: 'game', viewMode: 'cinematic', hexEdit: false, selectedId: null, selectedArmyId: null, selectedHexId: null, selectedHexIds: [], latestBattleId: null, history: [], future: [], revision: state.revision + 1 }
  }),


  setFogOverlayVisible: (visible) => set((state) => {
    if (state.mode !== 'game' || !state.campaign.fogOfWar.enabled || state.campaign.fogOfWar.overlayVisible === visible) return state
    const campaign = cloneCampaign(state.campaign)
    campaign.fogOfWar.overlayVisible = visible
    return gameCommit(state, { campaign })
  }),

  dismissGameResult: () => set((state) => {
    if (state.campaign.gameStatus === 'active' || state.campaign.gameResultDismissed) return state
    const campaign = cloneCampaign(state.campaign)
    campaign.gameResultDismissed = true
    return gameCommit(state, { campaign })
  }),

  select: (selectedId) => set({ selectedId, selectedArmyId: null, selectedHexId: null, selectedHexIds: [] }),
  selectArmy: (selectedArmyId) => set((state) => {
    const army = selectedArmyId ? state.armies.find((item) => item.id === selectedArmyId) : null
    const canControl = Boolean(army && army.factionId === state.campaign.playerFactionId && state.mode === 'game' && (state.campaign.phase.startsWith('planning_') || state.campaign.phase === 'movement_first' || state.campaign.phase === 'movement_second'))
    return { selectedArmyId, selectedId: null, selectedHexId: null, selectedHexIds: [], ...(canControl ? { viewMode: 'tactical' as const } : {}) }
  }),
  selectHex: (id, behavior = 'replace') => set((state) => {
    if (!id) return { selectedHexId: null, selectedHexIds: [] }
    if (behavior === 'replace') return { selectedHexId: id, selectedHexIds: [id] }
    const exists = state.selectedHexIds.includes(id)
    const selectedHexIds = behavior === 'toggle'
      ? (exists ? state.selectedHexIds.filter((item) => item !== id) : [...state.selectedHexIds, id])
      : (exists ? state.selectedHexIds : [...state.selectedHexIds, id])
    return { selectedHexId: selectedHexIds[selectedHexIds.length - 1] ?? null, selectedHexIds }
  }),
  selectHexes: (ids, behavior = 'replace') => set((state) => {
    const unique = [...new Set(ids)]
    const selectedHexIds = behavior === 'add' ? [...new Set([...state.selectedHexIds, ...unique])] : unique
    return { selectedHexId: selectedHexIds[selectedHexIds.length - 1] ?? null, selectedHexIds }
  }),
  clearSelection: () => set({ selectedId: null, selectedArmyId: null, selectedHexId: null, selectedHexIds: [] }),
  dismissBattle: () => set({ latestBattleId: null }),

  setMode: (mode) => set((state) => {
    if (mode === state.mode) return state
    if (mode === 'game') {
      const template = cloneSnapshot(currentSnapshot(state))
      const saveGame = state.gameSave ? cloneSaveGame(state.gameSave) : createNewSaveGame(snapshotToWorld(template))
      const gameWorld = applySaveGame(snapshotToWorld(template), saveGame)
      setActiveEconomicTypes(gameWorld.economicTypes ?? createDefaultEconomicTypes())
      return { ...cloneSnapshot({ ...gameWorld, economicTypes: gameWorld.economicTypes ?? createDefaultEconomicTypes() }), editorTemplate: template, gameSave: saveGame, mode, addKind: null, hexEdit: false, viewMode: 'cinematic', selectedId: null, selectedArmyId: null, selectedHexId: null, selectedHexIds: [], history: [], future: [] }
    }
    const gameSave = state.mode === 'game' ? extractSaveGame(snapshotToWorld(currentSnapshot(state)), state.gameSave) : state.gameSave
    const template = state.editorTemplate ? cloneSnapshot(state.editorTemplate) : cloneSnapshot(currentSnapshot(state))
    setActiveEconomicTypes(template.economicTypes ?? createDefaultEconomicTypes())
    return { ...cloneSnapshot(template), editorTemplate: template, gameSave, mode, addKind: null, hexEdit: false, viewMode: 'cinematic', selectedId: null, selectedArmyId: null, selectedHexId: null, selectedHexIds: [], latestBattleId: null, history: [], future: [] }
  }),
  setViewMode: (viewMode) => set({ viewMode }),
  setHexEdit: (hexEdit) => set({ hexEdit, addKind: null, viewMode: hexEdit ? 'strategic' : 'cinematic', selectedArmyId: null, selectedHexId: null, selectedHexIds: [] }),
  setAddKind: (addKind) => set({ addKind, hexEdit: false, selectedHexId: null, selectedHexIds: [] }),

  updateLocation: (id, patch) => set((state) => {
    if (state.mode !== 'edit') return state
    const locations = cloneLocations(state.locations)
    const index = locations.findIndex((item) => item.id === id)
    if (index < 0) return state
    const next = { ...locations[index], ...patch, id }
    if (patch.hex && locations.some((item) => item.id !== id && item.hex === patch.hex)) return state
    if (patch.hex) next.regionId = regionIdForHex(state.regions, patch.hex) ?? next.regionId
    if (patch.structuralType === 'stronghold') delete next.hexes
    locations[index] = next
    const territory = rebuildTerritory(locations, state.regions.map((region) => ({ ...region, hexes: [...region.hexes] })))
    return pushHistory(state, { ...cloneSnapshot(currentSnapshot(state)), ...territory })
  }),
  moveLocation: (id, hex) => set((state) => {
    if (state.mode !== 'edit' || state.hexEdit || state.locations.some((item) => item.id !== id && item.hex === hex)) return state
    const locations = cloneLocations(state.locations)
    const index = locations.findIndex((item) => item.id === id)
    if (index < 0) return state
    locations[index] = {
      ...locations[index],
      hex,
      regionId: regionIdForHex(state.regions, hex) ?? locations[index].regionId,
    }
    const territory = rebuildTerritory(locations, state.regions.map((region) => ({ ...region, hexes: [...region.hexes] })))
    return pushHistory(state, { ...cloneSnapshot(currentSnapshot(state)), ...territory })
  }),
  addLocation: (structuralType, hex) => set((state) => {
    if (state.mode !== 'edit' || state.hexEdit || state.locations.some((item) => item.hex === hex)) return state
    const regionId = regionIdForHex(state.regions, hex) ?? ''
    if (!regionId) return state
    const id = makeId(`map-object-${Date.now().toString(36)}`, state.locations.map((item) => item.id))
    const stronghold = structuralType === 'stronghold'
    const name = stronghold ? 'New Stronghold' : 'New Domain'
    const nameTranslations = { ru: stronghold ? 'Новый оплот' : 'Новое владение' }
    const location: MapLocation = {
      id, name, nameTranslations, side: 'civilian', structuralType, hex, regionId,
      ...(stronghold ? {} : { hexes: [hex] }),
      image: '', economicType: stronghold ? 'fortress' : 'village',
      income: stronghold ? { gold: 100, materials: 20 } : { gold: 30, materials: 0 },
      recruitmentSlots: stronghold ? 3 : 1, commandPointLimit: stronghold ? 15 : 5,
      recruitment: [], locationTags: [], culture: null, extraRecruitables: [], blockedRecruitables: [],
      rtsMapId: '', rtsMapCache: null, rtsFortress: null, armyLimitBonus: 0,
    }
    const locations = [...cloneLocations(state.locations), location]
    const territory = rebuildTerritory(locations, state.regions.map((region) => ({ ...region, hexes: [...region.hexes] })))
    const campaign = cloneCampaign(state.campaign)
    campaign.locationStates[id] = { locationId: id, recruitmentQueue: [], reserve: [], occupationTurnsLeft: 0 }
    return { ...pushHistory(state, { ...cloneSnapshot(currentSnapshot(state)), ...territory, campaign }), selectedId: id, addKind: null }
  }),
  duplicateLocation: (id) => set((state) => {
    if (state.mode !== 'edit') return state
    const source = state.locations.find((item) => item.id === id)
    if (!source) return state
    const origin = source.hex.split(':').map(Number)
    let target = ''
    for (let radius = 1; radius < 20 && !target; radius++) {
      for (let dq = -radius; dq <= radius && !target; dq++) {
        for (let dr = -radius; dr <= radius && !target; dr++) {
          const candidate = `${origin[0] + dq}:${origin[1] + dr}`
          if (!state.locations.some((item) => item.hex === candidate) && regionIdForHex(state.regions, candidate)) target = candidate
        }
      }
    }
    if (!target) return state
    const duplicateId = makeId(`${id}-copy`, state.locations.map((item) => item.id))
    const duplicateTranslations = Object.fromEntries(Object.entries(source.nameTranslations ?? {}).map(([language, value]) => [language, `${value} — ${language === 'ru' ? 'копия' : 'copy'}`]))
    const duplicate: MapLocation = {
      ...source,
      id: duplicateId,
      name: `${source.name} — copy`,
      nameTranslations: duplicateTranslations,
      hex: target,
      regionId: regionIdForHex(state.regions, target) ?? source.regionId,
      rtsMapId: '',
      rtsMapCache: null,
      rtsFortress: null,
    }
    const locations = [...cloneLocations(state.locations), duplicate]
    const territory = rebuildTerritory(locations, state.regions.map((region) => ({ ...region, hexes: [...region.hexes] })))
    const campaign = cloneCampaign(state.campaign)
    campaign.locationStates[duplicateId] = { locationId: duplicateId, recruitmentQueue: [], reserve: [], occupationTurnsLeft: 0 }
    return { ...pushHistory(state, { ...cloneSnapshot(currentSnapshot(state)), ...territory, campaign }), selectedId: duplicateId }
  }),
  removeLocation: (id) => set((state) => {
    if (state.mode !== 'edit') return state
    const source = state.locations.find((location) => location.id === id)
    if (!source) return state
    const grid = cloneGrid(state.grid)
    const campaign = cloneCampaign(state.campaign)
    delete campaign.locationStates[id]
    const locations = state.locations.filter((item) => item.id !== id)
    const territory = rebuildTerritory(locations, state.regions.map((region) => ({ ...region, hexes: [...region.hexes] })))
    return pushHistory(state, {
      ...cloneSnapshot(currentSnapshot(state)),
      ...territory,
      grid,
      campaign,
      battles: state.battles.filter((battle) => battle.locationId !== id),
    })
  }),

  updateHex: (id, patch) => set((state) => {
    if (state.mode !== 'edit') return state
    const grid = cloneGrid(state.grid)
    const coordinates = parseHexId(id)
    grid.cells[id] = { q: coordinates.q, r: coordinates.r, ...(grid.cells[id] ?? {}), ...patch }
    let regions = state.regions.map((region) => ({ ...region, hexes: [...region.hexes] }))
    if (patch.regionId !== undefined) {
      const target = patch.regionId
      regions = regions.map((region) => {
        const without = region.hexes.filter((hex) => hex !== id)
        if (target && region.id === target) return { ...region, hexes: [...new Set([...without, id])].sort() }
        return { ...region, hexes: without }
      })
      // Authored region.hexes is the source of truth — drop per-cell override after paint.
      if (grid.cells[id]) {
        const { regionId: _drop, ...rest } = grid.cells[id]
        grid.cells[id] = rest
      }
    }
    const territory = rebuildTerritory(cloneLocations(state.locations), regions)
    return pushHistory(state, { ...cloneSnapshot(currentSnapshot(state)), grid, ...territory })
  }),
  updateHexes: (ids, patch) => set((state) => {
    if (state.mode !== 'edit' || !ids.length) return state
    const unique = [...new Set(ids)]
    const grid = cloneGrid(state.grid)
    for (const id of unique) {
      const coordinates = parseHexId(id)
      grid.cells[id] = { q: coordinates.q, r: coordinates.r, ...(grid.cells[id] ?? {}), ...patch }
    }
    let regions = state.regions.map((region) => ({ ...region, hexes: [...region.hexes] }))
    if (patch.regionId !== undefined) {
      const target = patch.regionId
      const painted = new Set(unique)
      regions = regions.map((region) => {
        const without = region.hexes.filter((hex) => !painted.has(hex))
        if (target && region.id === target) return { ...region, hexes: [...new Set([...without, ...unique])].sort() }
        return { ...region, hexes: without }
      })
      for (const id of unique) {
        if (!grid.cells[id]) continue
        const { regionId: _drop, ...rest } = grid.cells[id]
        grid.cells[id] = rest
      }
    }
    const territory = rebuildTerritory(cloneLocations(state.locations), regions)
    return pushHistory(state, { ...cloneSnapshot(currentSnapshot(state)), grid, ...territory })
  }),
  setHexTerrain: (id, terrain) => set((state) => {
    if (state.mode !== 'edit') return state
    const grid = cloneGrid(state.grid); const coordinates = parseHexId(id); const definition = TERRAIN_BY_ID[terrain]
    grid.cells[id] = { q: coordinates.q, r: coordinates.r, ...(grid.cells[id] ?? {}), terrain, moveCost: definition.moveCost, passable: definition.passable }
    return pushHistory(state, { ...cloneSnapshot(currentSnapshot(state)), grid })
  }),
  setHexesTerrain: (ids, terrain) => set((state) => {
    if (state.mode !== 'edit' || !ids.length) return state
    const grid = cloneGrid(state.grid); const definition = TERRAIN_BY_ID[terrain]
    for (const id of new Set(ids)) { const coordinates = parseHexId(id); grid.cells[id] = { q: coordinates.q, r: coordinates.r, ...(grid.cells[id] ?? {}), terrain, moveCost: definition.moveCost, passable: definition.passable } }
    return pushHistory(state, { ...cloneSnapshot(currentSnapshot(state)), grid })
  }),
  resetHex: (id) => set((state) => {
    if (state.mode !== 'edit' || !state.grid.cells[id]) return state
    const grid = cloneGrid(state.grid); delete grid.cells[id]
    return pushHistory(state, { ...cloneSnapshot(currentSnapshot(state)), grid })
  }),
  resetHexes: (ids) => set((state) => {
    if (state.mode !== 'edit') return state
    const grid = cloneGrid(state.grid); let changed = false
    for (const id of new Set(ids)) if (grid.cells[id]) { delete grid.cells[id]; changed = true }
    return changed ? pushHistory(state, { ...cloneSnapshot(currentSnapshot(state)), grid }) : state
  }),
  setMovementBudget: (movementBudget) => set((state) => {
    if (state.mode !== 'edit') return state
    const grid = cloneGrid(state.grid); grid.config.movementBudget = Math.max(1, Math.min(30, Math.round(movementBudget)))
    return pushHistory(state, { ...cloneSnapshot(currentSnapshot(state)), grid })
  }),

  addFaction: () => set((state) => {
    const id = makeId('new-faction', state.factions.map((item) => item.id))
    const faction: FactionDefinition = { id, label: 'New Faction', labelTranslations:{ru:'Новая фракция'}, color: '#3978c5', emblem: '', playable: true, alignment: 'neutral', rtsColor: 'blue', baseArmyLimit: 2, startingTreasury: { gold: 500, materials: 200 } }
    const factions = [...state.factions.map((item) => ({ ...item })), faction]
    const captainId = makeId(`${id}-captain`, state.captains.map((captain) => captain.id))
    const captain: CaptainType = { id: captainId, factionId: id, name: `Captain: ${faction.label}`,nameTranslations:{ru:`Капитан: ${faction.labelTranslations.ru}`}, battlePower: 40, command: 5, movementBonus: 0, portrait: '', namePool: captainNamesForFaction(id).map((name)=>name), namePoolTranslations:{} }
    const campaign = cloneCampaign(state.campaign); campaign.turnOrder.push(id); campaign.treasuries[id] = { gold: 500, materials: 200, lastIncome: { gold: 0, materials: 0 }, lastUpkeep: 0 }; campaign.factionStates[id] = { status: 'active', eliminatedOnRound: null, statistics: { battlesWon: 0, battlesLost: 0, locationsCaptured: 0, heroesLost: 0 } }; campaign.freeCaptains[id] = []
    return pushHistory(state, { ...cloneSnapshot(currentSnapshot(state)), factions, captains: [...state.captains.map((item) => ({ ...item })), captain], campaign })
  }),
  updateFaction: (id, patch) => set((state) => {
    const factions = state.factions.map((item) => item.id === id ? { ...item, ...patch, id } : { ...item })
    const campaign = cloneCampaign(state.campaign)
    campaign.turnOrder = factions.filter((item) => item.playable).map((item) => item.id)
    for (const faction of factions.filter((item) => item.playable)) factionCampaignState(campaign, faction.id)
    if (patch.startingTreasury && state.mode === 'edit') campaign.treasuries[id] = { gold: patch.startingTreasury.gold, materials: patch.startingTreasury.materials, lastIncome: { gold: 0, materials: 0 }, lastUpkeep: 0 }
    if (!campaign.turnOrder.includes(campaign.activeFactionId)) campaign.activeFactionId = campaign.turnOrder[0] ?? 'civilian'
    return pushHistory(state, { ...cloneSnapshot(currentSnapshot(state)), factions, campaign })
  }),
  removeFaction: (id) => set((state) => {
    if (state.mode !== 'edit' || id === 'civilian' || !state.factions.some((faction) => faction.id === id)) return state
    const removedUnitIds = new Set(state.unitTypes.filter((unit) => unit.factionId === id).map((unit) => unit.id))
    const removedHeroIds = new Set(state.heroes.filter((hero) => hero.factionId === id).map((hero) => hero.id))
    const removedCaptainIds = new Set(state.captains.filter((captain) => captain.factionId === id).map((captain) => captain.id))
    const removedArmyIds = new Set(state.armies.filter((army) => army.factionId === id).map((army) => army.id))
    const factions = state.factions.filter((faction) => faction.id !== id).map((faction) => ({ ...faction }))
    const unitTypes = state.unitTypes.filter((unit) => !removedUnitIds.has(unit.id)).map((unit) => ({ ...unit }))
    const heroes = state.heroes.filter((hero) => !removedHeroIds.has(hero.id)).map((hero) => ({ ...hero }))
    const captains = state.captains.filter((captain) => !removedCaptainIds.has(captain.id)).map((captain) => ({ ...captain }))
    const locations = state.locations.map((location) => ({
      ...location,
      side: location.side === id ? 'civilian' : location.side,
      culture: location.culture === id ? null : location.culture,
      recruitment: location.recruitment.filter((unitId) => !removedUnitIds.has(unitId)),
      extraRecruitables: location.extraRecruitables.filter((unitId) => !removedUnitIds.has(unitId)),
      blockedRecruitables: location.blockedRecruitables.filter((unitId) => !removedUnitIds.has(unitId)),
    }))
    const regions = state.regions.map((region) => ({ ...region, hexes: [...region.hexes], ownerFactionId: region.ownerFactionId === id ? null : region.ownerFactionId }))
    const grid = cloneGrid(state.grid)
    for (const cell of Object.values(grid.cells)) {
      if (cell.owner === id) cell.owner = null
      if (cell.zoneOfControl === id) cell.zoneOfControl = null
    }
    const campaign = cloneCampaign(state.campaign)
    campaign.turnOrder = campaign.turnOrder.filter((factionId) => factionId !== id)
    delete campaign.treasuries[id]
    delete campaign.factionStates[id]
    delete campaign.freeCaptains[id]
    for (const heroId of removedHeroIds) delete campaign.heroStates[heroId]
    for (const factionId of Object.keys(campaign.freeCaptains)) campaign.freeCaptains[factionId] = campaign.freeCaptains[factionId].filter((captain) => !removedCaptainIds.has(captain.captainTypeId))
    for (const locationState of Object.values(campaign.locationStates)) {
      locationState.recruitmentQueue = locationState.recruitmentQueue.filter((item) => !removedUnitIds.has(item.entityId))
      locationState.reserve = locationState.reserve.filter((slot) => slot.kind === 'unit' ? !removedUnitIds.has(slot.entityId) : !removedHeroIds.has(slot.entityId))
    }
    const conflictUsesRemovedArmy = (conflict: CampaignConflict) => [...conflict.attackerArmyIds, ...conflict.defenderArmyIds, ...conflict.attackerReinforcementArmyIds, ...conflict.defenderReinforcementArmyIds, ...conflict.attackerDistantReinforcementArmyIds, ...conflict.defenderDistantReinforcementArmyIds, ...conflict.optionalPlayerReinforcements.map((option) => option.armyId)].some((armyId) => removedArmyIds.has(armyId))
    campaign.pendingOrders=campaign.pendingOrders.filter((order)=>!removedArmyIds.has(order.armyId))
    campaign.alliedPlans=campaign.alliedPlans.filter((plan)=>plan.factionId!==id&&!removedArmyIds.has(plan.armyId))
    campaign.turnMovements=campaign.turnMovements.filter((entry)=>entry.factionId!==id)
    campaign.conflicts = campaign.conflicts.filter((conflict) => conflict.captorFactionId !== id && !conflictUsesRemovedArmy(conflict))
    if (!campaign.conflicts.some((conflict) => conflict.id === campaign.currentConflictId)) campaign.currentConflictId = null
    campaign.fogOfWar.lastSeenArmies = campaign.fogOfWar.lastSeenArmies.filter((intel) => intel.factionId !== id && !removedArmyIds.has(intel.armyId))
    campaign.fogOfWar.lastSeenLocations = campaign.fogOfWar.lastSeenLocations.map((intel) => intel.lastKnownOwner === id ? { ...intel, lastKnownOwner: 'civilian' } : intel)
    campaign.log = campaign.log.filter((entry) => entry.factionId !== id)
    if (campaign.playerFactionId === id) campaign.playerFactionId = null
    if (campaign.activeFactionId === id) campaign.activeFactionId = campaign.turnOrder[0] ?? 'civilian'
    const armies = cloneArmies(state.armies).filter((army) => !removedArmyIds.has(army.id)).map((army) => {
      army.unitSlots = army.unitSlots.filter((slot) => !removedUnitIds.has(slot.entityId))
      army.heroSlots = army.heroSlots.filter((slot) => !removedHeroIds.has(slot.entityId))
      if (army.commander?.kind === 'hero' && removedHeroIds.has(army.commander.entityId)) army.commander = null
      if (army.commander?.kind === 'captain' && removedCaptainIds.has(army.commander.entityId)) army.commander = null
      if (!army.commander && army.heroSlots.length) {
        const promoted = army.heroSlots.shift()!
        army.commander = { kind: 'hero', entityId: promoted.entityId, objectId: promoted.objectId }
      }
      if (!army.commander) {
        const captain = captains.find((candidate) => candidate.factionId === army.factionId)
        army.commander = captain ? createCaptainCommander(captain, uniqueCaptainNameForState(state, army.factionId, captain)) : null
      }
      return army
    })
    for (const army of armies) army.name = generateArmyName(army, armies, factions, locations, heroes, grid.config)
    const battles = state.battles.filter((battle) => battle.attackerFactionId !== id && battle.defenderFactionId !== id).map((battle) => ({ ...battle }))
    return { ...pushHistory(state, { ...cloneSnapshot(currentSnapshot(state)), factions, unitTypes, heroes, captains, locations, regions, grid, armies, campaign, battles }), selectedArmyId: state.selectedArmyId && removedArmyIds.has(state.selectedArmyId) ? null : state.selectedArmyId }
  }),

  addUnitType: () => set((state) => {
    const factionId = state.factions.find((item) => item.playable)?.id ?? 'gondor'
    const id = makeId('new-unit', state.unitTypes.map((item) => item.id))
    const item: UnitType = { id, objectId: 'NewUnitHorde', factionId, name: 'New Unit',nameTranslations:{ru:'Новый отряд'}, category: 'infantry', battlePower: 100, movementPoints: 5, siegePower: 0, recruitCost: { gold: 100, materials: 0 }, recruitTime: 1, upkeep: 10, portrait: '', requiredLocationTypes: ['village','city','fortress','capital','port','farm'], requiredLocationTags: [], recruitDuringOccupation: false, transformationSourceUnitId: null }
    return pushHistory(state, { ...cloneSnapshot(currentSnapshot(state)), unitTypes: [...state.unitTypes.map((unit) => ({ ...unit })), item] })
  }),
  updateUnitType: (id, patch) => set((state) => {
    const unitTypes = state.unitTypes.map((item) => item.id === id ? { ...item, ...patch, id } : { ...item })
    const armies = cloneArmies(state.armies).map((army) => ({ ...army, unitSlots: army.unitSlots.map((slot) => slot.entityId === id && patch.objectId ? { ...slot, objectId: patch.objectId } : slot) }))
    return pushHistory(state, { ...cloneSnapshot(currentSnapshot(state)), unitTypes, armies })
  }),
  removeUnitType: (id) => set((state) => {
    const unitTypes = state.unitTypes.filter((item) => item.id !== id).map((item) => item.transformationSourceUnitId === id ? { ...item, transformationSourceUnitId: null } : item)
    const armies = cloneArmies(state.armies).map((army) => ({ ...army, unitSlots: army.unitSlots.filter((slot) => slot.entityId !== id) }))
    return pushHistory(state, { ...cloneSnapshot(currentSnapshot(state)), unitTypes, armies })
  }),

  addHero: () => set((state) => {
    const factionId = state.factions.find((item) => item.playable)?.id ?? 'gondor'; const id = makeId('new-hero', state.heroes.map((item) => item.id))
    const startingLocationId = state.locations.find((location) => location.side === factionId && getEconomicType(location.economicType).isCapital)?.id ?? state.locations.find((location) => location.side === factionId)?.id ?? null
    const hero: Hero = { id, objectId: 'NewHeroObject', factionId, name: 'New Hero',nameTranslations:{ru:'Новый полководец'}, title: '',titleTranslations:{}, battlePower: 180, command: 5, movementBonus: 0, alive: true, portrait: '', unlockType: 'starting', requiredTurn: 1, requiredLocationId: startingLocationId, summonCostGold: 0 }
    const campaign = cloneCampaign(state.campaign); campaign.heroStates[id] = { status: 'active', summoned: true, availableSinceRound: null, summonLocationId: startingLocationId, healTurnsLeft: 0, recoveryLocationId: null, diedRound: null, diedLocationId: null }
    return pushHistory(state, { ...cloneSnapshot(currentSnapshot(state)), heroes: [...state.heroes.map((item) => ({ ...item })), hero], campaign })
  }),
  updateHero: (id, patch) => set((state) => {
    const heroes = state.heroes.map((item) => item.id === id ? { ...item, ...patch, id } : { ...item })
    const armies = cloneArmies(state.armies).map((army) => ({
      ...army,
      commander: army.commander?.kind === 'hero' && army.commander.entityId === id && patch.objectId ? { ...army.commander, objectId: patch.objectId } : army.commander,
      heroSlots: army.heroSlots.map((slot) => slot.entityId === id && patch.objectId ? { ...slot, objectId: patch.objectId } : slot),
    }))
    return pushHistory(state, { ...cloneSnapshot(currentSnapshot(state)), heroes, armies })
  }),
  removeHero: (id) => set((state) => {
    const heroes = state.heroes.filter((item) => item.id !== id)
    const campaign = cloneCampaign(state.campaign)
    const armies = cloneArmies(state.armies).map((army) => {
      let heroSlots = army.heroSlots.filter((slot) => slot.entityId !== id)
      let commander = army.commander
      if (commander?.kind === 'hero' && commander.entityId === id) {
        const promoted = heroSlots.shift()
        if (promoted) commander = { kind: 'hero', entityId: promoted.entityId, objectId: promoted.objectId }
        else if (state.mode === 'game') commander = takeFreeCaptain(campaign, army.factionId, state.captains)
        else {
          const captain = state.captains.find((item) => item.factionId === army.factionId)
          commander = captain ? createCaptainCommander(captain, uniqueCaptainNameForState(state, army.factionId, captain)) : null
        }
      }
      return { ...army, commander, heroSlots }
    })
    for (const army of armies) army.name = generateArmyName(army, armies, state.factions, state.locations, heroes, state.grid.config)
    delete campaign.heroStates[id]
    return pushHistory(state, { ...cloneSnapshot(currentSnapshot(state)), heroes, armies, campaign })
  }),

  updateCaptain: (id, patch) => set((state) => {
    const captains = state.captains.map((item) => item.id === id ? { ...item, ...patch, id } : { ...item })
    return pushHistory(state, { ...cloneSnapshot(currentSnapshot(state)), captains })
  }),

  addArmy: (requestedFactionId, locationId, commanderChoice, initialUnitId) => set((state) => {
    if (state.mode !== 'edit') return state
    const faction = state.factions.find((item) => item.id === requestedFactionId && item.playable)
    const creationLocation = state.locations.find((item) => item.id === locationId && item.side === requestedFactionId)
    const initialUnit = state.unitTypes.find((item) => item.id === initialUnitId && item.factionId === requestedFactionId)
    if (!faction || !creationLocation || !initialUnit) return state
    const usedHeroIds = new Set(state.armies.flatMap((army) => [...(army.commander?.kind === 'hero' ? [army.commander.entityId] : []), ...army.heroSlots.map((slot) => slot.entityId)]))
    let commander: Army['commander'] = null
    if (commanderChoice.startsWith('hero:')) {
      const heroId = commanderChoice.slice(5)
      const hero = state.heroes.find((item) => item.id === heroId && item.factionId === faction.id && item.alive && item.unlockType === 'starting' && !usedHeroIds.has(item.id))
      if (!hero) return state
      commander = createHeroCommander(hero)
    } else if (commanderChoice === 'captain') {
      const captain = state.captains.find((item) => item.factionId === faction.id)
      if (!captain) return state
      commander = createCaptainCommander(captain, uniqueCaptainNameForState(state, faction.id, captain))
    } else return state
    const id = makeId(`army-${faction.id}`, state.armies.map((item) => item.id))
    const draft: Army = {
      id, name: '', factionId: faction.id, hexId: locationHexId(creationLocation, state.grid.config), movementRemaining: 0,
      baseUnitSlotLimit: 15, heroSlotLimit: 2, commander,
      unitSlots: [{ slotId: `${id}-unit-1`, kind: 'unit', entityId: initialUnit.id, objectId: initialUnit.objectId }], heroSlots: [],
      status: 'ready', canInitiateBattle: true, engaged: false, movedRound: null, movedInPhase: null, exhaustedUntilRound: null,
    }
    const armies = [...cloneArmies(state.armies), draft]
    draft.name = generateArmyName(draft, armies, state.factions, state.locations, state.heroes, state.grid.config)
    draft.movementRemaining = armyMovementCap(draft, state.heroes, state.captains, state.unitTypes)
    return { ...pushHistory(state, { ...cloneSnapshot(currentSnapshot(state)), armies }), selectedArmyId: id }
  }),
  updateArmy: (id, patch) => set((state) => {
    const armies = cloneArmies(state.armies)
    const index = armies.findIndex((item) => item.id === id)
    if (index < 0) return state
    const campaign = cloneCampaign(state.campaign)
    const current = armies[index]
    const factionChanged = patch.factionId && patch.factionId !== current.factionId
    const nextFactionId = patch.factionId ?? current.factionId
    const fallbackCaptain = state.captains.find((item) => item.factionId === nextFactionId)
    let commander = factionChanged ? (fallbackCaptain ? createCaptainCommander(fallbackCaptain, uniqueCaptainNameForState(state, nextFactionId, fallbackCaptain)) : null) : patch.commander !== undefined ? (patch.commander ? { ...patch.commander } : null) : current.commander
    const next: Army = {
      ...current, ...patch, id, commander,
      baseUnitSlotLimit: Math.max(1, Math.min(20, patch.baseUnitSlotLimit ?? current.baseUnitSlotLimit)),
      heroSlotLimit: Math.max(0, Math.min(5, patch.heroSlotLimit ?? current.heroSlotLimit)),
      unitSlots: (factionChanged ? [] : patch.unitSlots ?? current.unitSlots).map((slot) => ({ ...slot })),
      heroSlots: (factionChanged ? [] : patch.heroSlots ?? current.heroSlots).map((slot) => ({ ...slot })),
    }
    let usedCommandPoints = next.heroSlots.reduce((total, slot) => total + (state.heroes.find((hero) => hero.id === slot.entityId)?.commandPoints ?? 0), 0) + (next.commander?.kind === 'hero' ? (state.heroes.find((hero) => hero.id === next.commander!.entityId)?.commandPoints ?? 0) : 0)
    next.unitSlots = next.unitSlots.filter((slot) => {
      const points = state.unitTypes.find((unit) => unit.id === slot.entityId)?.commandPoints ?? 0
      if (usedCommandPoints + points > armyCommandPointLimit(next, state.heroes, state.captains)) return false
      usedCommandPoints += points
      return true
    })
    next.heroSlots = next.heroSlots.slice(0, next.heroSlotLimit)
    const captainWasReplaced = current.commander?.kind === 'captain' && (commander?.kind !== 'captain' || commander.instanceId !== current.commander.instanceId)
    if (state.mode === 'game' && captainWasReplaced) releaseCaptain(campaign, current.factionId, current.commander)
    if (next.commander?.kind === 'captain' && next.heroSlots.length) {
      const oldCaptain = next.commander
      const promoted = next.heroSlots.shift()!
      if (state.mode === 'game' && !captainWasReplaced) releaseCaptain(campaign, next.factionId, oldCaptain)
      next.commander = { kind: 'hero', entityId: promoted.entityId, objectId: promoted.objectId }
      const hero = state.heroes.find((candidate) => candidate.id === promoted.entityId)
      if (state.mode === 'game') campaign.log.unshift(campaignEvent(campaign, `${hero?.name ?? 'Герой'} принял командование. Капитан ${oldCaptain.displayName ?? 'Безымянный'} освобождён.`, 'system', next.factionId))
    }
    next.name = generateArmyName(next, armies, state.factions, state.locations, state.heroes, state.grid.config)
    const movementCap = armyMovementCap(next, state.heroes, state.captains, state.unitTypes)
    next.movementRemaining = state.mode === 'edit' ? movementCap : Math.min(next.movementRemaining, movementCap)
    armies[index] = next
    return pushHistory(state, { ...cloneSnapshot(currentSnapshot(state)), armies, campaign })
  }),

  removeArmy:(id)=>set((state)=>{const campaign=cloneCampaign(state.campaign);campaign.pendingOrders=campaign.pendingOrders.filter((order)=>order.armyId!==id);campaign.alliedPlans=campaign.alliedPlans.filter((plan)=>plan.armyId!==id);return{...pushHistory(state,{...cloneSnapshot(currentSnapshot(state)),armies:state.armies.filter((item)=>item.id!==id),campaign}),selectedArmyId:state.selectedArmyId===id?null:state.selectedArmyId}}),



  updateEconomicType: (id, patch) => set((state) => {
    if (state.mode !== 'edit') return state
    const economicTypes = (state.economicTypes?.length ? state.economicTypes : createDefaultEconomicTypes()).map((item) => {
      if (item.id !== id) return { ...item, nameTranslations: { ...(item.nameTranslations ?? {}) } }
      return {
        ...item,
        ...patch,
        id: item.id,
        nameTranslations: patch.nameTranslations ? { ...patch.nameTranslations } : { ...(item.nameTranslations ?? {}) },
        gold: Math.max(0, Number(patch.gold ?? item.gold)),
        materials: Math.max(0, Number(patch.materials ?? item.materials)),
        recruitmentSlots: Math.max(0, Math.min(20, Number(patch.recruitmentSlots ?? item.recruitmentSlots))),
        commandPointLimit: Math.max(0, Math.min(10000, Number(patch.commandPointLimit ?? item.commandPointLimit))),
        visionRadius: Math.max(0, Math.min(12, Number(patch.visionRadius ?? item.visionRadius))),
        defenseBonus: Math.max(0, Math.min(1, Number(patch.defenseBonus ?? item.defenseBonus))),
        battleType: (patch.battleType === 'siege' || patch.battleType === 'settlement') ? patch.battleType : item.battleType,
        allowsCaptainHire: patch.allowsCaptainHire !== undefined ? Boolean(patch.allowsCaptainHire) : item.allowsCaptainHire,
        isCapital: patch.isCapital !== undefined ? Boolean(patch.isCapital) : item.isCapital,
        allowedForDomain: patch.allowedForDomain !== undefined ? Boolean(patch.allowedForDomain) : item.allowedForDomain,
        allowedForStronghold: patch.allowedForStronghold !== undefined ? Boolean(patch.allowedForStronghold) : item.allowedForStronghold,
      }
    })
    setActiveEconomicTypes(economicTypes)
    return pushHistory(state, { ...cloneSnapshot(currentSnapshot(state)), economicTypes })
  }),
  applyEconomicTypeDefaults: (locationId) => set((state) => {
    if (state.mode !== 'edit') return state
    const location = state.locations.find((item) => item.id === locationId)
    if (!location) return state
    const defaults = economicDefaultsPatch(location.economicType)
    const locations = state.locations.map((item) => item.id === locationId ? {
      ...item,
      income: { ...defaults.income },
      recruitmentSlots: defaults.recruitmentSlots,
      commandPointLimit: defaults.commandPointLimit,
    } : item)
    return pushHistory(state, { ...cloneSnapshot(currentSnapshot(state)), locations })
  }),
  updateRegion: (id, patch) => set((state) => {
    if (state.mode !== 'edit') return state
    const regions = state.regions.map((item) => {
      if (item.id !== id) return { ...item, hexes: [...item.hexes] }
      const next = { ...item, ...patch, id, hexes: patch.hexes ? [...patch.hexes] : [...item.hexes] }
      return next
    })
    const territory = rebuildTerritory(cloneLocations(state.locations), regions)
    return pushHistory(state, { ...cloneSnapshot(currentSnapshot(state)), ...territory })
  }),

  addRegion: () => set((state) => {
    if (state.mode !== 'edit') return state
    const id = makeRegionId('new-region', state.regions.map((region) => region.id))
    const region = emptyRegion(id)
    return pushHistory(state, {
      ...cloneSnapshot(currentSnapshot(state)),
      regions: [...state.regions.map((item) => ({ ...item, hexes: [...item.hexes] })), region],
    })
  }),

  removeRegion: (id) => set((state) => {
    if (state.mode !== 'edit') return state
    const occupied = state.locations.filter((location) => location.regionId === id)
    if (occupied.length) return state
    const regions = state.regions.filter((region) => region.id !== id).map((region) => ({ ...region, hexes: [...region.hexes] }))
    const territory = rebuildTerritory(cloneLocations(state.locations), regions)
    return pushHistory(state, { ...cloneSnapshot(currentSnapshot(state)), ...territory })
  }),

  setRegionHexes: (id, hexes, mode = 'replace') => set((state) => {
    if (state.mode !== 'edit') return state
    const unique = [...new Set(hexes)]
    let regions = state.regions.map((region) => ({ ...region, hexes: [...region.hexes] }))
    if (mode === 'replace') {
      regions = regions.map((region) => {
        if (region.id === id) return { ...region, hexes: unique.sort() }
        return { ...region, hexes: region.hexes.filter((hex) => !unique.includes(hex)) }
      })
    } else if (mode === 'add') {
      regions = regions.map((region) => {
        if (region.id === id) return { ...region, hexes: [...new Set([...region.hexes, ...unique])].sort() }
        return { ...region, hexes: region.hexes.filter((hex) => !unique.includes(hex)) }
      })
    } else {
      const remove = new Set(unique)
      regions = regions.map((region) => region.id === id ? { ...region, hexes: region.hexes.filter((hex) => !remove.has(hex)) } : region)
    }
    const territory = rebuildTerritory(cloneLocations(state.locations), regions)
    return pushHistory(state, { ...cloneSnapshot(currentSnapshot(state)), ...territory })
  }),

  paintRegionHexes: (id, hexes) => set((state) => {
    if (state.mode !== 'edit' || !hexes.length) return state
    const unique = [...new Set(hexes)]
    const regions = state.regions.map((region) => {
      if (region.id === id) return { ...region, hexes: [...new Set([...region.hexes, ...unique])].sort() }
      return { ...region, hexes: region.hexes.filter((hex) => !unique.includes(hex)) }
    })
    const territory = rebuildTerritory(cloneLocations(state.locations), regions)
    return pushHistory(state, { ...cloneSnapshot(currentSnapshot(state)), ...territory })
  }),

  advancePhase: () => set((state) => {
    if (state.mode !== 'game' || !state.campaign.playerFactionId) return state
    const campaign = cloneCampaign(state.campaign)
    let armies = cloneArmies(state.armies)
    let heroes = state.heroes.map((hero) => ({ ...hero }))
    let locations = cloneLocations(state.locations)
    let regions = state.regions.map((region) => ({ ...region, hexes: [...(region.hexes ?? [])] }))
    let battles = cloneBattles(state.battles)
    const refreshIntel = () => refreshFogIntel(campaign, armies, locations, state.factions, state.grid, regions)

    const runSideAiPlanning = (side: StrategicSide) => {
      if (!campaign.aiEnabled) return
      armies = runAiPlanning(side, campaign, armies, locations, state.factions, state.unitTypes, heroes, state.captains, state.grid, campaign.playerFactionId)
      campaign.log.unshift(campaignEvent(campaign, `ИИ завершил планирование остальных фракций стороны «${side === 'good' ? 'Свет' : 'Тьма'}».`, 'system', null))
    }
    const runSideAiMovement = (side: StrategicSide) => {
      if (!campaign.aiEnabled) return
      const sidePlans = side === campaign.playerSide ? campaign.alliedPlans : []
      armies = runAiMovement(side, campaign, armies, locations, state.factions, state.grid, regions, campaign.playerFactionId, heroes, sidePlans)
      if (side === campaign.playerSide) campaign.alliedPlans = []
      campaign.log.unshift(campaignEvent(campaign, `ИИ завершил движение остальных фракций стороны «${side === 'good' ? 'Свет' : 'Тьма'}».`, 'move', null))
    }
    const finishMovement = () => {
      const entered = enterConflictPhase({ ...state, armies, locations, regions, heroes, battles } as MapState, campaign, armies, locations, regions, heroes, battles)
      armies = entered.armies
      locations = entered.locations
      regions = entered.regions
      heroes = entered.heroes
      battles = entered.battles
    }
    const beginRoundPlanning = () => {
      campaign.phase = 'planning_good'
      let prepared = preparePlanningSide({ ...state, locations, regions, armies, heroes, campaign } as MapState, campaign, armies, heroes, 'good')
      armies = prepared.armies
      heroes = prepared.heroes
      if (campaign.playerSide === 'evil') runSideAiPlanning('good')
      if (campaign.playerSide === 'evil') {
        campaign.phase = 'planning_evil'
        prepared = preparePlanningSide({ ...state, locations, regions, armies, heroes, campaign } as MapState, campaign, armies, heroes, 'evil')
        armies = prepared.armies
        heroes = prepared.heroes
      }
      campaign.activeFactionId = campaign.playerFactionId!
      campaign.turnMovements = []
      campaign.alliedPlans = campaign.aiEnabled ? planAlliedMovement(campaign.playerSide, campaign, armies, locations, state.factions, state.grid, regions, campaign.playerFactionId) : []
    }
    const executePlayerOrders=()=>{
      const grid=resolveGrid(state.grid,locations,regions)
      for(const order of campaign.pendingOrders){const army=armies.find((item)=>item.id===order.armyId&&item.factionId===campaign.playerFactionId);if(!army||!army.commander||army.engaged)continue
        const originHexId=army.hexId
        const interception=order.path.findIndex((hex,index)=>index>0&&armies.some((enemy)=>enemy.hexId===hex&&areFactionsHostile(state.factions,enemy.factionId,army.factionId)));const path=interception>0?order.path.slice(0,interception+1):order.path;const destination=path.at(-1)!;const cost=pathMovementCost(path,grid.byId,army.factionId);if(cost>army.movementRemaining)continue
        const enemies=armies.filter((enemy)=>enemy.hexId===destination&&areFactionsHostile(state.factions,enemy.factionId,army.factionId));const target=locations.find((location)=>location.hex===destination)??(order.locationId?locations.find((location)=>location.id===order.locationId)??null:null);const hostile=Boolean(target&&areFactionsHostile(state.factions,target.side,army.factionId));const committed=enemies.length>0||hostile;if(committed&&!army.canInitiateBattle)continue
        army.hexId=destination;army.movementRemaining=committed?0:Math.max(0,army.movementRemaining-cost);army.status=army.movementRemaining>0?'ready':'marched';army.engaged=committed;army.movedRound=campaign.round;army.movedInPhase='movement_first'
        campaign.turnMovements.push({id:`log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`,round:campaign.round,factionId:army.factionId,armyName:army.name,commanderName:armyCommanderName(army,heroes),action:committed?'besieged':'moved',targetLabel:target?.name??movementTargetLabel(destination,locations,regions,grid),distance:path.length-1,armyId:army.id,originHexId,destinationHexId:destination})
        if(committed){for(const enemy of enemies)enemy.engaged=true;campaign.log.unshift(campaignEvent(campaign,`${army.name} входит в зону боя и связывает противника.`,'move',army.factionId))}else if(target?.side==='civilian'){captureLocation(locations,regions,campaign,target.id,army.factionId);campaign.log.unshift(campaignEvent(campaign,`${army.name} занимает нейтральную локацию «${target.name}».`,'capture',army.factionId))}else campaign.log.unshift(campaignEvent(campaign,`${army.name} перемещается на ${cost} ОД.`,'move',army.factionId))
      }
      campaign.pendingOrders=[]
    }
    const finishPlayerTurn = () => {
      executePlayerOrders()
      if(campaign.phase==='planning_good'){ 
        runSideAiPlanning('good')
        campaign.phase='planning_evil'
        const prepared=preparePlanningSide({...state,locations,regions,armies,heroes,campaign}as MapState,campaign,armies,heroes,'evil')
        armies=prepared.armies;heroes=prepared.heroes
        runSideAiPlanning('evil')
      }else if(campaign.phase==='planning_evil')runSideAiPlanning('evil')
      const first=campaign.firstMoverThisRound
      const second=oppositeSide(first)
      campaign.phase='movement_first'
      campaign.log.unshift(campaignEvent(campaign,`Выполняются приказы движения стороны «${first==='good'?'Свет':'Тьма'}».`,'move',null))
      runSideAiMovement(first)
      campaign.phase='movement_second'
      campaign.log.unshift(campaignEvent(campaign,`Выполняются приказы движения стороны «${second==='good'?'Свет':'Тьма'}».`,'move',null))
      runSideAiMovement(second)
      finishMovement()
    }

    if (campaign.phase === 'planning_good' || campaign.phase === 'planning_evil') {
      finishPlayerTurn()
      refreshIntel(); return gameCommit(state, { campaign, armies, heroes, locations, regions, battles })
    }
    if (campaign.phase === 'movement_first') {
      executePlayerOrders()
      const second = oppositeSide(campaign.firstMoverThisRound)
      campaign.phase = 'movement_second'
      campaign.log.unshift(campaignEvent(campaign, `Начинается движение стороны «${second === 'good' ? 'Свет' : 'Тьма'}».`, 'system', null))
      runSideAiMovement(second)
      finishMovement()
      refreshIntel(); return gameCommit(state, { campaign, armies, heroes, locations, regions, battles })
    }
    if (campaign.phase === 'movement_second') {
      executePlayerOrders()
      finishMovement()
      refreshIntel(); return gameCommit(state, { campaign, armies, heroes, locations, regions, battles })
    }
    if (campaign.phase === 'conflicts') {
      if (campaign.conflicts.some((conflict) => conflict.status === 'pending')) return state
      const aftermath = processAftermath(state, campaign, armies, locations, regions, heroes, battles)
      armies = aftermath.armies; locations = aftermath.locations; regions = aftermath.regions; heroes = aftermath.heroes; battles = aftermath.battles
      refreshIntel(); return gameCommit(state, { campaign, armies, locations, regions, heroes, battles })
    }

    campaign.round += 1
    campaign.firstMoverThisRound = oppositeSide(campaign.firstMoverThisRound)
    campaign.pendingOrders=[]
    campaign.conflicts = []
    campaign.currentConflictId = null
    beginRoundPlanning()
    campaign.log.unshift(campaignEvent(campaign, `Начинается раунд ${campaign.round}. Первой в движении будет сторона «${campaign.firstMoverThisRound === 'good' ? 'Свет' : 'Тьма'}».`, 'turn', null))
    refreshIntel(); return gameCommit(state, { campaign, armies, heroes, locations, regions, battles })
  }),

  moveArmy: (armyId,destinationId,path,cost,_terrain,locationId)=>set((state)=>{
    const army=state.armies.find((item)=>item.id===armyId)
    if(!army||!canPlayerMoveArmy(state.campaign,state.factions,army.factionId)||!army.commander||army.engaged||cost>army.movementRemaining||path.length<2)return state
    const campaign=cloneCampaign(state.campaign);const order={armyId,destinationHexId:destinationId,path:[...path],cost,locationId};const index=campaign.pendingOrders.findIndex((item)=>item.armyId===armyId);if(index>=0)campaign.pendingOrders[index]=order;else campaign.pendingOrders.push(order)
    return gameCommit(state,{campaign})
  }),
  cancelArmyOrder:(armyId)=>set((state)=>{if(!state.campaign.pendingOrders.some((order)=>order.armyId===armyId))return state;const campaign=cloneCampaign(state.campaign);campaign.pendingOrders=campaign.pendingOrders.filter((order)=>order.armyId!==armyId);return gameCommit(state,{campaign})}),

  retreatEngagedArmy: (armyId) => set((state) => {
    const source = state.armies.find((army) => army.id === armyId)
    if (!source || !source.engaged || !canPlayerMoveArmy(state.campaign, state.factions, source.factionId)) return state
    let armies = cloneArmies(state.armies)
    const army = armies.find((candidate) => candidate.id === armyId)!
    const origin = army.hexId
    const unsafeLocation = state.locations.find((location) => location.side === army.factionId && locationHexId(location, state.grid.config) === origin)?.id ?? null
    const destination = chooseRetreatLocation(state, army, origin, unsafeLocation)
    if (!destination) return state
    const removed = removeWeakestRetreatUnits(army, 1 + retreatAdditionalLosses(destination.distance), state.unitTypes)
    army.hexId = destination.hexId
    army.movementRemaining = 0
    army.status = 'retreating'
    army.engaged = false
    army.exhaustedUntilRound = state.campaign.round + 1
    army.movedRound = state.campaign.round
    army.movedInPhase = state.campaign.phase === 'movement_second' ? 'movement_second' : 'movement_first'
    for (const candidate of armies.filter((item) => item.hexId === origin)) candidate.engaged = armies.some((enemy) => enemy.hexId === origin && areFactionsHostile(state.factions, enemy.factionId, candidate.factionId))
    const campaign = cloneCampaign(state.campaign)
    const destinationName = state.locations.find((location) => location.id === destination.locationId)?.name ?? 'свою локацию'
    campaign.turnMovements.push({ id: `log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, round: campaign.round, factionId: army.factionId, armyName: army.name, commanderName: armyCommanderName(army, state.heroes), action: 'retreated', targetLabel: destinationName === 'свою локацию' ? null : destinationName, distance: destination.distance })
    if (army.unitSlots.length === 0 && army.heroSlots.length === 0 && army.commander?.kind !== 'hero') {
      armies = armies.filter((candidate) => candidate.id !== army.id)
      campaign.log.unshift(campaignEvent(campaign, `${army.name} рассеяно при отходе в «${destinationName}»: боевых отрядов не осталось.`, 'army_destroyed', army.factionId))
    } else campaign.log.unshift(campaignEvent(campaign, `${army.name} отходит в «${destinationName}» на ${destination.distance} гекс${destination.distance === 1 ? '' : destination.distance < 5 ? 'а' : 'ов'}${removed.length ? ` и теряет: ${removed.join(', ')}` : ''}. Армия деморализована.`, 'retreat', army.factionId))
    refreshFogIntel(campaign, armies, state.locations, state.factions, state.grid, state.regions)
    return gameCommit(state, { armies, campaign })
  }),

  selectConflict: (conflictId) => set((state) => state.campaign.conflicts.some((conflict) => conflict.id === conflictId) ? { campaign: { ...cloneCampaign(state.campaign), currentConflictId: conflictId } } : state),

  setReinforcementParticipation: (conflictId, armyId, participate) => set((state) => {
    if (state.campaign.phase !== 'conflicts') return state
    const campaign = cloneCampaign(state.campaign)
    const conflict = campaign.conflicts.find((candidate) => candidate.id === conflictId && candidate.status === 'pending')
    const option = conflict?.optionalPlayerReinforcements.find((candidate) => candidate.armyId === armyId)
    const army = state.armies.find((candidate) => candidate.id === armyId)
    if (!conflict || !option || !army || army.factionId !== campaign.playerFactionId) return state
    const reinforcementIds = option.side === conflict.attackerSide ? conflict.attackerReinforcementArmyIds : conflict.defenderReinforcementArmyIds
    const distantIds = option.side === conflict.attackerSide ? conflict.attackerDistantReinforcementArmyIds : conflict.defenderDistantReinforcementArmyIds
    if (participate) {
      if (!reinforcementIds.includes(armyId)) reinforcementIds.push(armyId)
      if (option.tier === 'distant' && !distantIds.includes(armyId)) distantIds.push(armyId)
    } else {
      const reinforcementIndex = reinforcementIds.indexOf(armyId); if (reinforcementIndex >= 0) reinforcementIds.splice(reinforcementIndex, 1)
      const distantIndex = distantIds.indexOf(armyId); if (distantIndex >= 0) distantIds.splice(distantIndex, 1)
    }
    updateConflictRtsCompatibility(conflict, state.armies, state.locations)
    return gameCommit(state, { campaign })
  }),

  resolveConflict: (conflictId) => set((state) => {
    const source = state.campaign.conflicts.find((conflict) => conflict.id === conflictId)
    if (state.campaign.phase !== 'conflicts' || !source || source.status !== 'pending' || !conflictInvolvesPlayer(source, state.campaign, state.armies, state.locations)) return state
    const campaign = cloneCampaign(state.campaign)
    const resolved = resolveConflictBattle(state, campaign, conflictId, state.armies, state.battles)
    if (!resolved.report) return state
    const pending = campaign.conflicts.find((candidate) => candidate.status === 'pending')
    campaign.currentConflictId = pending?.id ?? null
    if (!pending) {
      const aftermath = processAftermath({ ...state, armies: resolved.armies, battles: resolved.battles, campaign } as MapState, campaign, resolved.armies, state.locations, state.regions, state.heroes, resolved.battles)
      refreshFogIntel(campaign, aftermath.armies, aftermath.locations, state.factions, state.grid, aftermath.regions)
      return { ...gameCommit(state, { campaign, ...aftermath }), latestBattleId: resolved.report.id }
    }
    refreshFogIntel(campaign, resolved.armies, state.locations, state.factions, state.grid, state.regions)
    return { ...gameCommit(state, { armies: resolved.armies, campaign, battles: resolved.battles }), latestBattleId: resolved.report.id }
  }),

  retreatConflictDefender: (conflictId) => set((state) => {
    if (state.campaign.phase !== 'conflicts' || !state.campaign.playerFactionId) return state
    const campaign = cloneCampaign(state.campaign)
    const conflict = campaign.conflicts.find((candidate) => candidate.id === conflictId)
    if (!conflict || conflict.status !== 'pending' || !conflict.defenderArmyIds.length) return state
    const playerDefendsWithArmy = conflict.defenderArmyIds.some((id) => state.armies.find((army) => army.id === id)?.factionId === campaign.playerFactionId)
    const playerDefendsLocation = Boolean(conflict.locationId && state.locations.find((location) => location.id === conflict.locationId)?.side === campaign.playerFactionId)
    if (!playerDefendsWithArmy && !playerDefendsLocation) return state
    conflict.status = 'resolved'
    conflict.resolution = 'defender_retreat'
    conflict.winnerSide = conflict.attackerSide
    const attackerFactions = new Set([...conflict.attackerArmyIds, ...conflict.attackerReinforcementArmyIds].map((id) => state.armies.find((army) => army.id === id)?.factionId).filter(Boolean) as string[])
    const defenderFactions = new Set([...conflict.defenderArmyIds, ...conflict.defenderReinforcementArmyIds].map((id) => state.armies.find((army) => army.id === id)?.factionId).filter(Boolean) as string[])
    if (conflict.garrisonLocationId) {
      const owner = state.locations.find((location) => location.id === conflict.garrisonLocationId)?.side
      if (owner) defenderFactions.add(owner)
    }
    for (const factionId of attackerFactions) factionCampaignState(campaign, factionId).statistics.battlesWon += 1
    for (const factionId of defenderFactions) factionCampaignState(campaign, factionId).statistics.battlesLost += 1
    const pending = campaign.conflicts.find((candidate) => candidate.status === 'pending')
    campaign.currentConflictId = pending?.id ?? null
    const location = conflict.locationId ? state.locations.find((candidate) => candidate.id === conflict.locationId) : null
    campaign.log.unshift(campaignEvent(campaign, `Защитники ${location ? `локации «${location.name}»` : 'поля боя'} отступают без сражения.`, 'retreat', campaign.playerFactionId))
    if (!pending) {
      const aftermath = processAftermath(state, campaign, state.armies, state.locations, state.regions, state.heroes, state.battles)
      refreshFogIntel(campaign, aftermath.armies, aftermath.locations, state.factions, state.grid, aftermath.regions)
      return gameCommit(state, { campaign, ...aftermath })
    }
    refreshFogIntel(campaign, state.armies, state.locations, state.factions, state.grid, state.regions)
    return gameCommit(state, { campaign })
  }),

  resolveConflictRts: (conflictId, winnerSide, detail) => set((state) => {
    // RTS-бой: победитель известен из BFME, но все последствия (потери, судьбы
    // героев, отходы, захват локации) считает глобальная карта — как в автобое.
    const source = state.campaign.conflicts.find((candidate) => candidate.id === conflictId)
    if (state.campaign.phase !== 'conflicts' || !source || source.status !== 'pending' || (winnerSide !== 'good' && winnerSide !== 'evil')) return state
    if (!conflictInvolvesPlayer(source, state.campaign, state.armies, state.locations)) return state
    const campaign = cloneCampaign(state.campaign)
    const resolved = resolveConflictBattle(state, campaign, conflictId, state.armies, state.battles, winnerSide, 'rts_battle')
    if (!resolved.report) return state
    const pending = campaign.conflicts.find((candidate) => candidate.status === 'pending')
    campaign.currentConflictId = pending?.id ?? null
    if (detail) campaign.log.unshift(campaignEvent(campaign, `Исход BFME-сражения: победа стороны «${winnerSide === 'good' ? 'Свет' : 'Тьма'}» (${detail}).`, 'battle', null))
    if (!pending) {
      const aftermath = processAftermath({ ...state, armies: resolved.armies, battles: resolved.battles, campaign } as MapState, campaign, resolved.armies, state.locations, state.regions, state.heroes, resolved.battles)
      refreshFogIntel(campaign, aftermath.armies, aftermath.locations, state.factions, state.grid, aftermath.regions)
      return { ...gameCommit(state, { campaign, ...aftermath }), latestBattleId: resolved.report.id }
    }
    refreshFogIntel(campaign, resolved.armies, state.locations, state.factions, state.grid, state.regions)
    return { ...gameCommit(state, { armies: resolved.armies, campaign, battles: resolved.battles }), latestBattleId: resolved.report.id }
  }),

  summonHero: (locationId, heroId) => set((state) => {
    if (state.mode !== 'game' || !state.campaign.phase.startsWith('planning_')) return state
    const location = state.locations.find((candidate) => candidate.id === locationId)
    const hero = state.heroes.find((candidate) => candidate.id === heroId)
    const heroState = state.campaign.heroStates[heroId]
    if (!location || !hero || !heroState || (state.campaign.locationStates[location.id]?.occupationTurnsLeft ?? 0) > 0 || !canFactionPlan(state.campaign, state.factions, location.side) || hero.factionId !== location.side || heroState.status !== 'available' || heroState.summoned || heroState.summonLocationId !== location.id || !heroUnlockSatisfied(hero, state.campaign, state.locations)) return state
    const treasury = state.campaign.treasuries[hero.factionId]
    if (!treasury || treasury.gold < hero.summonCostGold || heroIsDeployed(hero.id, state.armies, state.campaign.locationStates)) return state
    const campaign = cloneCampaign(state.campaign)
    campaign.treasuries[hero.factionId].gold -= hero.summonCostGold
    for (const locationState of Object.values(campaign.locationStates)) locationState.reserve = locationState.reserve.filter((slot) => slot.kind !== 'hero' || slot.entityId !== hero.id)
    const locationState = campaign.locationStates[location.id] ?? { locationId: location.id, recruitmentQueue: [], reserve: [], occupationTurnsLeft: 0 }
    locationState.reserve.push({ slotId: `summoned-${hero.id}-${campaign.round}`, kind: 'hero', entityId: hero.id, objectId: hero.objectId })
    campaign.locationStates[location.id] = locationState
    campaign.heroStates[hero.id] = { ...campaign.heroStates[hero.id], status: 'active', summoned: true, summonLocationId: location.id, recoveryLocationId: null, healTurnsLeft: 0 }
    campaign.log.unshift(campaignEvent(campaign, `${hero.name} призван в «${location.name}» за ${hero.summonCostGold} золота.`, 'hero', hero.factionId))
    return gameCommit(state, { campaign })
  }),

  queueRecruitment: (locationId, unitId) => set((state) => {
    if (state.mode !== 'game' || !state.campaign.phase.startsWith('planning_')) return state
    const location = state.locations.find((item) => item.id === locationId)
    const unit = state.unitTypes.find((item) => item.id === unitId)
    const locationStateNow = location ? state.campaign.locationStates[location.id] : null
    if (!location || !unit || !canFactionPlan(state.campaign, state.factions, location.side) || !recruitableUnitsAtLocation(location, locationStateNow, state.unitTypes).some((candidate) => candidate.id === unitId)) return state
    const campaign = cloneCampaign(state.campaign)
    const locationState = campaign.locationStates[locationId] ?? { locationId, recruitmentQueue: [], reserve: [], occupationTurnsLeft: 0 }
    if (locationState.recruitmentQueue.length >= location.recruitmentSlots) return state
    const treasury = campaign.treasuries[location.side]
    if (!treasury || treasury.gold < unit.recruitCost.gold || treasury.materials < unit.recruitCost.materials) return state
    treasury.gold -= unit.recruitCost.gold
    treasury.materials -= unit.recruitCost.materials
    locationState.recruitmentQueue.push({ id: `recruit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, entityId: unit.id, turnsLeft: unit.recruitTime })
    campaign.locationStates[locationId] = locationState
    campaign.log.unshift(logEntry(state, `В «${location.name}» начат найм: ${unit.name}.`, 'system', location.side))
    return gameCommit(state, { campaign })
  }),

  transformReserveUnit: (locationId, slotId, targetUnitId) => set((state) => {
    if (state.mode !== 'game' || !state.campaign.phase.startsWith('planning_')) return state
    const location = state.locations.find((item) => item.id === locationId)
    const locationState = state.campaign.locationStates[locationId]
    const sourceSlot = locationState?.reserve.find((slot) => slot.slotId === slotId && slot.kind === 'unit')
    const sourceUnit = sourceSlot ? state.unitTypes.find((unit) => unit.id === sourceSlot.entityId) : null
    const targetUnit = state.unitTypes.find((unit) => unit.id === targetUnitId)
    if (!location || !locationState || !sourceSlot || !sourceUnit || !targetUnit || !canFactionPlan(state.campaign, state.factions, location.side) || sourceUnit.factionId !== location.side || targetUnit.factionId !== location.side || targetUnit.transformationSourceUnitId !== sourceUnit.id) return state
    const treasury = state.campaign.treasuries[location.side]
    if (!treasury || treasury.gold < targetUnit.recruitCost.gold || treasury.materials < targetUnit.recruitCost.materials) return state
    const campaign = cloneCampaign(state.campaign)
    campaign.treasuries[location.side].gold -= targetUnit.recruitCost.gold
    campaign.treasuries[location.side].materials -= targetUnit.recruitCost.materials
    const transformed = campaign.locationStates[locationId].reserve.find((slot) => slot.slotId === slotId)!
    transformed.entityId = targetUnit.id
    transformed.objectId = targetUnit.objectId
    campaign.log.unshift(campaignEvent(campaign, `В «${location.name}» ${sourceUnit.name} преобразован в «${targetUnit.name}»${targetUnit.recruitCost.gold || targetUnit.recruitCost.materials ? ` за ${targetUnit.recruitCost.gold} золота и ${targetUnit.recruitCost.materials} материалов` : ''}.`, 'system', location.side))
    return gameCommit(state, { campaign })
  }),

  transferReserveToArmy: (locationId, armyId, slotId) => set((state) => {
    if (state.mode !== 'game' || !state.campaign.phase.startsWith('planning_')) return state
    const location = state.locations.find((item) => item.id === locationId)
    const army = state.armies.find((item) => item.id === armyId)
    const locationState = state.campaign.locationStates[locationId]
    const slot = locationState?.reserve.find((item) => item.slotId === slotId)
    if (!location || !army || !slot || !canFactionPlan(state.campaign, state.factions, location.side) || army.factionId !== location.side || army.hexId !== locationHexId(location, state.grid.config)) return state
    if (slot.kind === 'unit') { const unit = state.unitTypes.find((candidate) => candidate.id === slot.entityId); if (!unit || armyCommandPoints(army, state.unitTypes, state.heroes) + (unit.commandPoints ?? 0) > armyCommandPointLimit(army, state.heroes, state.captains)) return state }
    if (slot.kind === 'hero' && state.campaign.heroStates[slot.entityId]?.status !== 'active') return state
    if (slot.kind === 'hero' && army.commander?.kind !== 'captain' && army.heroSlots.length >= army.heroSlotLimit) return state
    const campaign = cloneCampaign(state.campaign)
    campaign.locationStates[locationId].reserve = campaign.locationStates[locationId].reserve.filter((item) => item.slotId !== slotId)
    const armies = cloneArmies(state.armies)
    const changed = armies.find((item) => item.id === armyId)!
    if (slot.kind === 'hero' && changed.commander?.kind === 'captain') {
      const released = releaseCaptain(campaign, changed.factionId, changed.commander)
      changed.commander = { kind: 'hero', entityId: slot.entityId, objectId: slot.objectId }
      const hero = state.heroes.find((candidate) => candidate.id === slot.entityId)
      campaign.log.unshift(campaignEvent(campaign, `${hero?.name ?? 'Герой'} принял командование. Капитан ${released?.displayName ?? 'Безымянный'} освобождён.`, 'system', changed.factionId))
    } else if (slot.kind === 'hero') changed.heroSlots.push({ ...slot })
    else changed.unitSlots.push({ ...slot })
    changed.name = generateArmyName(changed, armies, state.factions, state.locations, state.heroes, state.grid.config)
    changed.movementRemaining = changed.exhaustedUntilRound !== null && changed.exhaustedUntilRound >= state.campaign.round ? 0 : armyMovementCap(changed, state.heroes, state.captains, state.unitTypes)
    return gameCommit(state, { campaign, armies })
  }),

  transferArmyToReserve: (locationId, armyId, slotId) => set((state) => {
    if (state.mode !== 'game' || !state.campaign.phase.startsWith('planning_')) return state
    const location = state.locations.find((item) => item.id === locationId)
    const army = state.armies.find((item) => item.id === armyId)
    const locationState = state.campaign.locationStates[locationId]
    const slot = army?.unitSlots.find((item) => item.slotId === slotId) ?? army?.heroSlots.find((item) => item.slotId === slotId)
    if (!location || !army || !slot || !locationState || !canFactionPlan(state.campaign, state.factions, location.side) || army.factionId !== location.side || army.hexId !== locationHexId(location, state.grid.config) || reserveCommandPoints(locationState.reserve, state.unitTypes, state.heroes) + (slot.kind === 'unit' ? (state.unitTypes.find((unit) => unit.id === slot.entityId)?.commandPoints ?? 0) : (state.heroes.find((hero) => hero.id === slot.entityId)?.commandPoints ?? 0)) > location.commandPointLimit) return state
    if (slot.kind === 'unit' && army.unitSlots.length <= 1) return state
    const campaign = cloneCampaign(state.campaign)
    campaign.locationStates[locationId].reserve.push({ ...slot })
    const armies = cloneArmies(state.armies).map((item) => item.id === armyId ? { ...item, unitSlots: item.unitSlots.filter((candidate) => candidate.slotId !== slotId), heroSlots: item.heroSlots.filter((candidate) => candidate.slotId !== slotId) } : item)
    const changed = armies.find((item) => item.id === armyId)!
    changed.movementRemaining = changed.exhaustedUntilRound !== null && changed.exhaustedUntilRound >= state.campaign.round ? 0 : armyMovementCap(changed, state.heroes, state.captains, state.unitTypes)
    return gameCommit(state, { campaign, armies })
  }),

  formArmy: (locationId, commanderChoice) => set((state) => {
    if (state.mode !== 'game' || !state.campaign.phase.startsWith('planning_')) return state
    const location = state.locations.find((item) => item.id === locationId)
    const locationState = state.campaign.locationStates[locationId]
    const faction = location ? state.factions.find((item) => item.id === location.side) : null
    if (!location || !locationState || !faction || !canFactionPlan(state.campaign, state.factions, location.side) || !locationState.reserve.some((slot) => slot.kind === 'unit') || state.armies.filter((army) => army.factionId === faction.id).length >= factionArmyLimit(faction, state.locations)) return state
    const separator = commanderChoice.indexOf(':')
    const kind = separator >= 0 ? commanderChoice.slice(0, separator) : commanderChoice
    const value = separator >= 0 ? commanderChoice.slice(separator + 1) : ''
    let commander = null as Army['commander']
    const campaign = cloneCampaign(state.campaign)
    const hasAvailableHero = campaign.locationStates[locationId].reserve.some((slot) => slot.kind === 'hero' && state.heroes.some((hero) => hero.id === slot.entityId && hero.alive && campaign.heroStates[hero.id]?.status === 'active'))
    if (kind === 'hero') {
      const slot = campaign.locationStates[locationId].reserve.find((item) => item.slotId === value && item.kind === 'hero')
      const hero = slot ? state.heroes.find((item) => item.id === slot.entityId && item.alive && campaign.heroStates[item.id]?.status === 'active') : null
      if (!slot || !hero) return state
      commander = createHeroCommander(hero)
      campaign.locationStates[locationId].reserve = campaign.locationStates[locationId].reserve.filter((item) => item.slotId !== slot.slotId)
    } else if (kind === 'free-captain') {
      if (hasAvailableHero) return state
      const pool = campaign.freeCaptains[faction.id] ?? []
      const instance = pool.find((captain) => captain.instanceId === value)
      const captain = instance ? state.captains.find((candidate) => candidate.id === instance.captainTypeId && candidate.factionId === faction.id) : null
      if (!instance || !captain) return state
      campaign.freeCaptains[faction.id] = pool.filter((captain) => captain.instanceId !== instance.instanceId)
      commander = createCaptainCommander(captain, instance.displayName, instance.instanceId)
    } else if (kind === 'new-captain' || kind === 'captain') {
      if (hasAvailableHero || campaign.locationStates[locationId].occupationTurnsLeft > 0 || !getEconomicType(location.economicType).allowsCaptainHire) return state
      const captain = state.captains.find((item) => item.id === value && item.factionId === faction.id)
      const captainLimit = factionCaptainLimit(faction.id, state.locations)
      const captainCount = factionCaptainCount(faction.id, state.armies, campaign.freeCaptains)
      const treasury = campaign.treasuries[faction.id]
      if (!captain || !treasury || treasury.gold < 100 || captainCount >= captainLimit) return state
      treasury.gold -= 100
      commander = createCaptainCommander(captain, uniqueCaptainNameForState(state, faction.id, captain))
    } else return state
    const firstUnit = campaign.locationStates[locationId].reserve.find((slot) => slot.kind === 'unit')!
    campaign.locationStates[locationId].reserve = campaign.locationStates[locationId].reserve.filter((slot) => slot.slotId !== firstUnit.slotId)
    const id = makeId(`army-${faction.id}`, state.armies.map((army) => army.id))
    const army: Army = { id, name: '', factionId: faction.id, hexId: locationHexId(location, state.grid.config), movementRemaining: 0, baseUnitSlotLimit: 15, heroSlotLimit: 2, commander, unitSlots: [{ ...firstUnit }], heroSlots: [], status: 'ready', canInitiateBattle: true, engaged: false, movedRound: null, movedInPhase: null, exhaustedUntilRound: null }
    army.name = generateArmyName(army, state.armies, state.factions, state.locations, state.heroes, state.grid.config)
    return { ...gameCommit(state, { campaign, armies: [...cloneArmies(state.armies), army] }), selectedArmyId: id }
  }),

  disbandArmy: (locationId, armyId) => set((state) => {
    if (state.mode !== 'game' || !state.campaign.phase.startsWith('planning_')) return state
    const location = state.locations.find((item) => item.id === locationId)
    const army = state.armies.find((item) => item.id === armyId)
    const locationState = state.campaign.locationStates[locationId]
    if (!location || !army || !locationState || !canFactionPlan(state.campaign, state.factions, location.side) || army.factionId !== location.side || army.hexId !== locationHexId(location, state.grid.config)) return state
    const additions = [...army.unitSlots, ...army.heroSlots]
    if (army.commander?.kind === 'hero') additions.push({ slotId: `reserve-hero-${army.commander.entityId}-${Date.now().toString(36)}`, kind: 'hero', entityId: army.commander.entityId, objectId: army.commander.objectId! })
    const campaign = cloneCampaign(state.campaign)
    if (army.commander?.kind === 'captain') releaseCaptain(campaign, army.factionId, army.commander)
    campaign.pendingOrders=campaign.pendingOrders.filter((order)=>order.armyId!==armyId)
    campaign.alliedPlans=campaign.alliedPlans.filter((plan)=>plan.armyId!==armyId)
    const free = Math.max(0, location.commandPointLimit - reserveCommandPoints(campaign.locationStates[locationId].reserve, state.unitTypes, state.heroes))
    campaign.locationStates[locationId].reserve.push(...additions.slice(0, free).map((slot) => ({ ...slot })))
    return { ...gameCommit(state, { campaign, armies: state.armies.filter((item) => item.id !== armyId) }), selectedArmyId: state.selectedArmyId === armyId ? null : state.selectedArmyId }
  }),

  cancelRecruitment: (locationId, queueId) => set((state) => {
    if (state.mode !== 'game' || !state.campaign.phase.startsWith('planning_')) return state
    const location = state.locations.find((item) => item.id === locationId)
    if (!location || !canFactionPlan(state.campaign, state.factions, location.side)) return state
    const campaign = cloneCampaign(state.campaign)
    const locationState = campaign.locationStates[locationId]
    const item = locationState?.recruitmentQueue.find((candidate) => candidate.id === queueId)
    const unit = item ? state.unitTypes.find((candidate) => candidate.id === item.entityId) : null
    if (!locationState || !item || !unit) return state
    locationState.recruitmentQueue = locationState.recruitmentQueue.filter((candidate) => candidate.id !== queueId)
    const treasury = campaign.treasuries[location.side]
    if (treasury) { treasury.gold += unit.recruitCost.gold; treasury.materials += unit.recruitCost.materials }
    return gameCommit(state, { campaign })
  }),

  undo: () => set((state) => {
    if (state.mode !== 'edit' || !state.history.length) return state
    const previous = state.history[state.history.length - 1]
    const snap = cloneSnapshot(previous)
    setActiveEconomicTypes(snap.economicTypes)
    return { ...snap, history: state.history.slice(0, -1), future: [cloneSnapshot(currentSnapshot(state)), ...state.future].slice(0, HISTORY_LIMIT), revision: state.revision + 1 }
  }),
  redo: () => set((state) => {
    if (state.mode !== 'edit' || !state.future.length) return state
    const next = state.future[0]
    const snap = cloneSnapshot(next)
    setActiveEconomicTypes(snap.economicTypes)
    return { ...snap, history: [...state.history, cloneSnapshot(currentSnapshot(state))].slice(-HISTORY_LIMIT), future: state.future.slice(1), revision: state.revision + 1 }
  }),
}))
