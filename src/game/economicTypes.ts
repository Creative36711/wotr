import type { BattleModifierSet, EconomicTypeDefinition, LocalizedTranslations, SettlementType } from '../types'
import { normalizeBattleModifiers } from './battleModifiers'

/** Context-layer battle bonuses granted to the owner of a location, per economic type. */
const OWNER_BONUSES: Partial<Record<SettlementType, BattleModifierSet>> = {
  capital: { owner: { startingResources: 1500, commandPointBonus: 300, palantirStartingPoints: 3, palantirIncomePerInterval: 1, signalFire: true } },
  fortress: { owner: { startingResources: 1000, commandPointBonus: 200, palantirStartingPoints: 2, defenseBonus: 0.05 } },
  city: { owner: { startingResources: 800, commandPointBonus: 150, palantirStartingPoints: 1 } },
  port: { owner: { startingResources: 600, commandPointBonus: 100 } },
  mine: { owner: { startingResources: 900, commandPointBonus: 50 } },
  farm: { owner: { startingResources: 500 } },
  village: { owner: { startingResources: 400 } },
  camp: { owner: { startingResources: 300, commandPointBonus: 50 } },
  signal_tower: { owner: { signalFire: true, palantirStartingPoints: 2 } },
  monument: { owner: { palantirStartingPoints: 2, palantirIncomePerInterval: 1 } },
  crossroads: { owner: { startingResources: 250 } },
  ford: { owner: { startingResources: 200, ambushBonus: 0.1 } },
  pass: { owner: { startingResources: 300, commandPointBonus: 50, ambushBonus: 0.15, defenseBonus: 0.05 } },
  ruins: { owner: { startingResources: 150, ambushBonus: 0.05 } },
  forest: { owner: { startingResources: 150, ambushBonus: 0.15, spawnBonus: 'ents' } },
  mountains: { owner: { startingResources: 200, defenseBonus: 0.05, spawnBonus: 'trolls' } },
  swamp: { owner: { terrainDebuff: 0.1 } },
  wilderness: { owner: {} },
}
const bonuses = (id: SettlementType): BattleModifierSet => ({ owner: { ...(OWNER_BONUSES[id]?.owner ?? {}) } })

export const ALL_SETTLEMENT_TYPES: SettlementType[] = [
  'village', 'city', 'fortress', 'capital', 'port', 'mine', 'farm',
  'wilderness', 'swamp', 'forest', 'mountains', 'ruins', 'monument', 'crossroads',
  'ford', 'pass', 'signal_tower', 'camp',
]

const ru = (value: string): LocalizedTranslations => ({ ru: value })

