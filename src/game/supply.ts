import type {
  Army,
  AttackerSupplyContext,
  BuildingTypeDefinition,
  CampaignState,
  EconomicTypeDefinition,
  FactionId,
  MapLocation,
  OwnerBattleModifiers,
  PalantirSettings,
  SupplyAmount,
  SupplyPool,
  SupplySettings,
} from '../types'
import { activeBuildingsAt, buildingModifiers, clampPalantir, economicTypeModifiers, mergeOwnerModifiers } from './battleModifiers'

export const DEFAULT_SUPPLY_SETTINGS: SupplySettings = {
  enabled: true,
  decayPerHex: 0.05,
  decayPerTurn: 0.15,
  minRatio: 0,
  supplyRatio: 0.5,
  requiresOwnedOrigin: true,
  captureCountsAsOwned: false,
  refillOnTransit: true,
  refillOnTurnStart: true,
  refillOnFormation: true,
}

const ratio = (value: unknown, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)

/** Старые моды без supplySettings получают рабочий блок по умолчанию. */
export function normalizeSupplySettings(source: unknown): SupplySettings {
  const raw = (source ?? {}) as Record<string, unknown>
  return {
    enabled: flag(raw.enabled, DEFAULT_SUPPLY_SETTINGS.enabled),
    decayPerHex: Math.max(0, Math.min(1, ratio(raw.decayPerHex, DEFAULT_SUPPLY_SETTINGS.decayPerHex))),
    decayPerTurn: Math.max(0, Math.min(1, ratio(raw.decayPerTurn, DEFAULT_SUPPLY_SETTINGS.decayPerTurn))),
    minRatio: Math.max(0, Math.min(1, ratio(raw.minRatio, DEFAULT_SUPPLY_SETTINGS.minRatio))),
    supplyRatio: Math.max(0, Math.min(1, ratio(raw.supplyRatio, DEFAULT_SUPPLY_SETTINGS.supplyRatio))),
    requiresOwnedOrigin: flag(raw.requiresOwnedOrigin, DEFAULT_SUPPLY_SETTINGS.requiresOwnedOrigin),
    captureCountsAsOwned: flag(raw.captureCountsAsOwned, DEFAULT_SUPPLY_SETTINGS.captureCountsAsOwned),
    refillOnTransit: flag(raw.refillOnTransit, DEFAULT_SUPPLY_SETTINGS.refillOnTransit),
    refillOnTurnStart: flag(raw.refillOnTurnStart, DEFAULT_SUPPLY_SETTINGS.refillOnTurnStart),
    refillOnFormation: flag(raw.refillOnFormation, DEFAULT_SUPPLY_SETTINGS.refillOnFormation),
  }
}

/** Всё, что нужно расчёту снабжения; собирается один раз на действие. */
export interface SupplyWorld {
  campaign: CampaignState
  buildingTypes: BuildingTypeDefinition[]
  economicTypes?: EconomicTypeDefinition[]
  /** Гекс локации -> локация: по нему ищутся пополнения на маршруте. */
  locationsByHex: Map<string, MapLocation>
  /** Идентификатор локации -> локация: по нему находится точка отправления. */
  locationById: Map<string, MapLocation>
  settings: SupplySettings
}

const EMPTY_AMOUNT: SupplyAmount = {}

/** Снабжение — только экономическая часть бонусов локации (§1.2). */
function economicPart(modifiers: OwnerBattleModifiers): SupplyAmount {
  const result: SupplyAmount = {}
  if (modifiers.startingResources) result.startingResources = modifiers.startingResources
  if (modifiers.commandPointBonus) result.commandPointBonus = modifiers.commandPointBonus
  if (modifiers.palantirStartingPoints) result.palantirStartingPoints = modifiers.palantirStartingPoints
  if (modifiers.palantirIncomePerInterval) result.palantirIncomePerInterval = modifiers.palantirIncomePerInterval
  return result
}

function isEmpty(amount: SupplyAmount) {
  return !amount.startingResources && !amount.commandPointBonus && !amount.palantirStartingPoints && !amount.palantirIncomePerInterval
}

/** Припасы, умноженные на коэффициент (перевозка, пополнение у союзников). */
export function scaleSupply(amount: SupplyAmount, factor: number): SupplyAmount {
  const result: SupplyAmount = {}
  if (amount.startingResources) result.startingResources = Math.floor(amount.startingResources * factor)
  if (amount.commandPointBonus) result.commandPointBonus = Math.floor(amount.commandPointBonus * factor)
  if (amount.palantirStartingPoints) result.palantirStartingPoints = Math.floor(amount.palantirStartingPoints * factor)
  if (amount.palantirIncomePerInterval) result.palantirIncomePerInterval = Math.floor(amount.palantirIncomePerInterval * factor)
  return result
}

/** Локация считается своей: по принадлежности или (опционально) по захвату. */
export function locationSuppliesFaction(location: MapLocation, factionId: FactionId, settings: SupplySettings) {
  if (!settings.requiresOwnedOrigin && !settings.captureCountsAsOwned) return true
  return location.side === factionId
}

