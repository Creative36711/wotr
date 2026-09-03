import type {
  ArmyUpgradeId,
  BuildingInstance,
  BuildingTypeDefinition,
  CampaignState,
  FactionId,
  LocalizedTranslations,
  MapLocation,
  SettlementType,
} from '../types'
import { getEconomicType } from './economicTypes'
import { createEmptyBattleModifiers, normalizeBattleModifiers } from './battleModifiers'

const ru = (value: string): LocalizedTranslations => ({ ru: value })

/** Default building slots per economic type; overridable in world.json. */
export const DEFAULT_BUILDING_SLOTS: Record<SettlementType, number> = {
  capital: 4, fortress: 3, city: 3, mine: 2, port: 2,
  farm: 1, village: 1, camp: 1, signal_tower: 1, ruins: 1, crossroads: 1, ford: 1, pass: 1, monument: 1,
  wilderness: 0, swamp: 0, forest: 0, mountains: 0,
}

const type = (
  id: string, name: string, nameRu: string, description: string, descriptionRu: string, icon: string,
  cost: number, buildTime: number, economic: SettlementType[],
  effects: Partial<BuildingTypeDefinition['effects']>, extra: Partial<BuildingTypeDefinition> = {},
): BuildingTypeDefinition => ({
  id, name, nameTranslations: ru(nameRu),
  description, descriptionTranslations: ru(descriptionRu), icon,
  cost, buildTime,
  allowedStructuralTypes: ['domain', 'stronghold'],
  allowedEconomicTypes: economic,
  maxPerLocation: 1, maxPerFaction: 0, destroyedOnCapture: true,
  effects: {
    armyUpgrades: [], battleModifiers: createEmptyBattleModifiers(), recruitLevelBonus: 0, ringForgeBonus: 0,
    ...effects,
  },
  ...extra,
})

const MILITARY: SettlementType[] = ['capital', 'city', 'fortress', 'mine', 'camp']
const BROAD: SettlementType[] = ['capital', 'city', 'fortress', 'mine', 'port', 'farm', 'village', 'camp', 'signal_tower', 'crossroads', 'pass']

export const DEFAULT_BUILDING_TYPES: BuildingTypeDefinition[] = [
  type('forge', 'Forge', 'Кузница', 'Permanently grants the armor upgrade to every unit of the owner stationed at this location.', 'Навсегда выдаёт апгрейд брони всем отрядам владельца, стоящим в этой локации.', '⚒', 150, 2, MILITARY, { armyUpgrades: ['armorUpgrade'] }),
  type('armory', 'Armory', 'Оружейная', 'Permanently grants the weapon upgrade to every unit of the owner stationed at this location.', 'Навсегда выдаёт апгрейд оружия всем отрядам владельца, стоящим в этой локации.', '⚔', 150, 2, MILITARY, { armyUpgrades: ['weaponUpgrade'] }),
  type('banner-workshop', 'Banner Workshop', 'Знамённая мастерская', 'Permanently grants banner carriers to every unit of the owner stationed at this location.', 'Навсегда выдаёт знамёна всем отрядам владельца, стоящим в этой локации.', '⚑', 200, 2, ['capital', 'city', 'fortress'], { armyUpgrades: ['bannerUpgrade'] }),
  type('beacon', 'Beacon', 'Сигнальный огонь', 'In a real BFME battle for this location the owner gets a signal fire.', 'В настоящей битве BFME за эту локацию владелец получает сигнальный огонь.', '🔥', 100, 1, BROAD, { battleModifiers: { owner: { signalFire: true } } }),
  type('training-camp', 'Training Camp', 'Тренировочный лагерь', 'Units recruited here start one veterancy level higher.', 'Отряды, нанятые в этой локации, начинают на один уровень ветеранства выше.', '⛺', 200, 3, MILITARY, { recruitLevelBonus: 1 }),
  type('storehouse', 'Storehouse', 'Склад', 'The owner starts a BFME battle here with +150 extra resources.', 'Владелец начинает битву BFME здесь с дополнительными 150 ресурсов.', '▣', 100, 1, BROAD, { battleModifiers: { owner: { startingResources: 150 } } }),
  type('barracks-annex', 'Barracks Annex', 'Пристройка казарм', 'Raises the owner command point limit by 100 in a BFME battle here.', 'Повышает лимит командных очков владельца на 100 в битве BFME здесь.', '▤', 150, 2, MILITARY, { battleModifiers: { owner: { commandPointBonus: 100 } } }),
  type('palantir-tower', 'Palantir Tower', 'Башня палантира', 'Grants +3 starting palantir points and +1 income per tick in a BFME battle here.', 'Даёт +3 стартовых очка палантира и +1 к приросту в битве BFME здесь.', '◍', 250, 2, ['capital', 'city', 'fortress', 'signal_tower'], { battleModifiers: { owner: { palantirStartingPoints: 3, palantirIncomePerInterval: 1 } } }),
  type('ring-forge', 'Ring Forge', 'Кольцекузня', 'Advances the One Ring forging by 1 progress every turn, for free.', 'Каждый ход бесплатно продвигает ковку Кольца Всевластья на 1 единицу.', '◎', 300, 3, ['capital', 'fortress'], { ringForgeBonus: 1 }, { maxPerFaction: 1, destroyedOnCapture: true }),
]

