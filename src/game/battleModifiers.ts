import type {
  BattleModifierSet,
  BuildingInstance,
  BuildingTypeDefinition,
  CampaignState,
  EconomicTypeDefinition,
  FactionId,
  MapLocation,
  OwnerBattleModifiers,
  PalantirSettings,
  Region,
  RingForgingSettings,
} from '../types'
import { getEconomicType } from './economicTypes'

export const EMPTY_OWNER_MODIFIERS: OwnerBattleModifiers = {}

export function createEmptyBattleModifiers(): BattleModifierSet {
  return { owner: {} }
}

export const DEFAULT_PALANTIR_SETTINGS: PalantirSettings = {
  baseStartingPoints: 0,
  maxStartingPointsFromModifiers: 10,
  incomeIntervalMinutes: 2,
  baseIncomePerInterval: 0,
  maxIncomePerIntervalFromModifiers: 3,
}

export function normalizeOwnerModifiers(source: unknown): OwnerBattleModifiers {
  const raw = (source ?? {}) as Record<string, unknown>
  const number = (value: unknown, min: number, max: number) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed === 0) return undefined
    return Math.max(min, Math.min(max, parsed))
  }
  const result: OwnerBattleModifiers = {}
  const startingResources = number(raw.startingResources, 0, 20000)
  if (startingResources !== undefined) result.startingResources = Math.round(startingResources)
  const commandPointBonus = number(raw.commandPointBonus, 0, 5000)
  if (commandPointBonus !== undefined) result.commandPointBonus = Math.round(commandPointBonus)
  const palantirStartingPoints = number(raw.palantirStartingPoints, 0, 10)
  if (palantirStartingPoints !== undefined) result.palantirStartingPoints = Math.round(palantirStartingPoints)
  const palantirIncomePerInterval = number(raw.palantirIncomePerInterval, 0, 5)
  if (palantirIncomePerInterval !== undefined) result.palantirIncomePerInterval = Math.round(palantirIncomePerInterval)
  if (raw.signalFire === true) result.signalFire = true
  const defenseBonus = number(raw.defenseBonus, 0, 1)
  if (defenseBonus !== undefined) result.defenseBonus = defenseBonus
  const ambushBonus = number(raw.ambushBonus, 0, 1)
  if (ambushBonus !== undefined) result.ambushBonus = ambushBonus
  const terrainDebuff = number(raw.terrainDebuff, 0, 1)
  if (terrainDebuff !== undefined) result.terrainDebuff = terrainDebuff
  if (typeof raw.spawnBonus === 'string' && raw.spawnBonus.trim()) result.spawnBonus = raw.spawnBonus.trim()
  return result
}

export function normalizeBattleModifiers(source: unknown): BattleModifierSet {
  const raw = (source ?? {}) as { owner?: unknown }
  return { owner: normalizeOwnerModifiers(raw.owner) }
}

/** Sum of every source. Palantir values are capped by palantirSettings later. */
export function mergeOwnerModifiers(...sources: Array<OwnerBattleModifiers | undefined | null>): OwnerBattleModifiers {
  const result: OwnerBattleModifiers = {}
  const spawnBonuses: string[] = []
  for (const source of sources) {
    if (!source) continue
    if (source.startingResources) result.startingResources = (result.startingResources ?? 0) + source.startingResources
    if (source.commandPointBonus) result.commandPointBonus = (result.commandPointBonus ?? 0) + source.commandPointBonus
    if (source.palantirStartingPoints) result.palantirStartingPoints = (result.palantirStartingPoints ?? 0) + source.palantirStartingPoints
    if (source.palantirIncomePerInterval) result.palantirIncomePerInterval = (result.palantirIncomePerInterval ?? 0) + source.palantirIncomePerInterval
    if (source.signalFire) result.signalFire = true
    if (source.defenseBonus) result.defenseBonus = (result.defenseBonus ?? 0) + source.defenseBonus
    if (source.ambushBonus) result.ambushBonus = (result.ambushBonus ?? 0) + source.ambushBonus
    if (source.terrainDebuff) result.terrainDebuff = Math.max(result.terrainDebuff ?? 0, source.terrainDebuff)
    if (source.spawnBonus) spawnBonuses.push(source.spawnBonus)
  }
  if (spawnBonuses.length) result.spawnBonus = [...new Set(spawnBonuses.join(',').split(',').map((tag) => tag.trim()).filter(Boolean))].join(',')
  return result
}