/**
 * Припасы, которые армия может взять в локации: экономический тип + постройки
 * владельца. Сигнальный огонь, оборона стен и засада не переносятся.
 */
export function supplyAmountAt(
  location: MapLocation | null | undefined,
  factionId: FactionId,
  world: SupplyWorld,
): SupplyAmount {
  if (!location) return EMPTY_AMOUNT
  if (!locationSuppliesFaction(location, factionId, world.settings)) return EMPTY_AMOUNT
  const buildings = activeBuildingsAt(world.campaign, location.id, factionId)
  return economicPart(mergeOwnerModifiers(
    economicTypeModifiers(location, world.economicTypes),
    buildingModifiers(buildings, world.buildingTypes),
  ))
}

/** Фиксированный бонус построек точки отправления — без деградации (§3.1). */
export function fixedSupplyAt(
  location: MapLocation | null | undefined,
  factionId: FactionId,
  world: SupplyWorld,
): SupplyAmount {
  if (!location) return EMPTY_AMOUNT
  const buildings = activeBuildingsAt(world.campaign, location.id, factionId)
  return economicPart(mergeOwnerModifiers(
    ...buildings.map((building) => world.buildingTypes.find((type) => type.id === building.buildingTypeId)?.effects.attackSupplyModifiers),
  ))
}

/** Снабжение выдаётся полным при формировании или пополнении. */
export function createSupplyPool(
  location: MapLocation | null | undefined,
  factionId: FactionId,
  round: number,
  world: SupplyWorld,
): SupplyPool | null {
  if (!world.settings.enabled || !location) return null
  const initialAmount = supplyAmountAt(location, factionId, world)
  if (isEmpty(initialAmount)) return null
  return { sourceLocationId: location.id, sourceRound: round, initialAmount, hexesTravelled: 0, turnsElapsed: 0 }
}

/**
 * Доля оставшегося снабжения. Гексы — расход на марше, ходы — календарное
 * время: даже стоящая армия съедает запасы.
 */
export function supplyDecayFactor(pool: SupplyPool, settings: SupplySettings) {
  const factor = 1 - pool.hexesTravelled * settings.decayPerHex - pool.turnsElapsed * settings.decayPerTurn
  return Math.max(settings.minRatio, Math.min(1, factor))
}

/** Что осталось к текущему моменту, уже с учётом потерь при перевозке. */
export function currentSupplyAmount(pool: SupplyPool, settings: SupplySettings): SupplyAmount {
  return scaleSupply(pool.initialAmount, supplyDecayFactor(pool, settings) * settings.supplyRatio)
}

function clonePool(pool: SupplyPool): SupplyPool {
  return { ...pool, initialAmount: { ...pool.initialAmount } }
}

/** Армия прошла `hexes` гексов; полностью истраченное снабжение исчезает. */
export function travelSupply(pool: SupplyPool | null, hexes: number, settings: SupplySettings): SupplyPool | null {
  if (!pool || hexes <= 0) return pool
  const next = clonePool(pool)
  next.hexesTravelled += hexes
  return supplyDecayFactor(next, settings) <= settings.minRatio ? null : next
}

/** Прошёл ход: календарное время тратит запасы даже на месте. */
export function tickSupply(pool: SupplyPool | null, settings: SupplySettings): SupplyPool | null {
  if (!pool) return null
  const next = clonePool(pool)
  next.turnsElapsed += 1
  return supplyDecayFactor(next, settings) <= settings.minRatio ? null : next
}

export interface SupplyStepResult {
  pool: SupplyPool | null
  /** Идентификатор локации, где снабжение было пополнено. */
  refilledAt: string | null
  /** Припасы исчерпаны полностью — для записи в журнал. */
  depleted: boolean
}

/**
 * Пополнение на маршруте: берётся последняя своя локация на пути, с неё
 * счётчики гексов и ходов обнуляются. Захват вражеской локации в этом же ходу
 * не пополняет — город ещё в хаосе.
 */
export function travelAlongPath(
  pool: SupplyPool | null,
  path: string[],
  factionId: FactionId,
  round: number,
  world: SupplyWorld,
): SupplyStepResult {
  const stepped = path.length > 1 ? path.length - 1 : 0
  let refilledAt: string | null = null
  let next: SupplyPool | null = pool
  if (world.settings.refillOnTransit) {
    for (const hexId of path) {
      const location = world.locationsByHex.get(hexId)
      if (!location) continue
      const amount = supplyAmountAt(location, factionId, world)
      if (isEmpty(amount)) continue
      next = { sourceLocationId: location.id, sourceRound: round, initialAmount: amount, hexesTravelled: 0, turnsElapsed: 0 }
      refilledAt = location.id
    }
  }
  const before = next
  next = travelSupply(next, stepped, world.settings)
  return { pool: next, refilledAt, depleted: Boolean(before) && !next }
}

/**
 * Начало хода: стоящая на своей локации армия пополняется полностью, остальные
 * просто тратят ещё один ход припасов.
 */