/** Built-in defaults used for new mods and missing entries. */
export const DEFAULT_ECONOMIC_TYPES: EconomicTypeDefinition[] = [
  { id: 'village', name: 'Village', nameTranslations: ru('Деревня'), gold: 30, materials: 0, recruitmentSlots: 1, commandPointLimit: 300, visionRadius: 2, defenseBonus: 0.1, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: true, allowedForStronghold: true , buildingSlots: 1, battleModifiers: bonuses('village') },
  { id: 'city', name: 'City', nameTranslations: ru('Город'), gold: 80, materials: 10, recruitmentSlots: 2, commandPointLimit: 600, visionRadius: 3, defenseBonus: 0.2, battleType: 'settlement', allowsCaptainHire: true, isCapital: false, allowedForDomain: true, allowedForStronghold: true , buildingSlots: 3, battleModifiers: bonuses('city') },
  { id: 'fortress', name: 'Fortress', nameTranslations: ru('Крепость'), gold: 100, materials: 20, recruitmentSlots: 3, commandPointLimit: 900, visionRadius: 4, defenseBonus: 0.4, battleType: 'siege', allowsCaptainHire: true, isCapital: false, allowedForDomain: true, allowedForStronghold: true , buildingSlots: 3, battleModifiers: bonuses('fortress') },
  { id: 'capital', name: 'Capital', nameTranslations: ru('Столица'), gold: 150, materials: 30, recruitmentSlots: 4, commandPointLimit: 1200, visionRadius: 5, defenseBonus: 0.5, battleType: 'settlement', allowsCaptainHire: true, isCapital: true, allowedForDomain: true, allowedForStronghold: true , buildingSlots: 4, battleModifiers: bonuses('capital') },
  { id: 'port', name: 'Port', nameTranslations: ru('Порт'), gold: 60, materials: 20, recruitmentSlots: 2, commandPointLimit: 500, visionRadius: 3, defenseBonus: 0.2, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: true, allowedForStronghold: true , buildingSlots: 2, battleModifiers: bonuses('port') },
  { id: 'mine', name: 'Mine / Forge', nameTranslations: ru('Шахта / кузница'), gold: 20, materials: 40, recruitmentSlots: 2, commandPointLimit: 500, visionRadius: 2, defenseBonus: 0.1, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: true, allowedForStronghold: true , buildingSlots: 2, battleModifiers: bonuses('mine') },
  { id: 'farm', name: 'Farm / Pasture', nameTranslations: ru('Ферма / пастбище'), gold: 50, materials: 0, recruitmentSlots: 1, commandPointLimit: 300, visionRadius: 2, defenseBonus: 0.1, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: true, allowedForStronghold: true , buildingSlots: 1, battleModifiers: bonuses('farm') },
  { id: 'wilderness', name: 'Wilderness', nameTranslations: ru('Дикое владение'), gold: 0, materials: 0, recruitmentSlots: 0, commandPointLimit: 0, visionRadius: 2, defenseBonus: 0.1, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: true, allowedForStronghold: true , buildingSlots: 0, battleModifiers: bonuses('wilderness') },
  { id: 'swamp', name: 'Swamp', nameTranslations: ru('Болото'), gold: 0, materials: 5, recruitmentSlots: 0, commandPointLimit: 0, visionRadius: 2, defenseBonus: 0.1, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: true, allowedForStronghold: false , buildingSlots: 0, battleModifiers: bonuses('swamp') },
  { id: 'forest', name: 'Forest', nameTranslations: ru('Лес'), gold: 10, materials: 20, recruitmentSlots: 1, commandPointLimit: 250, visionRadius: 3, defenseBonus: 0.1, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: true, allowedForStronghold: false , buildingSlots: 0, battleModifiers: bonuses('forest') },
  { id: 'mountains', name: 'Mountains', nameTranslations: ru('Горы'), gold: 5, materials: 30, recruitmentSlots: 1, commandPointLimit: 250, visionRadius: 3, defenseBonus: 0.1, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: true, allowedForStronghold: true , buildingSlots: 0, battleModifiers: bonuses('mountains') },
  { id: 'ruins', name: 'Ruins', nameTranslations: ru('Руины'), gold: 5, materials: 5, recruitmentSlots: 0, commandPointLimit: 0, visionRadius: 2, defenseBonus: 0.1, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: true, allowedForStronghold: true , buildingSlots: 1, battleModifiers: bonuses('ruins') },
  { id: 'monument', name: 'Monument / Shrine', nameTranslations: ru('Памятник / святилище'), gold: 5, materials: 5, recruitmentSlots: 0, commandPointLimit: 0, visionRadius: 2, defenseBonus: 0.1, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: false, allowedForStronghold: true , buildingSlots: 1, battleModifiers: bonuses('monument') },
  { id: 'crossroads', name: 'Crossroads', nameTranslations: ru('Перекрёсток'), gold: 20, materials: 0, recruitmentSlots: 1, commandPointLimit: 200, visionRadius: 2, defenseBonus: 0.1, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: true, allowedForStronghold: true , buildingSlots: 1, battleModifiers: bonuses('crossroads') },
  { id: 'ford', name: 'Ford', nameTranslations: ru('Брод'), gold: 15, materials: 0, recruitmentSlots: 0, commandPointLimit: 0, visionRadius: 2, defenseBonus: 0.1, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: false, allowedForStronghold: true , buildingSlots: 1, battleModifiers: bonuses('ford') },
  { id: 'pass', name: 'Pass', nameTranslations: ru('Перевал'), gold: 15, materials: 5, recruitmentSlots: 0, commandPointLimit: 0, visionRadius: 2, defenseBonus: 0.1, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: true, allowedForStronghold: true , buildingSlots: 1, battleModifiers: bonuses('pass') },
  { id: 'signal_tower', name: 'Signal Tower', nameTranslations: ru('Сигнальная башня'), gold: 20, materials: 5, recruitmentSlots: 0, commandPointLimit: 0, visionRadius: 4, defenseBonus: 0.1, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: true, allowedForStronghold: true , buildingSlots: 1, battleModifiers: bonuses('signal_tower') },
  { id: 'camp', name: 'Camp', nameTranslations: ru('Лагерь'), gold: 20, materials: 5, recruitmentSlots: 1, commandPointLimit: 150, visionRadius: 2, defenseBonus: 0.1, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: false, allowedForStronghold: true , buildingSlots: 1, battleModifiers: bonuses('camp') },
]

