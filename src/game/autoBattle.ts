import type { Army, AutoBattleReport, BattleSlotResult, BattleType, CaptainType, Hero, MapLocation, TerrainType, UnitType } from '../types'

interface BattleContext {
  round: number
  attacker: Army
  defender: Army
  unitTypes: UnitType[]
  heroes: Hero[]
  captains: CaptainType[]
  terrain: TerrainType
  location: MapLocation | null
}

interface Combatant {
  key: string
  kind: 'unit' | 'hero' | 'captain'
  entityId: string
  objectId: string
  basePower: number
}

function hashSeed(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619) }
  return Math.abs(hash >>> 0)
}
const randomFrom = (seed: number) => { const value = Math.sin(seed * 12.9898) * 43758.5453; return value - Math.floor(value) }
const battleType = (location: MapLocation | null): BattleType => !location ? 'field' : location.economicType === 'fortress' ? 'siege' : 'settlement'

function combatants(army: Army, units: UnitType[], heroes: Hero[], captains: CaptainType[]) {
  const result: Combatant[] = []
  if (army.commander) {
    const entity = army.commander.kind === 'hero'
      ? heroes.find((item) => item.id === army.commander!.entityId && item.alive)
      : captains.find((item) => item.id === army.commander!.entityId)
    if (entity) result.push({ key: `${army.id}-commander`, kind: army.commander.kind, entityId: entity.id, objectId: army.commander.objectId ?? `strategic:${entity.id}`, basePower: entity.battlePower })
  }
  for (const slot of army.heroSlots) {
    const hero = heroes.find((item) => item.id === slot.entityId && item.alive)
    if (hero) result.push({ key: slot.slotId, kind: 'hero', entityId: hero.id, objectId: hero.objectId, basePower: hero.battlePower })
  }
  for (const slot of army.unitSlots) {
    const unit = units.find((item) => item.id === slot.entityId)
    if (unit) result.push({ key: slot.slotId, kind: 'unit', entityId: unit.id, objectId: unit.objectId, basePower: unit.battlePower })
  }
  return result
}

function armyPower(army: Army, units: UnitType[], heroes: Hero[], captains: CaptainType[], type: BattleType, terrain: TerrainType, defender: boolean) {
  const members = combatants(army, units, heroes, captains)
  let power = members.reduce((total, item) => total + item.basePower, 0)
  let siegePower = army.unitSlots.reduce((total, slot) => total + (units.find((item) => item.id === slot.entityId)?.siegePower ?? 0), 0)
  const commander = army.commander?.kind === 'hero'
    ? heroes.find((item) => item.id === army.commander?.entityId && item.alive)
    : captains.find((item) => item.id === army.commander?.entityId)
  power *= 1 + Math.min(.3, (commander?.command ?? 0) / 100)
  if (defender) {
    if (terrain === 'forest') power *= 1.08
    if (terrain === 'hills') power *= 1.12
    if (terrain === 'mountains') power *= 1.2
    if (terrain === 'swamp') power *= 1.06
    if (type === 'settlement') power *= 1.12
    if (type === 'siege') power *= 1.32
  } else {
    if (terrain === 'mountains') power *= .88
    if (terrain === 'swamp') power *= .84
    if (type === 'siege') power *= Math.min(1, .72 + siegePower / 80)
  }
  return Math.max(1, power)
}

function applyCasualties(members: Combatant[], lossPressure: number, winner: boolean, seed: number): BattleSlotResult[] {
  const result = members.map((member, index) => {
    const resilience = Math.max(.32, Math.min(1.25, Math.sqrt(110 / Math.max(1, member.basePower))))
    const commanderProtection = member.key.endsWith('-commander') ? .7 : 1
    const destroyed = randomFrom(seed + index * 19) < Math.min(.96, lossPressure * resilience * commanderProtection)
    return { slotId: member.key, objectId: member.objectId, kind: member.kind, destroyed } as BattleSlotResult
  })
  if (!winner && lossPressure >= .5 && result.length && !result.some((item) => item.destroyed)) {
    let weakest = 0
    members.forEach((member, index) => { if (member.basePower < members[weakest].basePower) weakest = index })
    result[weakest] = { ...result[weakest], destroyed: true }
  }
  return result
}