export function turnStartSupply(
  army: Army,
  location: MapLocation | null | undefined,
  round: number,
  world: SupplyWorld,
): SupplyStepResult {
  if (world.settings.refillOnTurnStart && location) {
    const amount = supplyAmountAt(location, army.factionId, world)
    if (!isEmpty(amount)) {
      return {
        pool: { sourceLocationId: location.id, sourceRound: round, initialAmount: amount, hexesTravelled: 0, turnsElapsed: 0 },
        refilledAt: location.id,
        depleted: false,
      }
    }
  }
  const before = army.supplyPool
  const next = tickSupply(before, world.settings)
  return { pool: next, refilledAt: null, depleted: Boolean(before) && !next }
}

/**
 * Слияние двух снабжений: припасы берём у более свежего, а счётчики пути и
 * времени — худшие из двух. Армия не обнуляет пройденный путь разделением.
 */
export function mergeSupplyPools(left: SupplyPool | null, right: SupplyPool | null, settings: SupplySettings): SupplyPool | null {
  if (!left) return right ? clonePool(right) : null
  if (!right) return clonePool(left)
  const fresh = supplyDecayFactor(left, settings) >= supplyDecayFactor(right, settings) ? left : right
  return {
    sourceLocationId: fresh.sourceLocationId,
    sourceRound: fresh.sourceRound,
    initialAmount: { ...fresh.initialAmount },
    hexesTravelled: Math.max(left.hexesTravelled, right.hexesTravelled),
    turnsElapsed: Math.max(left.turnsElapsed, right.turnsElapsed),
  }
}

/**
 * Бонусы атакующего: остаток снабжения (с деградацией и перевозкой) плюс
 * фиксированный бонус построек точки отправления. Локационные бонусы
 * атакующему недоступны — сигнального огня, стен и засады у него нет.
 */
export function attackerSupplyModifiers(
  pool: SupplyPool | null,
  sourceLocation: MapLocation | null | undefined,
  factionId: FactionId,
  world: SupplyWorld,
  palantirSettings: PalantirSettings,
): OwnerBattleModifiers {
  if (!world.settings.enabled) return {}
  const carried = pool ? currentSupplyAmount(pool, world.settings) : EMPTY_AMOUNT
  const fixed = fixedSupplyAt(sourceLocation, factionId, world)
  const merged = economicPart(mergeOwnerModifiers(carried, fixed))
  if (isEmpty(merged)) return {}
  return clampPalantir(merged, palantirSettings)
}

/**
 * Стратегический вес бонусов атакующего (§5): каждые 100 ресурсов +3 %,
 * каждые 50 командных очков +2 %, каждые 5 очков палантира +2 %, каждый пункт
 * прироста палантира +3 %.
 */
export function supplyAutoBattleWeight(modifiers: OwnerBattleModifiers) {
  return (modifiers.startingResources ?? 0) / 100 * 0.03
    + (modifiers.commandPointBonus ?? 0) / 50 * 0.02
    + (modifiers.palantirStartingPoints ?? 0) / 5 * 0.02
    + (modifiers.palantirIncomePerInterval ?? 0) * 0.03
}

/** Лучшее снабжение среди атакующих армий — оно и определяет бонус атаки. */
export function bestAttackerPool(armies: Army[], settings: SupplySettings): Army | null {
  let best: Army | null = null
  let bestFactor = -1
  for (const army of armies) {
    if (!army.supplyPool) continue
    const factor = supplyDecayFactor(army.supplyPool, settings)
    if (factor > bestFactor) {
      bestFactor = factor
      best = army
    }
  }
  return best
}

/** Полный контекст снабжения атакующего — для интерфейса и battle.json (§10). */
export function attackerSupplyContext(
  armies: Army[],
  round: number,
  world: SupplyWorld,
  palantirSettings: PalantirSettings,
): AttackerSupplyContext | null {
  if (!world.settings.enabled) return null
  const army = bestAttackerPool(armies, world.settings)
  const pool = army?.supplyPool ?? null
  const factionId = army?.factionId ?? null
  const sourceLocation = pool && factionId ? world.locationById.get(pool.sourceLocationId) ?? null : null
  const decayFactor = pool ? supplyDecayFactor(pool, world.settings) : 0
  const afterDecayAndRatio = pool ? currentSupplyAmount(pool, world.settings) : EMPTY_AMOUNT
  const fixedFromBuildings = sourceLocation && factionId ? fixedSupplyAt(sourceLocation, factionId, world) : EMPTY_AMOUNT
  const finalAttackerModifiers = pool && factionId
    ? attackerSupplyModifiers(pool, sourceLocation, factionId, world, palantirSettings)
    : {}
  return {
    sourceLocationId: pool?.sourceLocationId ?? null,
    sourceRound: pool?.sourceRound ?? null,
    battleRound: round,
    hexesTravelled: pool?.hexesTravelled ?? 0,
    turnsElapsed: pool?.turnsElapsed ?? 0,
    decayFactor: Math.round(decayFactor * 1000) / 1000,
    supplyRatio: world.settings.supplyRatio,
    initialAmount: pool ? { ...pool.initialAmount } : EMPTY_AMOUNT,
    afterDecayAndRatio,
    fixedFromBuildings,
    finalAttackerModifiers,
  }
}
