import { areFactionsHostile } from '../constants'
import { armyCommandPointLimit, createCaptainCommander, createHeroCommander, factionArmyLimit, factionCaptainCount, factionCaptainLimit, generateArmyName, generateUniqueCaptainName } from './army'
import { factionIsActive, factionSide } from './campaign'
import { heroIsDeployed, heroUnlockSatisfied } from './heroes'
import { recruitableUnitsAtLocation } from './recruitment'
import { captainHireEconomicTypes } from './economicTypes'
import { cellMovementCost, findPath, hexDistance, locationHexId, neighborIds, resolveGrid } from '../hex/hexGrid'
import type { AlliedMovementPlan, Army, CampaignState, CaptainType, FactionDefinition, Hero, HexGridData, LogicalHex, MapLocation, Region, StrategicSide, UnitType } from '../types'

const aiId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

export function runAiPlanning(
  side: StrategicSide,
  campaign: CampaignState,
  armies: Army[],
  locations: MapLocation[],
  factions: FactionDefinition[],
  unitTypes: UnitType[],
  heroes: Hero[],
  captains: CaptainType[],
  grid: HexGridData,
  excludedFactionId: string | null = campaign.playerFactionId,
) {
  const nextArmies = armies.map((army) => ({ ...army, commander: army.commander ? { ...army.commander } : null, unitSlots: army.unitSlots.map((slot) => ({ ...slot })), heroSlots: army.heroSlots.map((slot) => ({ ...slot })) }))
  const sideFactions = factions.filter((faction) => faction.playable && faction.alignment === side && faction.id !== excludedFactionId && factionIsActive(campaign, faction.id))

  for (const faction of sideFactions) {
    const treasury = campaign.treasuries[faction.id]
    if (!treasury) continue
    const owned = locations.filter((location) => location.side === faction.id)
    const summonableHeroes = heroes.filter((hero) => hero.factionId === faction.id && campaign.heroStates[hero.id]?.status === 'available' && !campaign.heroStates[hero.id]?.summoned && heroUnlockSatisfied(hero, campaign, locations))
      .sort((left, right) => right.battlePower - left.battlePower || left.name.localeCompare(right.name, 'ru'))
    for (const hero of summonableHeroes) {
      const heroState = campaign.heroStates[hero.id]
      const summonLocation = owned.find((location) => location.id === heroState.summonLocationId)
      if (!summonLocation || (campaign.locationStates[summonLocation.id]?.occupationTurnsLeft ?? 0) > 0 || treasury.gold < hero.summonCostGold || heroIsDeployed(hero.id, nextArmies, campaign.locationStates)) continue
      treasury.gold -= hero.summonCostGold
      const locationState = campaign.locationStates[summonLocation.id] ?? { locationId: summonLocation.id, recruitmentQueue: [], reserve: [], occupationTurnsLeft: 0 }
      locationState.reserve.push({ slotId: `summoned-ai-${hero.id}-${campaign.round}`, kind: 'hero', entityId: hero.id, objectId: hero.objectId })
      campaign.locationStates[summonLocation.id] = locationState
      campaign.heroStates[hero.id] = { ...heroState, status: 'active', summoned: true, recoveryLocationId: null, healTurnsLeft: 0 }
      campaign.log.unshift({ id: `log-ai-hero-${hero.id}-${campaign.round}`, round: campaign.round, factionId: faction.id, phase: campaign.phase, kind: 'hero', text: `${hero.name} присоединился к фракции «${faction.label}» в «${summonLocation.name}».` })
    }

    for (const location of owned) {
      const locationState = campaign.locationStates[location.id]
      if (!locationState) continue
      const recruitable = recruitableUnitsAtLocation(location, locationState, unitTypes)
        .sort((left, right) => (right.recruitCost.gold + right.recruitCost.materials * 2) - (left.recruitCost.gold + left.recruitCost.materials * 2))
      while (locationState.recruitmentQueue.length < location.recruitmentSlots) {
        const unit = recruitable.find((candidate) => treasury.gold >= candidate.recruitCost.gold && treasury.materials >= candidate.recruitCost.materials)
        if (!unit) break
        treasury.gold -= unit.recruitCost.gold
        treasury.materials -= unit.recruitCost.materials
        locationState.recruitmentQueue.push({ id: aiId('recruit-ai'), entityId: unit.id, turnsLeft: unit.recruitTime })
      }

      for (const slot of locationState.reserve.filter((candidate) => candidate.kind === 'unit')) {
        const source = unitTypes.find((unit) => unit.id === slot.entityId)
        if (!source) continue
        const options = unitTypes
          .filter((unit) => unit.transformationSourceUnitId === source.id && unit.factionId === faction.id && treasury.gold >= unit.recruitCost.gold && treasury.materials >= unit.recruitCost.materials)
          .sort((left, right) => right.battlePower - left.battlePower || right.recruitCost.gold - left.recruitCost.gold)
        const target = options[0]
        if (!target) continue
        treasury.gold -= target.recruitCost.gold
        treasury.materials -= target.recruitCost.materials
        slot.entityId = target.id
        slot.objectId = target.objectId
      }

      const hexId = locationHexId(location, grid.config)
      const stationed = nextArmies.filter((army) => army.factionId === faction.id && army.hexId === hexId)
      for (const army of stationed) {
        while (true) {
          const currentPoints = army.unitSlots.reduce((total, slot) => total + (unitTypes.find((unit) => unit.id === slot.entityId)?.commandPoints ?? 0), 0)
          const slotIndex = locationState.reserve.findIndex((slot) => slot.kind === 'unit' && currentPoints + (unitTypes.find((unit) => unit.id === slot.entityId)?.commandPoints ?? 0) <= armyCommandPointLimit(army, heroes, captains))
          if (slotIndex < 0) break
          army.unitSlots.push({ ...locationState.reserve.splice(slotIndex, 1)[0] })
        }
        if (army.commander?.kind === 'captain') {
          const heroIndex = locationState.reserve.findIndex((slot) => slot.kind === 'hero' && heroes.some((hero) => hero.id === slot.entityId && hero.alive && campaign.heroStates[hero.id]?.status === 'active'))
          if (heroIndex >= 0) {
            const heroSlot = locationState.reserve.splice(heroIndex, 1)[0]
            const pool = campaign.freeCaptains[faction.id] ?? []
            pool.push({ instanceId: army.commander.instanceId ?? aiId(`captain-${faction.id}`), captainTypeId: army.commander.entityId, displayName: army.commander.displayName ?? 'Безымянный' })
            campaign.freeCaptains[faction.id] = pool
            army.commander = { kind: 'hero', entityId: heroSlot.entityId, objectId: heroSlot.objectId }
            army.name = generateArmyName(army, nextArmies, factions, locations, heroes, grid.config)
          }
        }
      }

      const reserveUnits = locationState.reserve.filter((slot) => slot.kind === 'unit')
      const armyLimitReached = nextArmies.filter((army) => army.factionId === faction.id).length >= factionArmyLimit(faction, locations)
      if (reserveUnits.length < 3 || stationed.length || armyLimitReached) continue
      const reserveHeroIndex = locationState.reserve.findIndex((slot) => slot.kind === 'hero' && heroes.some((hero) => hero.id === slot.entityId && hero.alive && campaign.heroStates[hero.id]?.status === 'active'))
      const reserveHero = reserveHeroIndex >= 0 ? heroes.find((hero) => hero.id === locationState.reserve[reserveHeroIndex].entityId && hero.alive && campaign.heroStates[hero.id]?.status === 'active') : null
      const freePool = campaign.freeCaptains[faction.id] ?? []
      const freeInstance = freePool.find((instance) => captains.some((candidate) => candidate.id === instance.captainTypeId && candidate.factionId === faction.id))
      const captain = freeInstance
        ? captains.find((candidate) => candidate.id === freeInstance.captainTypeId && candidate.factionId === faction.id)
        : captains.find((candidate) => candidate.factionId === faction.id)
      const captainLimit = factionCaptainLimit(faction.id, locations)
      const captainCount = factionCaptainCount(faction.id, nextArmies, campaign.freeCaptains)
      const canHireCaptain = Boolean(captain && treasury.gold >= 100 && captainCount < captainLimit && locationState.occupationTurnsLeft === 0 && captainHireEconomicTypes().has(location.economicType))
      if (!reserveHero && !freeInstance && !canHireCaptain) continue
      const commander = reserveHero
        ? createHeroCommander(reserveHero)
        : freeInstance && captain
          ? createCaptainCommander(captain, freeInstance.displayName, freeInstance.instanceId)
          : createCaptainCommander(captain!, generateUniqueCaptainName(faction.id, captain!.namePool, [
            ...nextArmies.filter((army) => army.factionId === faction.id && army.commander?.kind === 'captain').map((army) => army.commander!.displayName ?? ''),
            ...(campaign.freeCaptains[faction.id] ?? []).map((instance) => instance.displayName),
          ]))
      if (reserveHero) locationState.reserve.splice(reserveHeroIndex, 1)
      else if (freeInstance) campaign.freeCaptains[faction.id] = freePool.filter((instance) => instance.instanceId !== freeInstance.instanceId)
      else treasury.gold -= 100
      const id = aiId(`army-${faction.id}`)
      const selectedUnitIds = new Set(locationState.reserve.filter((slot) => slot.kind === 'unit').slice(0, 5).map((slot) => slot.slotId))
      const selectedUnits = locationState.reserve.filter((slot) => selectedUnitIds.has(slot.slotId)).map((slot) => ({ ...slot }))
      locationState.reserve = locationState.reserve.filter((slot) => !selectedUnitIds.has(slot.slotId))
      const army: Army = {
        id,
        name: '',
        factionId: faction.id,
        hexId,
        movementRemaining: 0,
        baseUnitSlotLimit: 15,
        heroSlotLimit: 2,
        commander,
        unitSlots: selectedUnits,
        heroSlots: [],
        status: 'ready',
        canInitiateBattle: true,
        engaged: false,
        movedRound: null,
        movedInPhase: null,
        exhaustedUntilRound: null,
      }
      army.name = generateArmyName(army, nextArmies, factions, locations, heroes, grid.config)
      nextArmies.push(army)
    }
  }
  return nextArmies
}