export function createDefaultBuildingTypes(): BuildingTypeDefinition[] {
  return DEFAULT_BUILDING_TYPES.map(cloneBuildingType)
}

export function cloneBuildingType(item: BuildingTypeDefinition): BuildingTypeDefinition {
  return {
    ...item,
    nameTranslations: { ...item.nameTranslations },
    descriptionTranslations: { ...item.descriptionTranslations },
    allowedStructuralTypes: [...item.allowedStructuralTypes],
    allowedEconomicTypes: [...item.allowedEconomicTypes],
    effects: {
      ...item.effects,
      armyUpgrades: [...item.effects.armyUpgrades],
      battleModifiers: { owner: { ...item.effects.battleModifiers.owner } },
    },
  }
}

const UPGRADE_IDS: ArmyUpgradeId[] = ['weaponUpgrade', 'armorUpgrade', 'bannerUpgrade']

/** Old mods have no buildingTypes at all — an empty list is a valid default. */
export function normalizeBuildingTypes(source: unknown): BuildingTypeDefinition[] {
  if (!Array.isArray(source)) return []
  const used = new Set<string>()
  return source.flatMap((raw: any) => {
    const id = typeof raw?.id === 'string' ? raw.id.trim() : ''
    if (!id || used.has(id)) return []
    used.add(id)
    const effects = raw.effects ?? {}
    return [{
      id,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : id,
      nameTranslations: { ...(raw.nameTranslations ?? {}) },
      description: typeof raw.description === 'string' ? raw.description : '',
      descriptionTranslations: { ...(raw.descriptionTranslations ?? {}) },
      icon: typeof raw.icon === 'string' && raw.icon ? raw.icon : '▣',
      cost: Math.max(0, Math.round(Number(raw.cost ?? 100))),
      buildTime: Math.max(0, Math.min(20, Math.round(Number(raw.buildTime ?? 1)))),
      allowedStructuralTypes: Array.isArray(raw.allowedStructuralTypes) && raw.allowedStructuralTypes.length
        ? raw.allowedStructuralTypes.filter((value: unknown) => value === 'domain' || value === 'stronghold')
        : ['domain', 'stronghold'],
      allowedEconomicTypes: Array.isArray(raw.allowedEconomicTypes) ? raw.allowedEconomicTypes : [],
      maxPerLocation: Math.max(0, Math.round(Number(raw.maxPerLocation ?? 1))),
      maxPerFaction: Math.max(0, Math.round(Number(raw.maxPerFaction ?? 0))),
      destroyedOnCapture: raw.destroyedOnCapture !== false,
      effects: {
        armyUpgrades: Array.isArray(effects.armyUpgrades) ? UPGRADE_IDS.filter((upgrade) => effects.armyUpgrades.includes(upgrade)) : [],
        battleModifiers: normalizeBattleModifiers(effects.battleModifiers),
        recruitLevelBonus: Math.max(0, Math.min(9, Math.round(Number(effects.recruitLevelBonus ?? 0)))),
        ringForgeBonus: Math.max(0, Math.min(10, Math.round(Number(effects.ringForgeBonus ?? 0)))),
      },
    } as BuildingTypeDefinition]
  })
}

export function buildingSlotsAt(location: MapLocation) {
  const definition = getEconomicType(location.economicType)
  const configured = definition.buildingSlots
  return Number.isFinite(configured) ? Math.max(0, Math.round(Number(configured))) : DEFAULT_BUILDING_SLOTS[location.economicType] ?? 0
}