export function clampPalantir(modifiers: OwnerBattleModifiers, settings: PalantirSettings): OwnerBattleModifiers {
  const start = Math.min(settings.maxStartingPointsFromModifiers, modifiers.palantirStartingPoints ?? 0) + settings.baseStartingPoints
  const income = Math.min(settings.maxIncomePerIntervalFromModifiers, modifiers.palantirIncomePerInterval ?? 0) + settings.baseIncomePerInterval
  const result = { ...modifiers }
  if (start > 0) result.palantirStartingPoints = Math.max(0, Math.round(start)); else delete result.palantirStartingPoints
  if (income > 0) result.palantirIncomePerInterval = Math.max(0, Math.round(income)); else delete result.palantirIncomePerInterval
  return result
}

/** Strategic weight of palantir access in the auto-battle formula. */
export function palantirAutoBattleWeight(modifiers: OwnerBattleModifiers, settings: PalantirSettings) {
  const start = Math.min(settings.maxStartingPointsFromModifiers + settings.baseStartingPoints, modifiers.palantirStartingPoints ?? 0)
  const income = Math.min(settings.maxIncomePerIntervalFromModifiers + settings.baseIncomePerInterval, modifiers.palantirIncomePerInterval ?? 0)
  return start * 0.004 + income * 0.03
}

export function economicTypeModifiers(location: MapLocation | null | undefined, economicTypes?: EconomicTypeDefinition[]): OwnerBattleModifiers {
  if (!location) return {}
  const definition = economicTypes?.find((item) => item.id === location.economicType) ?? getEconomicType(location.economicType)
  return definition.battleModifiers?.owner ?? {}
}

export function regionFullControlModifiers(region: Region | null | undefined, factionId: FactionId | null | undefined): OwnerBattleModifiers {
  if (!region || !factionId) return {}
  if (region.ownerFactionId !== factionId) return {}
  return region.fullControlBonus?.battleModifiers?.owner ?? {}
}

export function regionAutoBattleBonus(region: Region | null | undefined, factionId: FactionId | null | undefined) {
  if (!region || !factionId || region.ownerFactionId !== factionId) return 0
  return region.fullControlBonus?.autoBattleBonus ?? 0
}

export function activeBuildingsAt(campaign: CampaignState, locationId: string | null | undefined, factionId?: FactionId | null) {
  if (!locationId) return [] as BuildingInstance[]
  return (campaign.buildings ?? []).filter((building) => building.locationId === locationId
    && building.turnsRemaining <= 0
    && (!factionId || building.ownerFactionId === factionId))
}

export function buildingModifiers(buildings: BuildingInstance[], buildingTypes: BuildingTypeDefinition[]): OwnerBattleModifiers {
  return mergeOwnerModifiers(...buildings.map((building) => buildingTypes.find((type) => type.id === building.buildingTypeId)?.effects.battleModifiers.owner))
}

export function ringModifiers(ringForging: RingForgingSettings, isRingOwner: boolean): OwnerBattleModifiers {
  if (!ringForging.enabled || !isRingOwner) return {}
  return ringForging.effects.battleModifiers.owner ?? {}
}

export interface OwnerBonusContext {
  location: MapLocation | null
  region: Region | null
  factionId: FactionId | null
  campaign: CampaignState
  buildingTypes: BuildingTypeDefinition[]
  economicTypes?: EconomicTypeDefinition[]
  ringForging: RingForgingSettings
  palantirSettings: PalantirSettings
}

/**
 * Full context layer for the owner of a location: economic type + full region
 * control + active buildings + the Ring. Palantir values are capped at the end.
 */
export function collectOwnerModifiers(context: OwnerBonusContext): OwnerBattleModifiers {
  const ownerFactionId = context.location?.side ?? context.factionId ?? null
  const buildings = activeBuildingsAt(context.campaign, context.location?.id, ownerFactionId)
  const ringOwned = Boolean(context.campaign.ringState?.forged && ownerFactionId && context.campaign.ringState.ownerFactionId === ownerFactionId)
  const merged = mergeOwnerModifiers(
    economicTypeModifiers(context.location, context.economicTypes),
    regionFullControlModifiers(context.region, ownerFactionId),
    buildingModifiers(buildings, context.buildingTypes),
    ringModifiers(context.ringForging, ringOwned),
  )
  return clampPalantir(merged, context.palantirSettings)
}
