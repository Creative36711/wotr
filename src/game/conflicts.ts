import { areFactionsHostile, getFaction } from '../constants'
import { commanderDefinition } from './army'
import { getEconomicType } from './economicTypes'
import { collectOwnerModifiers, palantirAutoBattleWeight, regionAutoBattleBonus } from './battleModifiers'
import { heroPowerMultiplier, slotPowerMultiplier } from './progression'
import { ringAutoBattleMultiplier } from './ring'
import { factionSide, oppositeSide } from './campaign'
import { findPath, hexDistance, locationHexId, pathMovementCost, resolveGrid } from '../hex/hexGrid'
import type {
  Army,
  ArmySlot,
  AutoBattleReport,
  BattleSlotResult,
  CampaignConflict,
  CampaignState,
  CaptainType,
  FactionDefinition,
  Hero,
  HexGridData,
  LocationCampaignState,
  LogicalHex,
  MapLocation,
  Region,
  StrategicSide,
  UnitType,
  BuildingTypeDefinition,
  EconomicTypeDefinition,
  PalantirSettings,
  RingForgingSettings,
} from '../types'

/**
 * Optional context layer: locations, regions, buildings and the Ring. When it
 * is missing (older callers) the battle math falls back to the previous rules.
 */
export interface ConflictModifierContext {
  campaign: CampaignState
  regions: Region[]
  buildingTypes: BuildingTypeDefinition[]
  economicTypes?: EconomicTypeDefinition[]
  ringForging: RingForgingSettings
  palantirSettings: PalantirSettings
}


interface BattleMember {
  key: string
  objectId: string
  kind: 'unit' | 'hero' | 'captain'
  entityId: string
  power: number
  source: 'army' | 'garrison'
  sourceId: string
}

export interface ConflictPreview {
  attackerPower: number
  defenderPower: number
  attackerBasePower: number
  defenderBasePower: number
  defenseBonus: number
  attackerUnits: number
  defenderUnits: number
}

export interface ConflictBattleOutcome extends ConflictPreview {
  winnerSide: StrategicSide
  attackerResults: BattleSlotResult[]
  defenderResults: BattleSlotResult[]
  garrisonResults: BattleSlotResult[]
  destroyedArmyKeys: Set<string>
  destroyedGarrisonKeys: Set<string>
  report: AutoBattleReport
}

export function settlementDefenseBonus(location: MapLocation | null) {
  if (!location) return 0
  return getEconomicType(location.economicType).defenseBonus
}

export function conflictBattleType(location: MapLocation | null) {
  if (!location) return 'field' as const
  return getEconomicType(location.economicType).battleType === 'siege' ? 'siege' as const : 'settlement' as const
}

function hashSeed(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619) }
  return Math.abs(hash >>> 0)
}

function randomFrom(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453
  return value - Math.floor(value)
}

function armyMembers(army: Army, units: UnitType[], heroes: Hero[], captains: CaptainType[], heroLevels: Record<string, number> = {}): BattleMember[] {
  const result: BattleMember[] = []
  const commander = commanderDefinition(army, heroes, captains)
  if (army.commander && commander) result.push({
    key: `${army.id}-commander`,
    objectId: army.commander.objectId ?? `strategic:${commander.id}`,
    kind: army.commander.kind,
    entityId: commander.id,
    power: commander.battlePower * (army.commander.kind === 'hero' ? heroPowerMultiplier(heroLevels, commander.id) : 1),
    source: 'army',
    sourceId: army.id,
  })
  for (const slot of army.heroSlots) {
    const hero = heroes.find((candidate) => candidate.id === slot.entityId && candidate.alive)
    if (hero) result.push({ key: slot.slotId, objectId: hero.objectId, kind: 'hero', entityId: hero.id, power: hero.battlePower * heroPowerMultiplier(heroLevels, hero.id), source: 'army', sourceId: army.id })
  }
  for (const slot of army.unitSlots) {
    const unit = units.find((candidate) => candidate.id === slot.entityId)
    if (unit) result.push({ key: slot.slotId, objectId: unit.objectId, kind: 'unit', entityId: unit.id, power: unit.battlePower * slotPowerMultiplier(slot), source: 'army', sourceId: army.id })
  }
  return result
}