function applyResults(army: Army, results: BattleSlotResult[], heroes: Hero[], captains: CaptainType[]) {
  const destroyed = new Set(results.filter((item) => item.destroyed).map((item) => item.slotId))
  let heroSlots = army.heroSlots.filter((slot) => !destroyed.has(slot.slotId))
  const unitSlots = army.unitSlots.filter((slot) => !destroyed.has(slot.slotId))
  let commander = destroyed.has(`${army.id}-commander`) ? null : army.commander
  if (!commander) {
    const promoted = heroSlots.shift()
    if (promoted) commander = { kind: 'hero' as const, entityId: promoted.entityId, objectId: promoted.objectId }
  }
  return { ...army, commander, heroSlots, unitSlots }
}

export function calculateAutoBattle(context: BattleContext) {
  const type = battleType(context.location)
  const seed = hashSeed(`${context.round}:${context.attacker.id}:${context.defender.id}:${context.terrain}:${context.location?.id ?? 'field'}`)
  const attackerPower = armyPower(context.attacker, context.unitTypes, context.heroes, context.captains, type, context.terrain, false) * (.93 + randomFrom(seed) * .14)
  const defenderPower = armyPower(context.defender, context.unitTypes, context.heroes, context.captains, type, context.terrain, true) * (.93 + randomFrom(seed + 1) * .14)
  const attackerWon = attackerPower >= defenderPower
  const ratio = Math.min(2.5, Math.max(.4, attackerPower / defenderPower))
  const attackerPressure = attackerWon ? Math.min(.42, Math.max(.12, .28 / ratio + randomFrom(seed + 2) * .07)) : Math.min(.9, Math.max(.48, .57 + (1 / ratio - 1) * .18 + randomFrom(seed + 2) * .1))
  const defenderPressure = attackerWon ? Math.min(.9, Math.max(.48, .57 + (ratio - 1) * .18 + randomFrom(seed + 3) * .1)) : Math.min(.42, Math.max(.12, .28 * ratio + randomFrom(seed + 3) * .07))
  const attackerMembers = combatants(context.attacker, context.unitTypes, context.heroes, context.captains)
  const defenderMembers = combatants(context.defender, context.unitTypes, context.heroes, context.captains)
  const attackerLosses = applyCasualties(attackerMembers, attackerPressure, attackerWon, seed + 10)
  const defenderLosses = applyCasualties(defenderMembers, defenderPressure, !attackerWon, seed + 20)
  const attacker = applyResults(context.attacker, attackerLosses, context.heroes, context.captains)
  const defender = applyResults(context.defender, defenderLosses, context.heroes, context.captains)
  const report: AutoBattleReport = {
    id: `battle-${context.round}-${seed.toString(36)}`,
    conflictId: null,
    round: context.round,
    battleType: type,
    terrain: context.terrain,
    locationId: context.location?.id ?? null,
    attackerArmyId: context.attacker.id,
    defenderArmyId: context.defender.id,
    attackerArmyIds: [context.attacker.id],
    defenderArmyIds: [context.defender.id],
    attackerReinforcementArmyIds: [],
    defenderReinforcementArmyIds: [],
    attackerFactionId: context.attacker.factionId,
    defenderFactionId: context.defender.factionId,
    attackerPower: Math.round(attackerPower),
    defenderPower: Math.round(defenderPower),
    defenseBonus: 0,
    winnerArmyId: attackerWon ? context.attacker.id : context.defender.id,
    loserArmyId: attackerWon ? context.defender.id : context.attacker.id,
    winnerSide: attackerWon ? 'good' : 'evil',
    attackerLosses,
    defenderLosses,
    garrisonLosses: [],
    attackerDestroyed: !attacker.commander,
    defenderDestroyed: !defender.commander,
    capturedLocationId: null,
    summary: `${attackerWon ? context.attacker.name : context.defender.name} одерживает победу в ${type === 'siege' ? 'осаде' : type === 'settlement' ? 'бою за поселение' : 'полевом сражении'}.`,
    timestamp: new Date().toISOString(),
  }
  return {
    report,
    attacker: { ...attacker, status: attackerWon ? 'marched' as const : 'retreating' as const, movementRemaining: 0 },
    defender: { ...defender, status: attackerWon ? 'retreating' as const : 'marched' as const, movementRemaining: 0 },
    attackerWon,
  }
}