interface MarchTarget {
  location: MapLocation
  targetHexId: string
  target: LogicalHex
  garrison: number
  allyAlreadyNear: boolean
}

export function movementTargetLabel(hexId: string, locations: MapLocation[], regions: Region[], logicalGrid: { byId: Map<string, LogicalHex> }) {
  const location = locations.find((candidate) => candidate.hex === hexId)
  if (location) return location.name
  const regionId = logicalGrid.byId.get(hexId)?.regionId ?? null
  const region = regionId ? regions.find((candidate) => candidate.id === regionId) : null
  return region?.name ?? null
}

export function armyCommanderName(army: Army, heroes: Hero[]) {
  if (!army.commander) return null
  if (army.commander.kind === 'hero') return heroes.find((hero) => hero.id === army.commander!.entityId)?.name ?? null
  return army.commander.displayName ?? null
}

function recordTurnMovement(campaign: CampaignState, army: Army, heroes: Hero[], action: 'moved' | 'stayed' | 'retreated' | 'besieged', targetLabel: string | null, distance: number, originHexId = army.hexId, destinationHexId = army.hexId) {
  campaign.turnMovements.push({
    id: aiId(`move-${army.id}`),
    round: campaign.round,
    factionId: army.factionId,
    armyName: army.name,
    commanderName: armyCommanderName(army, heroes),
    action,
    targetLabel,
    distance,
    armyId: army.id,
    originHexId,
    destinationHexId,
  })
}