function garrisonMembers(locationId: string, reserve: ArmySlot[], units: UnitType[], heroes: Hero[], heroLevels: Record<string, number> = {}): BattleMember[] {
  const result: BattleMember[] = []
  for (const slot of reserve) {
    if (slot.kind === 'hero') {
      const hero = heroes.find((candidate) => candidate.id === slot.entityId && candidate.alive)
      if (hero) result.push({ key: slot.slotId, objectId: hero.objectId, kind: 'hero', entityId: hero.id, power: hero.battlePower * heroPowerMultiplier(heroLevels, hero.id), source: 'garrison', sourceId: locationId })
    } else {
      const unit = units.find((candidate) => candidate.id === slot.entityId)
      if (unit) result.push({ key: slot.slotId, objectId: unit.objectId, kind: 'unit', entityId: unit.id, power: unit.battlePower * slotPowerMultiplier(slot), source: 'garrison', sourceId: locationId })
    }
  }
  return result
}

function armyPoolPower(armies: Army[], units: UnitType[], heroes: Hero[], captains: CaptainType[], round: number, heroLevels: Record<string, number> = {}) {
  return armies.reduce((total, army) => {
    const members = armyMembers(army, units, heroes, captains, heroLevels)
    const commander = commanderDefinition(army, heroes, captains)
    const demoralized = army.status === 'retreating' && army.exhaustedUntilRound !== null && army.exhaustedUntilRound >= round
    const moraleMultiplier = demoralized ? .8 : 1
    return total + members.reduce((sum, member) => sum + member.power, 0) * (1 + Math.min(.3, (commander?.command ?? 0) / 100)) * moraleMultiplier
  }, 0)
}

function garrisonPower(members: BattleMember[], heroes: Hero[]) {
  const raw = members.reduce((total, member) => total + member.power, 0)
  const commander = members.filter((member) => member.kind === 'hero')
    .map((member) => heroes.find((hero) => hero.id === member.entityId))
    .filter(Boolean)
    .sort((left, right) => (right?.command ?? 0) - (left?.command ?? 0))[0]
  return raw * (commander ? 1 + Math.min(.3, commander.command / 100) : .85)
}