export function buildingsAtLocation(campaign: CampaignState, locationId: string) {
  return (campaign.buildings ?? []).filter((building) => building.locationId === locationId)
}

export function usedBuildingSlots(campaign: CampaignState, locationId: string) {
  return buildingsAtLocation(campaign, locationId).length
}

export interface BuildAvailability {
  allowed: boolean
  reason: string | null
}

export function canBuild(
  definition: BuildingTypeDefinition,
  location: MapLocation,
  campaign: CampaignState,
  factionId: FactionId,
  treasuryGold: number,
): BuildAvailability {
  if (location.side !== factionId) return { allowed: false, reason: 'Локация не принадлежит фракции' }
  if (!definition.allowedStructuralTypes.includes(location.structuralType)) return { allowed: false, reason: 'Недоступно для этого типа объекта' }
  if (definition.allowedEconomicTypes.length && !definition.allowedEconomicTypes.includes(location.economicType)) return { allowed: false, reason: 'Недоступно для этого экономического типа' }
  const slots = buildingSlotsAt(location)
  if (slots <= 0) return { allowed: false, reason: 'В этой локации нет слотов построек' }
  if (usedBuildingSlots(campaign, location.id) >= slots) return { allowed: false, reason: 'Все слоты построек заняты' }
  const atLocation = buildingsAtLocation(campaign, location.id).filter((building) => building.buildingTypeId === definition.id).length
  if (definition.maxPerLocation > 0 && atLocation >= definition.maxPerLocation) return { allowed: false, reason: 'Достигнут лимит на локацию' }
  const perFaction = (campaign.buildings ?? []).filter((building) => building.buildingTypeId === definition.id && building.ownerFactionId === factionId).length
  if (definition.maxPerFaction > 0 && perFaction >= definition.maxPerFaction) return { allowed: false, reason: 'Достигнут лимит на фракцию' }
  if (treasuryGold < definition.cost) return { allowed: false, reason: 'Недостаточно золота' }
  return { allowed: true, reason: null }
}

export function createBuildingInstance(definition: BuildingTypeDefinition, location: MapLocation, factionId: FactionId, round: number): BuildingInstance {
  return {
    id: `bld-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    buildingTypeId: definition.id,
    locationId: location.id,
    ownerFactionId: factionId,
    turnsRemaining: definition.buildTime,
    turnBuilt: round,
  }
}

/** 100% refund while still under construction on the turn it was started, 50% for a finished building. */
export function demolitionRefund(building: BuildingInstance, definition: BuildingTypeDefinition, round: number) {
  if (building.turnsRemaining > 0) return building.turnBuilt === round ? definition.cost : 0
  return Math.round(definition.cost * 0.5)
}

/** Recruits at a location start at 1 + the summed recruitLevelBonus of active buildings. */
export function recruitStartLevel(campaign: CampaignState, buildingTypes: BuildingTypeDefinition[], locationId: string, factionId: FactionId, maxLevel: number) {
  const bonus = buildingsAtLocation(campaign, locationId)
    .filter((building) => building.turnsRemaining <= 0 && building.ownerFactionId === factionId)
    .reduce((total, building) => total + (buildingTypes.find((type) => type.id === building.buildingTypeId)?.effects.recruitLevelBonus ?? 0), 0)
  return Math.max(1, Math.min(Math.max(1, maxLevel || 1), 1 + bonus))
}

export function normalizeBuildings(source: unknown, buildingTypes: BuildingTypeDefinition[], locations: MapLocation[]): BuildingInstance[] {
  if (!Array.isArray(source)) return []
  const knownTypes = new Set(buildingTypes.map((type) => type.id))
  const knownLocations = new Set(locations.map((location) => location.id))
  return source.flatMap((raw: any) => {
    if (!raw || !knownTypes.has(raw.buildingTypeId) || !knownLocations.has(raw.locationId)) return []
    return [{
      id: typeof raw.id === 'string' && raw.id ? raw.id : `bld-${Math.random().toString(36).slice(2, 10)}`,
      buildingTypeId: raw.buildingTypeId,
      locationId: raw.locationId,
      ownerFactionId: raw.ownerFactionId ?? locations.find((location) => location.id === raw.locationId)?.side ?? 'civilian',
      turnsRemaining: Math.max(0, Math.round(Number(raw.turnsRemaining ?? 0))),
      turnBuilt: Math.max(0, Math.round(Number(raw.turnBuilt ?? 0))),
    } as BuildingInstance]
  })
}