function hostileLocationsForSide(side: StrategicSide, locations: MapLocation[], factions: FactionDefinition[]) {
  return locations.filter((location) => factionSide(factions, location.side) === (side === 'good' ? 'evil' : 'good'))
}

function chooseArmyMarchTarget(
  army: Army,
  origin: LogicalHex,
  nextArmies: Army[],
  hostileLocations: MapLocation[],
  logicalGrid: { byId: Map<string, LogicalHex> },
  campaign: CampaignState,
  factions: FactionDefinition[],
  grid: HexGridData,
  claimedTargetIds: Set<string>,
): MarchTarget | null {
  const allTargets = hostileLocations.map((location) => {
    const targetHexId = locationHexId(location, grid.config)
    const target = logicalGrid.byId.get(targetHexId)
    const neighboringIds = target ? new Set(neighborIds(target.q, target.r)) : new Set<string>()
    const allyAlreadyNear = nextArmies.some((candidate) => candidate.id !== army.id && factionSide(factions, candidate.factionId) === factionSide(factions, army.factionId) && (candidate.hexId === targetHexId || neighboringIds.has(candidate.hexId)))
    return { location, targetHexId, target, garrison: campaign.locationStates[location.id]?.reserve.length ?? 0, allyAlreadyNear }
  }).filter((item): item is MarchTarget => Boolean(item.target))
  const availableTargets = allTargets.filter((item) => !claimedTargetIds.has(item.location.id) && !item.allyAlreadyNear)
  const unclaimedTargets = allTargets.filter((item) => !claimedTargetIds.has(item.location.id))
  const targets = (availableTargets.length ? availableTargets : unclaimedTargets.length ? unclaimedTargets : allTargets)
    .sort((left, right) => hexDistance(origin, left.target) - hexDistance(origin, right.target) || left.garrison - right.garrison || left.location.name.localeCompare(right.location.name, 'ru'))
  return targets[0] ?? null
}