export function previewConflict(
  conflict: CampaignConflict,
  armies: Army[],
  locations: MapLocation[],
  locationStates: Record<string, LocationCampaignState>,
  units: UnitType[],
  heroes: Hero[],
  captains: CaptainType[],
  terrain: LogicalHex['terrain'],
  context?: ConflictModifierContext | null,
): ConflictPreview {
  const attackerCombatIds = [...conflict.attackerArmyIds, ...conflict.attackerReinforcementArmyIds]
  const defenderCombatIds = [...conflict.defenderArmyIds, ...conflict.defenderReinforcementArmyIds]
  const attackerArmies = attackerCombatIds.map((id) => armies.find((army) => army.id === id)).filter(Boolean) as Army[]
  const defenderArmies = defenderCombatIds.map((id) => armies.find((army) => army.id === id)).filter(Boolean) as Army[]
  const location = conflict.locationId ? locations.find((candidate) => candidate.id === conflict.locationId) ?? null : null
  const reserve = conflict.garrisonLocationId ? locationStates[conflict.garrisonLocationId]?.reserve ?? [] : []
  const heroLevels = context?.campaign.heroLevels ?? {}
  const garrison = conflict.garrisonLocationId ? garrisonMembers(conflict.garrisonLocationId, reserve, units, heroes, heroLevels) : []
  let attackerBasePower = armyPoolPower(attackerArmies, units, heroes, captains, conflict.round, heroLevels)
  let defenderBasePower = armyPoolPower(defenderArmies, units, heroes, captains, conflict.round, heroLevels) + garrisonPower(garrison, heroes)
  if (terrain === 'mountains') attackerBasePower *= .88
  if (terrain === 'swamp') attackerBasePower *= .84
  if (terrain === 'forest') defenderBasePower *= 1.08
  if (terrain === 'hills') defenderBasePower *= 1.12
  if (terrain === 'mountains') defenderBasePower *= 1.2
  if (terrain === 'swamp') defenderBasePower *= 1.06
  const siegePower = attackerArmies.reduce((total, army) => total + army.unitSlots.reduce((sum, slot) => sum + (units.find((unit) => unit.id === slot.entityId)?.siegePower ?? 0), 0), 0)
  const attackerFactionId = attackerArmies[0]?.factionId ?? null
  const defenderFactionId = defenderArmies[0]?.factionId ?? location?.side ?? null
  // The context layer belongs to the OWNER of the location, whichever side that is.
  const ownerFactionId = location?.side ?? defenderFactionId
  const ownerIsDefender = !location || ownerFactionId === defenderFactionId
  let ownerModifiers = {} as ReturnType<typeof collectOwnerModifiers>
  let attackerContextMultiplier = 1
  let defenderContextMultiplier = 1
  if (context) {
    const region = conflict.regionId ? context.regions.find((candidate) => candidate.id === conflict.regionId) ?? null : null
    ownerModifiers = collectOwnerModifiers({
      location, region, factionId: ownerFactionId, campaign: context.campaign,
      buildingTypes: context.buildingTypes, economicTypes: context.economicTypes,
      ringForging: context.ringForging, palantirSettings: context.palantirSettings,
    })
    const ownerBonus = 1
      + (ownerModifiers.defenseBonus ?? 0)
      + (ownerModifiers.ambushBonus ?? 0) * 0.5
      + palantirAutoBattleWeight(ownerModifiers, context.palantirSettings)
      + regionAutoBattleBonus(region, ownerFactionId)
    if (ownerIsDefender) defenderContextMultiplier *= ownerBonus
    else attackerContextMultiplier *= ownerBonus
    const debuff = 1 - (ownerModifiers.terrainDebuff ?? 0)
    attackerContextMultiplier *= debuff
    defenderContextMultiplier *= debuff
    attackerContextMultiplier *= ringAutoBattleMultiplier(context.campaign, context.ringForging, attackerFactionId ? [attackerFactionId] : [])
    defenderContextMultiplier *= ringAutoBattleMultiplier(context.campaign, context.ringForging, defenderFactionId ? [defenderFactionId] : [])
  }
  attackerBasePower *= attackerContextMultiplier
  defenderBasePower *= defenderContextMultiplier
  const baseDefenseBonus = settlementDefenseBonus(location)
  const defenseBonus = conflict.battleType === 'siege' ? Math.max(0, baseDefenseBonus - Math.min(.25, siegePower / 400)) : baseDefenseBonus
  const attackerMembers = attackerArmies.flatMap((army) => armyMembers(army, units, heroes, captains, heroLevels))
  const defenderMembers = [...defenderArmies.flatMap((army) => armyMembers(army, units, heroes, captains, heroLevels)), ...garrison]
  return {
    attackerPower: Math.max(1, Math.round(attackerBasePower)),
    defenderPower: Math.max(1, Math.round(defenderBasePower * (1 + defenseBonus))),
    attackerBasePower: Math.round(attackerBasePower),
    defenderBasePower: Math.round(defenderBasePower),
    defenseBonus,
    attackerUnits: attackerMembers.filter((member) => member.kind === 'unit').length,
    defenderUnits: defenderMembers.filter((member) => member.kind === 'unit').length,
  }
}

function casualtyResults(members: BattleMember[], lossCount: number) {
  const priority = (member: BattleMember) => member.kind === 'unit' ? 0 : member.kind === 'hero' ? 1 : 2
  const destroyed = new Set(members
    .slice()
    .sort((left, right) => priority(left) - priority(right) || left.power - right.power || left.key.localeCompare(right.key))
    .slice(0, Math.max(0, Math.min(lossCount, members.length)))
    .map((member) => member.key))
  return members.map((member) => ({ slotId: member.key, objectId: member.objectId, kind: member.kind, destroyed: destroyed.has(member.key) } as BattleSlotResult))
}

