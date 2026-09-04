import type {
  Army,
  BuildingTypeDefinition,
  CampaignState,
  FactionDefinition,
  FactionId,
  Hero,
  MapLocation,
  RingForgingSettings,
  RingState,
  UnitType,
} from '../types'
import { createEmptyBattleModifiers, normalizeBattleModifiers } from './battleModifiers'
import { getEconomicType } from './economicTypes'

export function createDefaultRingForging(): RingForgingSettings {
  return {
    enabled: true,
    requiredProgress: 20,
    maxInvestmentPerTurn: 3,
    investmentCosts: [100, 250, 450],
    effects: {
      battleModifiers: { owner: { palantirIncomePerInterval: 1, commandPointBonus: 100 } },
      autoBattleBonus: 0.1,
      handicapToAllEnemies: 0.05,
    },
  }
}

export function normalizeRingForging(source: unknown): RingForgingSettings {
  const raw = (source ?? {}) as any
  const defaults = createDefaultRingForging()
  if (!raw || typeof raw !== 'object') return { ...defaults, enabled: false, effects: { ...defaults.effects, battleModifiers: createEmptyBattleModifiers() } }
  const costs = Array.isArray(raw.investmentCosts) && raw.investmentCosts.length
    ? raw.investmentCosts.slice(0, 5).map((value: unknown) => Math.max(0, Math.round(Number(value) || 0)))
    : defaults.investmentCosts
  return {
    enabled: raw.enabled !== false,
    requiredProgress: Math.max(1, Math.round(Number(raw.requiredProgress ?? defaults.requiredProgress))),
    maxInvestmentPerTurn: Math.max(1, Math.min(costs.length, Math.round(Number(raw.maxInvestmentPerTurn ?? costs.length)))),
    investmentCosts: costs,
    effects: {
      battleModifiers: normalizeBattleModifiers(raw.effects?.battleModifiers ?? defaults.effects.battleModifiers),
      autoBattleBonus: Math.max(0, Math.min(1, Number(raw.effects?.autoBattleBonus ?? defaults.effects.autoBattleBonus))),
      handicapToAllEnemies: Math.max(0, Math.min(0.95, Number(raw.effects?.handicapToAllEnemies ?? defaults.effects.handicapToAllEnemies))),
    },
  }
}

export function createDefaultRingState(): RingState {
  return { forged: false, ownerFactionId: null, carrierArmyId: null, forgedOnTurn: null, factionProgress: {} }
}

export function normalizeRingState(source: unknown): RingState {
  const raw = (source ?? {}) as any
  const progress: Record<FactionId, number> = {}
  if (raw?.factionProgress && typeof raw.factionProgress === 'object') {
    for (const [id, value] of Object.entries(raw.factionProgress)) {
      const parsed = Math.max(0, Math.round(Number(value) || 0))
      if (parsed > 0) progress[id] = parsed
    }
  }
  return {
    forged: Boolean(raw?.forged),
    ownerFactionId: typeof raw?.ownerFactionId === 'string' ? raw.ownerFactionId : null,
    carrierArmyId: typeof raw?.carrierArmyId === 'string' ? raw.carrierArmyId : null,
    forgedOnTurn: Number.isFinite(raw?.forgedOnTurn) ? Number(raw.forgedOnTurn) : null,
    factionProgress: progress,
  }
}

export function ringProgress(campaign: CampaignState, factionId: FactionId) {
  return campaign.ringState?.factionProgress[factionId] ?? 0
}

/** Free progress per turn from active Ring Forges owned by the faction. */
export function ringForgeBonusFor(campaign: CampaignState, buildingTypes: BuildingTypeDefinition[], factionId: FactionId) {
  return (campaign.buildings ?? [])
    .filter((building) => building.ownerFactionId === factionId && building.turnsRemaining <= 0)
    .reduce((total, building) => total + (buildingTypes.find((type) => type.id === building.buildingTypeId)?.effects.ringForgeBonus ?? 0), 0)
}

export function investmentCost(settings: RingForgingSettings, amount: number) {
  if (amount <= 0) return 0
  return settings.investmentCosts[Math.min(settings.investmentCosts.length, amount) - 1] ?? 0
}

function armyStrength(army: Army, unitTypes: UnitType[], heroes: Hero[]) {
  return army.unitSlots.reduce((total, slot) => total + (unitTypes.find((unit) => unit.id === slot.entityId)?.battlePower ?? 0), 0)
    + army.heroSlots.reduce((total, slot) => total + (heroes.find((hero) => hero.id === slot.entityId)?.battlePower ?? 0), 0)
    + (army.commander?.kind === 'hero' ? heroes.find((hero) => hero.id === army.commander!.entityId)?.battlePower ?? 0 : 0)
}

/**
 * Carrier priority: the strongest army standing in the faction's capital,
 * otherwise the strongest army anywhere. Null = the Ring waits in the treasury.
 */
export function chooseRingCarrier(
  factionId: FactionId,
  armies: Army[],
  locations: MapLocation[],
  unitTypes: UnitType[],
  heroes: Hero[],
  gridConfigHexOf: (location: MapLocation) => string,
): string | null {
  const own = armies.filter((army) => army.factionId === factionId)
  if (!own.length) return null
  const capitalHexes = new Set(locations
    .filter((location) => location.side === factionId && getEconomicType(location.economicType).isCapital)
    .map(gridConfigHexOf))
  const inCapital = own.filter((army) => capitalHexes.has(army.hexId))
  const pool = inCapital.length ? inCapital : own
  return pool.slice().sort((left, right) => armyStrength(right, unitTypes, heroes) - armyStrength(left, unitTypes, heroes) || left.id.localeCompare(right.id))[0]?.id ?? null
}

export function isRingCarrier(campaign: CampaignState, armyId: string) {
  return Boolean(campaign.ringState?.forged && campaign.ringState.carrierArmyId === armyId)
}

export function ringOwner(campaign: CampaignState): FactionId | null {
  return campaign.ringState?.forged ? campaign.ringState.ownerFactionId : null
}

/** Auto-battle multiplier of the Ring for one faction in one battle. */
export function ringAutoBattleMultiplier(campaign: CampaignState, settings: RingForgingSettings, factionIds: Iterable<FactionId>) {
  if (!settings.enabled || !campaign.ringState?.forged) return 1
  const owner = campaign.ringState.ownerFactionId
  if (!owner) return 1
  const ids = [...factionIds]
  if (ids.includes(owner)) return 1 + settings.effects.autoBattleBonus
  if (!ids.length) return 1
  return 1 - settings.effects.handicapToAllEnemies
}

/** The Ring hero object spawned in the RTS battle for the carrier's faction. */
export function ringHeroObjectId(faction: FactionDefinition | undefined) {
  if (!faction) return null
  if (faction.ringHeroId && faction.ringHeroId.trim()) return faction.ringHeroId.trim()
  return faction.alignment === 'evil' ? 'MordorSauron_RingHero' : 'ElvenGaladriel_RingHero'
}