const byId = (items: EconomicTypeDefinition[]) => {
  const map = {} as Record<SettlementType, EconomicTypeDefinition>
  for (const item of DEFAULT_ECONOMIC_TYPES) map[item.id] = { ...item, nameTranslations: { ...item.nameTranslations }, battleModifiers: { owner: { ...(item.battleModifiers?.owner ?? {}) } } }
  for (const item of items) {
    if (!ALL_SETTLEMENT_TYPES.includes(item.id)) continue
    map[item.id] = {
      ...map[item.id],
      ...item,
      id: item.id,
      nameTranslations: { ...(item.nameTranslations ?? {}) },
      gold: Math.max(0, Number(item.gold ?? map[item.id].gold)),
      materials: Math.max(0, Number(item.materials ?? map[item.id].materials)),
      recruitmentSlots: Math.max(0, Math.min(20, Number(item.recruitmentSlots ?? map[item.id].recruitmentSlots))),
      commandPointLimit: Math.max(0, Math.min(10000, Number(item.commandPointLimit ?? map[item.id].commandPointLimit))),
      visionRadius: Math.max(0, Math.min(12, Number(item.visionRadius ?? map[item.id].visionRadius))),
      defenseBonus: Math.max(0, Math.min(1, Number(item.defenseBonus ?? map[item.id].defenseBonus))),
      battleType: item.battleType === 'siege' ? 'siege' : 'settlement',
      allowsCaptainHire: Boolean(item.allowsCaptainHire),
      isCapital: Boolean(item.isCapital),
      allowedForDomain: item.allowedForDomain !== false,
      allowedForStronghold: Boolean(item.allowedForStronghold),
      buildingSlots: Math.max(0, Math.min(8, Math.round(Number(item.buildingSlots ?? map[item.id].buildingSlots ?? 0)))),
      battleModifiers: item.battleModifiers ? normalizeBattleModifiers(item.battleModifiers) : { owner: { ...(map[item.id].battleModifiers?.owner ?? {}) } },
    }
  }
  return map
}

let activeMap = byId(DEFAULT_ECONOMIC_TYPES)
let activeList: EconomicTypeDefinition[] = DEFAULT_ECONOMIC_TYPES.map((item) => ({ ...item, nameTranslations: { ...item.nameTranslations }, battleModifiers: { owner: { ...(item.battleModifiers?.owner ?? {}) } } }))

export function createDefaultEconomicTypes(): EconomicTypeDefinition[] {
  return DEFAULT_ECONOMIC_TYPES.map(cloneEconomicType)
}

export function cloneEconomicType(item: EconomicTypeDefinition): EconomicTypeDefinition {
  return { ...item, nameTranslations: { ...item.nameTranslations }, battleModifiers: { owner: { ...(item.battleModifiers?.owner ?? {}) } } }
}

export function normalizeEconomicTypes(source: unknown): EconomicTypeDefinition[] {
  const incoming = Array.isArray(source) ? source as EconomicTypeDefinition[] : []
  const map = byId(incoming)
  return ALL_SETTLEMENT_TYPES.map((id) => cloneEconomicType(map[id]))
}

/** Activate definitions for runtime helpers (combat, fog, captains). */
export function setActiveEconomicTypes(definitions: EconomicTypeDefinition[]) {
  activeList = normalizeEconomicTypes(definitions)
  activeMap = byId(activeList)
}

export function getActiveEconomicTypes(): EconomicTypeDefinition[] {
  return activeList.map(cloneEconomicType)
}

export function getEconomicType(id: SettlementType | string | null | undefined): EconomicTypeDefinition {
  const key = (ALL_SETTLEMENT_TYPES.includes(id as SettlementType) ? id : 'village') as SettlementType
  return activeMap[key] ?? activeMap.village
}

export function economicTypeLabel(id: SettlementType, language: string = 'en') {
  const def = getEconomicType(id)
  if (language === 'en') return def.name
  return def.nameTranslations?.ru?.trim() || def.name
}

export function domainEconomicTypeIds(definitions: EconomicTypeDefinition[] = activeList) {
  return definitions.filter((item) => item.allowedForDomain).map((item) => item.id)
}

export function strongholdEconomicTypeIds(definitions: EconomicTypeDefinition[] = activeList) {
  return definitions.filter((item) => item.allowedForStronghold).map((item) => item.id)
}

export function economicDefaultsPatch(id: SettlementType) {
  const def = getEconomicType(id)
  return {
    economicType: def.id,
    income: { gold: def.gold, materials: def.materials },
    recruitmentSlots: def.recruitmentSlots,
    commandPointLimit: def.commandPointLimit,
  }
}

export function captainHireEconomicTypes(definitions: EconomicTypeDefinition[] = activeList) {
  return new Set(definitions.filter((item) => item.allowsCaptainHire).map((item) => item.id))
}

export function capitalEconomicTypes(definitions: EconomicTypeDefinition[] = activeList) {
  return new Set(definitions.filter((item) => item.isCapital).map((item) => item.id))
}