export function calculateConflictBattle(
  conflict: CampaignConflict,
  armies: Army[],
  locations: MapLocation[],
  locationStates: Record<string, LocationCampaignState>,
  units: UnitType[],
  heroes: Hero[],
  captains: CaptainType[],
  terrain: LogicalHex['terrain'],
  factions: FactionDefinition[],
  /** RTS battle: the winner is already known from BFME; losses/hero fates stay simulated. */
  forcedWinner?: StrategicSide | null,
  context?: ConflictModifierContext | null,
): ConflictBattleOutcome {
  const attackerCombatIds = [...conflict.attackerArmyIds, ...conflict.attackerReinforcementArmyIds]
  const defenderCombatIds = [...conflict.defenderArmyIds, ...conflict.defenderReinforcementArmyIds]
  const attackerArmies = attackerCombatIds.map((id) => armies.find((army) => army.id === id)).filter(Boolean) as Army[]
  const defenderArmies = defenderCombatIds.map((id) => armies.find((army) => army.id === id)).filter(Boolean) as Army[]
  const location = conflict.locationId ? locations.find((candidate) => candidate.id === conflict.locationId) ?? null : null
  const reserve = conflict.garrisonLocationId ? locationStates[conflict.garrisonLocationId]?.reserve ?? [] : []
  const heroLevels = context?.campaign.heroLevels ?? {}
  const attackerMembers = attackerArmies.flatMap((army) => armyMembers(army, units, heroes, captains, heroLevels))
  const defenderArmyMembers = defenderArmies.flatMap((army) => armyMembers(army, units, heroes, captains, heroLevels))
  const garrison = conflict.garrisonLocationId ? garrisonMembers(conflict.garrisonLocationId, reserve, units, heroes, heroLevels) : []
  const defenderMembers = [...defenderArmyMembers, ...garrison]
  const preview = previewConflict(conflict, armies, locations, locationStates, units, heroes, captains, terrain, context)
  const seed = hashSeed(`${conflict.round}:${conflict.id}:${attackerMembers.length}:${defenderMembers.length}`)
  const attackerPower = preview.attackerPower * (.94 + randomFrom(seed) * .12)
  const defenderPower = preview.defenderPower * (.94 + randomFrom(seed + 1) * .12)
  // With a forced winner (RTS battle) the loss distribution follows the known
  // outcome, but which units/heroes perish is still decided by this simulation.
  const attackerWon = forcedWinner ? forcedWinner === conflict.attackerSide : attackerPower >= defenderPower
  const ratio = Math.min(3, Math.max(.34, attackerPower / Math.max(1, defenderPower)))
  const attackerPressure = attackerWon ? Math.min(.4, Math.max(.1, .3 / ratio + randomFrom(seed + 2) * .06)) : Math.min(.9, Math.max(.5, .58 + (1 / ratio - 1) * .2 + randomFrom(seed + 2) * .08))
  const defenderPressure = attackerWon ? Math.min(.9, Math.max(.5, .58 + (ratio - 1) * .2 + randomFrom(seed + 3) * .08)) : Math.min(.4, Math.max(.1, .3 * ratio + randomFrom(seed + 3) * .06))
  const attackerUnitCount = attackerMembers.filter((member) => member.kind === 'unit').length
  const defenderUnitCount = defenderMembers.filter((member) => member.kind === 'unit').length
  const attackerLossCount = Math.min(attackerWon ? attackerUnitCount : attackerMembers.length, Math.max(attackerWon ? 0 : 1, Math.round(attackerMembers.length * attackerPressure)))
  const defenderLossCount = Math.min(attackerWon ? defenderMembers.length : defenderUnitCount, Math.max(attackerWon ? 1 : 0, Math.round(defenderMembers.length * defenderPressure)))
  const attackerResults = casualtyResults(attackerMembers, attackerLossCount)
  const allDefenderResults = casualtyResults(defenderMembers, defenderLossCount)
  const defenderResults = allDefenderResults.filter((result) => defenderArmyMembers.some((member) => member.key === result.slotId))
  const garrisonResults = allDefenderResults.filter((result) => garrison.some((member) => member.key === result.slotId))
  const winnerSide = attackerWon ? conflict.attackerSide : conflict.defenderSide
  const attackerFactionId = attackerArmies[0]?.factionId ?? conflict.captorFactionId
  const defenderFactionId = defenderArmies[0]?.factionId ?? location?.side ?? factions.find((faction) => faction.alignment === conflict.defenderSide)?.id ?? 'civilian'
  const attackerFaction = getFaction(factions, attackerFactionId)
  const defenderFaction = getFaction(factions, defenderFactionId)
  const primaryAttackerId = attackerArmies[0]?.id ?? `side-${conflict.attackerSide}`
  const primaryDefenderId = defenderArmies[0]?.id ?? `garrison-${conflict.locationId ?? conflict.hexId}`
  const summary = `${attackerWon ? attackerFaction.label : defenderFaction.label} побеждает: ${location ? `сражение у «${location.name}»` : 'полевое сражение'}.`
  const report: AutoBattleReport = {
    id: `battle-${conflict.round}-${seed.toString(36)}`,
    conflictId: conflict.id,
    round: conflict.round,
    battleType: conflict.battleType,
    terrain,
    locationId: conflict.locationId,
    attackerArmyId: primaryAttackerId,
    defenderArmyId: primaryDefenderId,
    attackerArmyIds: attackerArmies.map((army) => army.id),
    defenderArmyIds: defenderArmies.map((army) => army.id),
    attackerReinforcementArmyIds: [...conflict.attackerReinforcementArmyIds],
    defenderReinforcementArmyIds: [...conflict.defenderReinforcementArmyIds],
    attackerFactionId,
    defenderFactionId,
    attackerPower: Math.round(attackerPower),
    defenderPower: Math.round(defenderPower),
    defenseBonus: preview.defenseBonus,
    winnerArmyId: attackerWon ? primaryAttackerId : primaryDefenderId,
    loserArmyId: attackerWon ? primaryDefenderId : primaryAttackerId,
    winnerSide,
    attackerLosses: attackerResults,
    defenderLosses: defenderResults,
    garrisonLosses: garrisonResults,
    attackerDestroyed: !attackerWon && attackerResults.every((result) => result.destroyed),
    defenderDestroyed: attackerWon && allDefenderResults.every((result) => result.destroyed),
    capturedLocationId: null,
    summary,
    timestamp: new Date().toISOString(),
  }
  return {
    ...preview,
    attackerPower: Math.round(attackerPower),
    defenderPower: Math.round(defenderPower),
    winnerSide,
    attackerResults,
    defenderResults,
    garrisonResults,
    destroyedArmyKeys: new Set([...attackerResults, ...defenderResults].filter((result) => result.destroyed).map((result) => result.slotId)),
    destroyedGarrisonKeys: new Set(garrisonResults.filter((result) => result.destroyed).map((result) => result.slotId)),
    report,
  }
}

