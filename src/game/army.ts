import { locationHexId } from '../hex/hexGrid'
import type { Army, ArmyCommander, ArmySlot, CaptainInstance, CaptainType, FactionDefinition, Hero, MapLocation, UnitType } from '../types'
import { captainHireEconomicTypes } from './economicTypes'

export function createUnitSlot(armyId: string, unit: UnitType, index: number): ArmySlot {
  return { slotId: `${armyId}-unit-${Date.now().toString(36)}-${index}`, kind: 'unit', entityId: unit.id, objectId: unit.objectId }
}

export function createHeroSlot(armyId: string, hero: Hero, index: number): ArmySlot {
  return { slotId: `${armyId}-hero-${Date.now().toString(36)}-${index}`, kind: 'hero', entityId: hero.id, objectId: hero.objectId }
}

export function createHeroCommander(hero: Hero): ArmyCommander {
  return { kind: 'hero', entityId: hero.id, objectId: hero.objectId }
}

export const CAPTAIN_NAME_POOLS: Record<string, string[]> = {
  'men-of-the-west': ['Beren', 'Mardil', 'Hurin', 'Grimbold', 'Hama'],
  elves: ['Erestor', 'Lindir', 'Rumil', 'Orophin', 'Galador'],
  dwarves: ['Dori', 'Nori', 'Borin', 'Narvi', 'Frar'],
  isengard: ['Ugluk', 'Mauhur', 'Vargul', 'Radbug', 'Gorbag'],
  mordor: ['Shagrat', 'Gorbag', 'Grishnakh', 'Muzgash', 'Radbug'],
  goblins: ['Boldur', 'Grishak', 'Muzgar', 'Snagur', 'Ragash'],
  angmar: ['Morkant', 'Vargrim', 'Guldar', 'Karn', 'Targon'],
}

export const FALLBACK_CAPTAIN_NAMES = ['Ardan', 'Baran', 'Karan', 'Toron', 'Maran']

export function captainNamesForFaction(factionId: string) {
  return [...(CAPTAIN_NAME_POOLS[factionId] ?? FALLBACK_CAPTAIN_NAMES)]
}

export function generateCaptainName(factionId: string, namePool?: string[]) {
  const values = namePool?.filter((name) => name.trim()) ?? CAPTAIN_NAME_POOLS[factionId] ?? FALLBACK_CAPTAIN_NAMES
  const pool = values.length ? values : FALLBACK_CAPTAIN_NAMES
  return pool[Math.floor(Math.random() * pool.length)]
}

export function generateUniqueCaptainName(factionId: string, namePool: string[] | undefined, usedNames: Iterable<string>) {
  const used = new Set([...usedNames].map((name) => name.trim()).filter(Boolean))
  const values = (namePool?.filter((name) => name.trim()) ?? CAPTAIN_NAME_POOLS[factionId] ?? FALLBACK_CAPTAIN_NAMES).map((name) => name.trim()).filter(Boolean)
  const pool = values.length ? [...new Set(values)] : FALLBACK_CAPTAIN_NAMES
  const available = pool.filter((name) => !used.has(name))
  if (available.length) return available[Math.floor(Math.random() * available.length)]
  const base = pool[Math.floor(Math.random() * pool.length)]
  let number = 2
  while (used.has(`${base} ${number}`)) number += 1
  return `${base} ${number}`
}

export function createCaptainCommander(
  captain: CaptainType,
  displayName = generateCaptainName(captain.factionId, captain.namePool),
  instanceId = `captain-${captain.factionId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
): ArmyCommander {
  return { kind: 'captain', entityId: captain.id, displayName, instanceId }
}

export function captainInstanceFromCommander(commander: ArmyCommander | null): CaptainInstance | null {
  if (!commander || commander.kind !== 'captain') return null
  return {
    instanceId: commander.instanceId ?? `captain-released-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    captainTypeId: commander.entityId,
    displayName: commander.displayName ?? 'Unnamed',
  }
}

export function factionCaptainLimit(factionId: string, locations: MapLocation[]) {
  const hireTypes = captainHireEconomicTypes()
  return locations.filter((location) => location.side === factionId && hireTypes.has(location.economicType)).length
}

export function factionCaptainCount(factionId: string, armies: Army[], freeCaptains: Record<string, CaptainInstance[]> = {}) {
  const assigned = armies.filter((army) => army.factionId === factionId && army.commander?.kind === 'captain').length
  return assigned + (freeCaptains[factionId]?.length ?? 0)
}

export function commanderDefinition(army: Army, heroes: Hero[], captains: CaptainType[]) {
  if (!army.commander) return null
  return army.commander.kind === 'hero'
    ? heroes.find((hero) => hero.id === army.commander!.entityId && hero.alive) ?? null
    : captains.find((captain) => captain.id === army.commander!.entityId) ?? null
}

export function armyMovementBreakdown(army: Army, heroes: Hero[], captains: CaptainType[] = [], unitTypes: UnitType[] = []) {
  const movementValues = army.unitSlots
    .map((slot) => unitTypes.find((unit) => unit.id === slot.entityId))
    .filter(Boolean) as UnitType[]
  const slowestUnit = movementValues.length
    ? movementValues.reduce((slowest, unit) => unit.movementPoints < slowest.movementPoints ? unit : slowest)
    : null
  const slowestMovement = slowestUnit?.movementPoints ?? 5
  const logisticsPenalty = Math.floor(army.unitSlots.length / 5)
  const commanderBonus = Math.min(3, commanderDefinition(army, heroes, captains)?.movementBonus ?? 0)
  return {
    slowestMovement,
    slowestUnitName: slowestUnit?.name ?? 'No Units',
    logisticsPenalty,
    commanderBonus,
    total: Math.max(1, slowestMovement - logisticsPenalty + commanderBonus),
  }
}