function truncatePathAtEnemies(path: string[], nextArmies: Army[], factions: FactionDefinition[], factionId: string) {
  const firstEnemyIndex = path.findIndex((id, index) => index > 0 && nextArmies.some((candidate) => candidate.hexId === id && areFactionsHostile(factions, candidate.factionId, factionId)))
  return firstEnemyIndex > 0 ? path.slice(0, firstEnemyIndex + 1) : path
}

function affordablePathPrefix(path: string[], army: Army, logicalGrid: { byId: Map<string, LogicalHex> }, factions: FactionDefinition[]) {
  let spent = 0
  let destinationIndex = 0
  for (let index = 1; index < path.length; index += 1) {
    const cell = logicalGrid.byId.get(path[index])
    if (!cell) break
    const step = cellMovementCost(cell, army.factionId)
    if (spent + step > army.movementRemaining) break
    spent += step
    destinationIndex = index
  }
  return { destinationIndex, spent }
}

function armyCanMarch(campaign: CampaignState, factions: FactionDefinition[], army: Army, side: StrategicSide, excludedFactionId: string | null) {
  return army.factionId !== excludedFactionId
    && factionIsActive(campaign, army.factionId)
    && factionSide(factions, army.factionId) === side
    && !army.engaged
    && Boolean(army.commander)
    && army.movementRemaining > 0
}

/**
 * Pre-computes the marches of allied AI armies at the start of the planning
 * phase. Plans are rendered as dashed preview arrows and executed during the
 * movement phase; they are never applied while the player is planning.
 */
export function planAlliedMovement(
  side: StrategicSide,
  campaign: CampaignState,
  armies: Army[],
  locations: MapLocation[],
  factions: FactionDefinition[],
  grid: HexGridData,
  regions: Region[],
  excludedFactionId: string | null = campaign.playerFactionId,
): AlliedMovementPlan[] {
  const logicalGrid = resolveGrid(grid, locations, regions)
  const hostileLocations = hostileLocationsForSide(side, locations, factions)
  const claimedTargetIds = new Set<string>()
  const plans: AlliedMovementPlan[] = []
  for (const army of armies) {
    if (!armyCanMarch(campaign, factions, army, side, excludedFactionId)) continue
    const origin = logicalGrid.byId.get(army.hexId)
    if (!origin) continue
    const target = chooseArmyMarchTarget(army, origin, armies, hostileLocations, logicalGrid, campaign, factions, grid, claimedTargetIds)
    if (!target) continue
    let path = findPath(logicalGrid.byId, army.hexId, target.targetHexId, army.factionId)
    if (path.length < 2) continue
    path = truncatePathAtEnemies(path, armies, factions, army.factionId)
    const { destinationIndex, spent } = affordablePathPrefix(path, army, logicalGrid, factions)
    if (!destinationIndex) continue
    claimedTargetIds.add(target.location.id)
    const destinationId = path[destinationIndex]
    const destinationLocation = locations.find((location) => locationHexId(location, grid.config) === destinationId)
    plans.push({
      armyId: army.id,
      factionId: army.factionId,
      path: path.slice(0, destinationIndex + 1),
      destinationHexId: destinationId,
      locationId: destinationLocation?.id ?? null,
      cost: spent,
    })
  }
  return plans
}