export function updateConflictRtsCompatibility(conflict: CampaignConflict, armies: Army[], locations: MapLocation[]) {
  const attackerFactions = new Set([...conflict.attackerArmyIds, ...conflict.attackerReinforcementArmyIds].map((id) => armies.find((army) => army.id === id)?.factionId).filter(Boolean) as string[])
  const defenderFactions = new Set([...conflict.defenderArmyIds, ...conflict.defenderReinforcementArmyIds].map((id) => armies.find((army) => army.id === id)?.factionId).filter(Boolean) as string[])
  if (conflict.garrisonLocationId) {
    const owner = locations.find((location) => location.id === conflict.garrisonLocationId)?.side
    if (owner) defenderFactions.add(owner)
  }
  conflict.rtsAttackerSlots = attackerFactions.size
  conflict.rtsDefenderSlots = defenderFactions.size
  const fortressReady = conflict.battleType !== 'siege' || Boolean(conflict.rtsDefenderStartPosition)
  conflict.rtsCompatible = Boolean(conflict.rtsMapId && fortressReady && attackerFactions.size > 0 && defenderFactions.size > 0 && attackerFactions.size <= 4 && defenderFactions.size <= 4)
}

function arrivalRank(armies: Army[], side: StrategicSide, round: number) {
  return armies.filter((army) => army.movedRound === round && army.movedInPhase && army.movedInPhase.startsWith('movement') && army.movedInPhase)
    .filter((army) => army.movedInPhase)
    .reduce((rank, army) => Math.max(rank, army.movedInPhase === 'movement_second' ? 2 : 1), 0)
}