export function armyMovementCap(army: Army, heroes: Hero[], captains: CaptainType[] = [], unitTypes: UnitType[] = []) {
  return armyMovementBreakdown(army, heroes, captains, unitTypes).total
}

export const DEFAULT_ARMY_COMMAND_POINT_LIMIT = 600

export function armyCommandPoints(army: Army, units: UnitType[], heroes: Hero[]) {
  const unitPoints = army.unitSlots.reduce((total, slot) => total + (units.find((unit) => unit.id === slot.entityId)?.commandPoints ?? 0), 0)
  const heroIds = new Set<string>()
  if (army.commander?.kind === 'hero') heroIds.add(army.commander.entityId)
  for (const slot of army.heroSlots) heroIds.add(slot.entityId)
  const heroPoints = [...heroIds].reduce((total, id) => total + (heroes.find((hero) => hero.id === id)?.commandPoints ?? 0), 0)
  return unitPoints + heroPoints
}

export function armyCommandPointLimit(army: Army, heroes: Hero[] = [], captains: CaptainType[] = []) {
  if (army.commander?.kind === 'hero') return heroes.find((hero) => hero.id === army.commander!.entityId)?.commandPointLimit ?? DEFAULT_ARMY_COMMAND_POINT_LIMIT
  if (army.commander?.kind === 'captain') return captains.find((captain) => captain.id === army.commander!.entityId)?.commandPointLimit ?? DEFAULT_ARMY_COMMAND_POINT_LIMIT
  return DEFAULT_ARMY_COMMAND_POINT_LIMIT
}

export function reserveCommandPoints(reserve: ArmySlot[], units: UnitType[], heroes: Hero[]) {
  return reserve.reduce((total, slot) => total + (slot.kind === 'unit'
    ? (units.find((unit) => unit.id === slot.entityId)?.commandPoints ?? 0)
    : (heroes.find((hero) => hero.id === slot.entityId)?.commandPoints ?? 0)), 0)
}

export function armyUnitSlotCap(army: Army) {
  return army.baseUnitSlotLimit
}

export function factionArmyLimit(faction: FactionDefinition, locations: MapLocation[]) {
  return faction.baseArmyLimit + locations.filter((location) => location.side === faction.id).reduce((total, location) => total + Math.max(0, location.armyLimitBonus ?? 0), 0)
}

export function generateArmyName(
  army: Pick<Army, 'id' | 'factionId' | 'hexId' | 'commander'>,
  armies: Army[], factions: FactionDefinition[], locations: MapLocation[], heroes: Hero[],
  gridConfig: Parameters<typeof locationHexId>[1],
) {
  const hero = army.commander?.kind === 'hero' ? heroes.find((item) => item.id === army.commander!.entityId) : null
  if (hero) return `Host: ${hero.name}`
  if (army.commander?.kind === 'captain') return `Host of Captain ${army.commander.displayName ?? 'Unnamed'}`
  const location = locations.find((item) => locationHexId(item, gridConfig) === army.hexId)
  const faction = factions.find((item) => item.id === army.factionId)
  const ordinal = armies.filter((item) => item.factionId === army.factionId && item.id !== army.id).length + 1
  const suffix=ordinal%100>=11&&ordinal%100<=13?'th':ordinal%10===1?'st':ordinal%10===2?'nd':ordinal%10===3?'rd':'th'
  return location
    ? `Commanderless Host: ${location.name}`
    : `${ordinal}${suffix} Commanderless Host: ${faction?.label ?? army.factionId}`
}

export function buildBfmeArmyPayload(army: Army, unitTypes: UnitType[] = [], heroes: Hero[] = [], captains: CaptainType[] = []) {
  const commander = commanderDefinition(army, heroes, captains)
  return {
    Army_ID: army.id,
    Faction_ID: army.factionId,
    Hex_ID: army.hexId,
    Commander: army.commander?.kind === 'hero' && commander ? {
      Type: 'Hero',
      Unit_ID: army.commander.objectId,
      Base_Power: commander.battlePower,
    } : null,
    Strategic_Captain: army.commander?.kind === 'captain' && commander ? {
      Name: army.commander.displayName ?? commander.name,
      Base_Power: commander.battlePower,
      Included_In_RTS: false,
    } : null,
    Hero_Slots: army.heroSlots.map((slot, index) => {
      const hero = heroes.find((item) => item.id === slot.entityId)
      return { Slot_Index: index + 1, Type: 'Hero', Unit_ID: slot.objectId, Base_Power: hero?.battlePower ?? 0 }
    }),
    Unit_Slots: army.unitSlots.map((slot, index) => {
      const unit = unitTypes.find((item) => item.id === slot.entityId)
      return { Slot_Index: index + 1, Type: 'Horde', Unit_ID: slot.objectId, Base_Power: unit?.battlePower ?? 0 }
    }),
  }
}
