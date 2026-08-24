import { areFactionsHostile } from '../constants'
import { armyUnitSlotCap, createCaptainCommander, createHeroCommander, factionArmyLimit, factionCaptainCount, factionCaptainLimit, generateArmyName, generateUniqueCaptainName } from './army'
import { factionIsActive, factionSide } from './campaign'
import { heroIsDeployed, heroUnlockSatisfied } from './heroes'
import { recruitableUnitsAtLocation } from './recruitment'
import { cellMovementCost, findPath, hexDistance, locationHexId, neighborIds, resolveGrid } from '../hex/hexGrid'
import type { Army, CampaignState, CaptainType, FactionDefinition, Hero, HexGridData, MapLocation, Region, StrategicSide, UnitType } from '../types'

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
        while (army.unitSlots.length < armyUnitSlotCap(army)) {
          const slotIndex = locationState.reserve.findIndex((slot) => slot.kind === 'unit')
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
      const canHireCaptain = Boolean(captain && treasury.gold >= 100 && captainCount < captainLimit && locationState.occupationTurnsLeft === 0 && ['city', 'fortress', 'capital'].includes(location.economicType))
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

export function runAiMovement(
  side: StrategicSide,
  campaign: CampaignState,
  armies: Army[],
  locations: MapLocation[],
  factions: FactionDefinition[],
  grid: HexGridData,
  regions: Region[],
  excludedFactionId: string | null = campaign.playerFactionId,
) {
  const nextArmies = armies.map((army) => ({ ...army, commander: army.commander ? { ...army.commander } : null, unitSlots: army.unitSlots.map((slot) => ({ ...slot })), heroSlots: army.heroSlots.map((slot) => ({ ...slot })) }))
  const logicalGrid = resolveGrid(grid, locations, regions)
  const hostileLocations = locations.filter((location) => factionSide(factions, location.side) === (side === 'good' ? 'evil' : 'good'))
  const claimedTargetIds = new Set<string>()

  for (const army of nextArmies) {
    if (army.factionId === excludedFactionId || !factionIsActive(campaign, army.factionId) || factionSide(factions, army.factionId) !== side || army.engaged || !army.commander || army.movementRemaining <= 0) continue
    const origin = logicalGrid.byId.get(army.hexId)
    if (!origin) continue
    const allTargets = hostileLocations.map((location) => {
      const targetHexId = locationHexId(location, grid.config)
      const target = logicalGrid.byId.get(targetHexId)
      const neighboringIds = target ? new Set(neighborIds(target.q, target.r)) : new Set<string>()
      const allyAlreadyNear = nextArmies.some((candidate) => candidate.id !== army.id && factionSide(factions, candidate.factionId) === side && (candidate.hexId === targetHexId || neighboringIds.has(candidate.hexId)))
      return { location, targetHexId, target, garrison: campaign.locationStates[location.id]?.reserve.length ?? 0, allyAlreadyNear }
    }).filter((item) => item.target)
    const availableTargets = allTargets.filter((item) => !claimedTargetIds.has(item.location.id) && !item.allyAlreadyNear)
    const targets = (availableTargets.length ? availableTargets : allTargets.filter((item) => !claimedTargetIds.has(item.location.id)).length ? allTargets.filter((item) => !claimedTargetIds.has(item.location.id)) : allTargets)
      .sort((left, right) => hexDistance(origin, left.target!) - hexDistance(origin, right.target!) || left.garrison - right.garrison || left.location.name.localeCompare(right.location.name, 'ru'))
    const target = targets[0]
    if (!target) continue
    claimedTargetIds.add(target.location.id)
    let path = findPath(logicalGrid.byId, army.hexId, target.targetHexId, army.factionId)
    if (path.length < 2) continue
    const firstEnemyIndex = path.findIndex((id, index) => index > 0 && nextArmies.some((candidate) => candidate.hexId === id && areFactionsHostile(factions, candidate.factionId, army.factionId)))
    if (firstEnemyIndex > 0) path = path.slice(0, firstEnemyIndex + 1)
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
    if (!destinationIndex) continue
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
  }
  return nextArmies
}