export function scanHotSpots(
  campaign: CampaignState,
  armies: Army[],
  locations: MapLocation[],
  factions: FactionDefinition[],
  locationStates: Record<string, LocationCampaignState>,
  grid: HexGridData,
  regions: Region[],
) {
  const resolved = resolveGrid(grid, locations, regions)
  const byHex = new Map<string, Army[]>()
  for (const army of armies) byHex.set(army.hexId, [...(byHex.get(army.hexId) ?? []), army])
  const locationsByHex = new Map(locations.map((location) => [locationHexId(location, grid.config), location]))
  const hexIds = new Set([...byHex.keys(), ...locationsByHex.keys()])
  const conflicts: CampaignConflict[] = []
  const autoCaptures: Array<{ locationId: string; factionId: string; armyId: string }> = []

  for (const hexId of hexIds) {
    const here = byHex.get(hexId) ?? []
    const good = here.filter((army) => factionSide(factions, army.factionId) === 'good')
    const evil = here.filter((army) => factionSide(factions, army.factionId) === 'evil')
    const location = locationsByHex.get(hexId) ?? null
    const battleCell = resolved.byId.get(hexId)
    const regionId = battleCell?.regionId ?? location?.regionId ?? null
    const regionObjects = regionId ? locations.filter((candidate) => candidate.regionId === regionId) : []
    const rtsLocation = location
      ?? (battleCell?.domainId ? locations.find((candidate) => candidate.id === battleCell.domainId) ?? null : null)
      ?? regionObjects.find((candidate) => candidate.rtsMapCache)
      ?? regionObjects.find((candidate) => candidate.structuralType === 'domain')
      ?? regionObjects[0]
      ?? null
    const ownerSide = location ? factionSide(factions, location.side) : null
    const hasArmyConflict = good.length > 0 && evil.length > 0
    const loneSide: StrategicSide | null = good.length && !evil.length ? 'good' : evil.length && !good.length ? 'evil' : null
    const attacksLocation = Boolean(location && loneSide && ownerSide && ownerSide !== loneSide)
    if (!hasArmyConflict && !attacksLocation) continue

    if (attacksLocation && location && loneSide) {
      const reserve = locationStates[location.id]?.reserve ?? []
      const defenders = loneSide === 'good' ? evil : good
      if (!defenders.length && reserve.length === 0) {
        const attacker = (loneSide === 'good' ? good : evil)[0]
        if (attacker) autoCaptures.push({ locationId: location.id, factionId: attacker.factionId, armyId: attacker.id })
        continue
      }
    }

    let defenderSide: StrategicSide
    if (location && ownerSide && ((ownerSide === 'good' && good.length) || (ownerSide === 'evil' && evil.length))) defenderSide = ownerSide
    else {
      const goodRank = arrivalRank(good, 'good', campaign.round)
      const evilRank = arrivalRank(evil, 'evil', campaign.round)
      if (goodRank !== evilRank) defenderSide = goodRank > evilRank ? 'evil' : 'good'
      else defenderSide = campaign.firstMoverThisRound
    }
    const attackerSide = oppositeSide(defenderSide)
    const attackerArmies = attackerSide === 'good' ? good : evil
    const defenderArmies = defenderSide === 'good' ? good : evil
    const garrisonLocationId = location && ownerSide === defenderSide && (locationStates[location.id]?.reserve.length ?? 0) > 0 ? location.id : null
    const captor = attackerArmies.slice().sort((left, right) => (right.movedInPhase === 'movement_second' ? 2 : right.movedInPhase ? 1 : 0) - (left.movedInPhase === 'movement_second' ? 2 : left.movedInPhase ? 1 : 0))[0]
    if (!captor) continue
    const id = `conflict-r${campaign.round}-${hexId.replace(':', '_')}`
    conflicts.push({
      id,
      round: campaign.round,
      hexId,
      battleType: conflictBattleType(location),
      locationId: location?.id ?? null,
      attackerSide,
      defenderSide,
      attackerArmyIds: attackerArmies.map((army) => army.id),
      defenderArmyIds: defenderArmies.map((army) => army.id),
      attackerReinforcementArmyIds: [],
      defenderReinforcementArmyIds: [],
      attackerDistantReinforcementArmyIds: [],
      defenderDistantReinforcementArmyIds: [],
      optionalPlayerReinforcements: [],
      garrisonLocationId,
      regionId,
      rtsLocationId:rtsLocation?.id??null,
      rtsMapSource:'location',
      rtsMapId:rtsLocation?.rtsMapCache?.mapPath??'',
      rtsDefenderStartPosition: location && conflictBattleType(location) === 'siege' && Number.isFinite(location.rtsFortress?.defenderStartPosition?.x) && Number.isFinite(location.rtsFortress?.defenderStartPosition?.y) ? { x: Number(location.rtsFortress!.defenderStartPosition!.x), y: Number(location.rtsFortress!.defenderStartPosition!.y) } : null,
      rtsAttackerSlots: 0,
      rtsDefenderSlots: 0,
      rtsCompatible: false,
      captorFactionId: captor.factionId,
      defenseBonus: settlementDefenseBonus(location),
      status: 'pending',
      resolution: null,
      winnerSide: null,
      attackerPower: null,
      defenderPower: null,
      attackerLosses: 0,
      defenderLosses: 0,
    })
  }

  conflicts.sort((left, right) => {
    const leftSiege = left.battleType === 'siege' ? 0 : 1
    const rightSiege = right.battleType === 'siege' ? 0 : 1
    return leftSiege - rightSiege || (left.locationId ?? '').localeCompare(right.locationId ?? '', 'ru')
  })

  const coreArmyIds = new Set(conflicts.flatMap((conflict) => [...conflict.attackerArmyIds, ...conflict.defenderArmyIds]))
  const usedReinforcements = new Set<string>()
  for (const conflict of conflicts) {
    const battleCell = resolved.byId.get(conflict.hexId)
    if (!battleCell) continue
    const candidates: Array<{ army: Army; side: StrategicSide; tier: 'immediate' | 'distant'; pathCost: number }> = []
    for (const army of armies) {
      if (coreArmyIds.has(army.id) || usedReinforcements.has(army.id) || army.engaged || !army.commander) continue
      if (army.status === 'retreating' || army.exhaustedUntilRound !== null && army.exhaustedUntilRound >= campaign.round) continue
      const side = factionSide(factions, army.factionId)
      if (side !== conflict.attackerSide && side !== conflict.defenderSide) continue
      const armyCell = resolved.byId.get(army.hexId)
      if (!armyCell) continue
      const distance = hexDistance(armyCell, battleCell)
      if (distance === 1) {
        candidates.push({ army, side, tier: 'immediate', pathCost: 0 })
        continue
      }
      if (distance !== 2 || army.movementRemaining <= 0) continue
      const path = findPath(resolved.byId, army.hexId, conflict.hexId, army.factionId)
      if (path.length < 2) continue
      const blocked = path.some((hexId, index) => index > 0 && index < path.length - 1 && armies.some((candidate) => candidate.hexId === hexId && areFactionsHostile(factions, candidate.factionId, army.factionId)))
      const cost = blocked ? Number.POSITIVE_INFINITY : pathMovementCost(path, resolved.byId, army.factionId)
      if (cost <= army.movementRemaining) candidates.push({ army, side, tier: 'distant', pathCost: cost })
    }
    candidates.sort((left, right) => (left.tier === 'immediate' ? 0 : 1) - (right.tier === 'immediate' ? 0 : 1) || left.pathCost - right.pathCost || right.army.unitSlots.length - left.army.unitSlots.length || left.army.name.localeCompare(right.army.name, 'ru'))

    for (const side of [conflict.attackerSide, conflict.defenderSide] as const) {
      const representedFactions = new Set((side === conflict.attackerSide ? conflict.attackerArmyIds : conflict.defenderArmyIds).map((id) => armies.find((army) => army.id === id)?.factionId).filter(Boolean) as string[])
      if (side === conflict.defenderSide && conflict.garrisonLocationId) {
        const owner = locations.find((location) => location.id === conflict.garrisonLocationId)?.side
        if (owner) representedFactions.add(owner)
      }
      for (const candidate of candidates.filter((item) => item.side === side)) {
        const alreadyRepresented = representedFactions.has(candidate.army.factionId)
        if (!alreadyRepresented && representedFactions.size >= 4) continue
        if (!alreadyRepresented) representedFactions.add(candidate.army.factionId)
        usedReinforcements.add(candidate.army.id)
        if (candidate.army.factionId === campaign.playerFactionId) {
          conflict.optionalPlayerReinforcements.push({ armyId: candidate.army.id, side, tier: candidate.tier, pathCost: candidate.pathCost })
          continue
        }
        const reinforcementIds = side === conflict.attackerSide ? conflict.attackerReinforcementArmyIds : conflict.defenderReinforcementArmyIds
        const distantIds = side === conflict.attackerSide ? conflict.attackerDistantReinforcementArmyIds : conflict.defenderDistantReinforcementArmyIds
        reinforcementIds.push(candidate.army.id)
        if (candidate.tier === 'distant') distantIds.push(candidate.army.id)
      }
    }
    updateConflictRtsCompatibility(conflict, armies, locations)
  }
  return { conflicts, autoCaptures }
}