export function runAiMovement(
  side: StrategicSide,
  campaign: CampaignState,
  armies: Army[],
  locations: MapLocation[],
  factions: FactionDefinition[],
  grid: HexGridData,
  regions: Region[],
  excludedFactionId: string | null = campaign.playerFactionId,
  heroes: Hero[] = [],
  plans: AlliedMovementPlan[] = [],
) {
  const nextArmies = armies.map((army) => ({ ...army, commander: army.commander ? { ...army.commander } : null, unitSlots: army.unitSlots.map((slot) => ({ ...slot })), heroSlots: army.heroSlots.map((slot) => ({ ...slot })) }))
  const logicalGrid = resolveGrid(grid, locations, regions)
  const hostileLocations = hostileLocationsForSide(side, locations, factions)
  const claimedTargetIds = new Set<string>()
  const planByArmyId = new Map(plans
    .filter((plan) => factionSide(factions, plan.factionId) === side && plan.factionId !== excludedFactionId)
    .map((plan) => [plan.armyId, plan]))

  for (const army of nextArmies) {
    if (!armyCanMarch(campaign, factions, army, side, excludedFactionId)) continue
    const origin = logicalGrid.byId.get(army.hexId)
    if (!origin) continue

    let path: string[] = []
    let destinationIndex = 0
    let spent = 0
    let usedPlan = false
    const plan = planByArmyId.get(army.id)
    if (plan && plan.path.length >= 2 && plan.path[0] === army.hexId) {
      const candidate = truncatePathAtEnemies(plan.path, nextArmies, factions, army.factionId)
      const affordable = affordablePathPrefix(candidate, army, logicalGrid, factions)
      if (affordable.destinationIndex > 0) {
        path = candidate
        destinationIndex = affordable.destinationIndex
        spent = affordable.spent
        usedPlan = true
        if (plan.locationId) claimedTargetIds.add(plan.locationId)
      }
    }
    if (!usedPlan) {
      const target = chooseArmyMarchTarget(army, origin, nextArmies, hostileLocations, logicalGrid, campaign, factions, grid, claimedTargetIds)
      if (!target) {
        recordTurnMovement(campaign, army, heroes, 'stayed', movementTargetLabel(army.hexId, locations, regions, logicalGrid), 0)
        continue
      }
      claimedTargetIds.add(target.location.id)
      const computed = truncatePathAtEnemies(findPath(logicalGrid.byId, army.hexId, target.targetHexId, army.factionId), nextArmies, factions, army.factionId)
      if (computed.length < 2) {
        recordTurnMovement(campaign, army, heroes, 'stayed', movementTargetLabel(army.hexId, locations, regions, logicalGrid), 0)
        continue
      }
      const affordable = affordablePathPrefix(computed, army, logicalGrid, factions)
      if (!affordable.destinationIndex) {
        recordTurnMovement(campaign, army, heroes, 'stayed', movementTargetLabel(army.hexId, locations, regions, logicalGrid), 0)
        continue
      }
      path = computed
      destinationIndex = affordable.destinationIndex
      spent = affordable.spent
    }

    const originHexId = army.hexId
    const destinationId = path[destinationIndex]
    const hostileArmy = nextArmies.some((candidate) => candidate.id !== army.id && candidate.hexId === destinationId && areFactionsHostile(factions, candidate.factionId, army.factionId))
    const destinationLocation = locations.find((location) => locationHexId(location, grid.config) === destinationId)
    const hostileLocation = destinationLocation && areFactionsHostile(factions, destinationLocation.side, army.factionId)
    army.hexId = destinationId
    army.movedRound = campaign.round
    army.movedInPhase = campaign.phase === 'movement_second' ? 'movement_second' : 'movement_first'
    army.movementRemaining = hostileArmy || hostileLocation ? 0 : Math.max(0, army.movementRemaining - spent)
    army.status = army.movementRemaining > 0 ? 'ready' : 'marched'
    if (hostileArmy || hostileLocation) {
      army.engaged = true
      for (const candidate of nextArmies) if (candidate.hexId === destinationId && areFactionsHostile(factions, candidate.factionId, army.factionId)) candidate.engaged = true
    }
    recordTurnMovement(campaign, army, heroes, hostileArmy || hostileLocation ? 'besieged' : 'moved', movementTargetLabel(destinationId, locations, regions, logicalGrid), destinationIndex, originHexId, destinationId)
  }
  return nextArmies
}
