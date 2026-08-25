import type { EconomicTypeDefinition, LocalizedTranslations, SettlementType } from '../types'

export const ALL_SETTLEMENT_TYPES: SettlementType[] = [
  'village', 'city', 'fortress', 'capital', 'port', 'mine', 'farm',
  'wilderness', 'swamp', 'forest', 'mountains', 'ruins', 'monument', 'crossroads',
  'ford', 'pass', 'signal_tower', 'camp',
]

const ru = (value: string): LocalizedTranslations => ({ ru: value })

/** Built-in defaults used for new mods and missing entries. */
export const DEFAULT_ECONOMIC_TYPES: EconomicTypeDefinition[] = [
  { id: 'village', name: 'Village', nameTranslations: ru('Деревня'), gold: 30, materials: 0, recruitmentSlots: 1, reserveLimit: 5, visionRadius: 2, defenseBonus: 0.1, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: true, allowedForStronghold: true },
  { id: 'city', name: 'City', nameTranslations: ru('Город'), gold: 80, materials: 10, recruitmentSlots: 2, reserveLimit: 10, visionRadius: 3, defenseBonus: 0.2, battleType: 'settlement', allowsCaptainHire: true, isCapital: false, allowedForDomain: true, allowedForStronghold: true },
  { id: 'fortress', name: 'Fortress', nameTranslations: ru('Крепость'), gold: 100, materials: 20, recruitmentSlots: 3, reserveLimit: 15, visionRadius: 4, defenseBonus: 0.4, battleType: 'siege', allowsCaptainHire: true, isCapital: false, allowedForDomain: true, allowedForStronghold: true },
  { id: 'capital', name: 'Capital', nameTranslations: ru('Столица'), gold: 150, materials: 30, recruitmentSlots: 4, reserveLimit: 20, visionRadius: 5, defenseBonus: 0.5, battleType: 'settlement', allowsCaptainHire: true, isCapital: true, allowedForDomain: true, allowedForStronghold: true },
  { id: 'port', name: 'Port', nameTranslations: ru('Порт'), gold: 60, materials: 20, recruitmentSlots: 2, reserveLimit: 10, visionRadius: 3, defenseBonus: 0.2, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: true, allowedForStronghold: true },
  { id: 'mine', name: 'Mine / Forge', nameTranslations: ru('Шахта / кузница'), gold: 20, materials: 40, recruitmentSlots: 2, reserveLimit: 10, visionRadius: 2, defenseBonus: 0.1, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: true, allowedForStronghold: true },
  { id: 'farm', name: 'Farm / Pasture', nameTranslations: ru('Ферма / пастбище'), gold: 50, materials: 0, recruitmentSlots: 1, reserveLimit: 8, visionRadius: 2, defenseBonus: 0.1, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: true, allowedForStronghold: true },
  { id: 'wilderness', name: 'Wilderness', nameTranslations: ru('Дикое владение'), gold: 0, materials: 0, recruitmentSlots: 0, reserveLimit: 4, visionRadius: 2, defenseBonus: 0.1, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: true, allowedForStronghold: true },
  { id: 'swamp', name: 'Swamp', nameTranslations: ru('Болото'), gold: 0, materials: 5, recruitmentSlots: 0, reserveLimit: 4, visionRadius: 2, defenseBonus: 0.1, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: true, allowedForStronghold: false },
  { id: 'forest', name: 'Forest', nameTranslations: ru('Лес'), gold: 10, materials: 20, recruitmentSlots: 1, reserveLimit: 6, visionRadius: 3, defenseBonus: 0.1, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: true, allowedForStronghold: false },
  { id: 'mountains', name: 'Mountains', nameTranslations: ru('Горы'), gold: 5, materials: 30, recruitmentSlots: 1, reserveLimit: 6, visionRadius: 3, defenseBonus: 0.1, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: true, allowedForStronghold: true },
  { id: 'ruins', name: 'Ruins', nameTranslations: ru('Руины'), gold: 5, materials: 5, recruitmentSlots: 0, reserveLimit: 4, visionRadius: 2, defenseBonus: 0.1, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: true, allowedForStronghold: true },
  { id: 'monument', name: 'Monument / Shrine', nameTranslations: ru('Памятник / святилище'), gold: 5, materials: 5, recruitmentSlots: 0, reserveLimit: 4, visionRadius: 2, defenseBonus: 0.1, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: false, allowedForStronghold: true },
  { id: 'crossroads', name: 'Crossroads', nameTranslations: ru('Перекрёсток'), gold: 20, materials: 0, recruitmentSlots: 1, reserveLimit: 5, visionRadius: 2, defenseBonus: 0.1, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: true, allowedForStronghold: true },
  { id: 'ford', name: 'Ford', nameTranslations: ru('Брод'), gold: 15, materials: 0, recruitmentSlots: 0, reserveLimit: 4, visionRadius: 2, defenseBonus: 0.1, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: false, allowedForStronghold: true },
  { id: 'pass', name: 'Pass', nameTranslations: ru('Перевал'), gold: 15, materials: 5, recruitmentSlots: 0, reserveLimit: 4, visionRadius: 2, defenseBonus: 0.1, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: true, allowedForStronghold: true },
  { id: 'signal_tower', name: 'Signal Tower', nameTranslations: ru('Сигнальная башня'), gold: 20, materials: 5, recruitmentSlots: 0, reserveLimit: 4, visionRadius: 4, defenseBonus: 0.1, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: true, allowedForStronghold: true },
  { id: 'camp', name: 'Camp', nameTranslations: ru('Лагерь'), gold: 20, materials: 5, recruitmentSlots: 1, reserveLimit: 6, visionRadius: 2, defenseBonus: 0.1, battleType: 'settlement', allowsCaptainHire: false, isCapital: false, allowedForDomain: false, allowedForStronghold: true },
]

const byId = (items: EconomicTypeDefinition[]) => {
  const map = {} as Record<SettlementType, EconomicTypeDefinition>
  for (const item of DEFAULT_ECONOMIC_TYPES) map[item.id] = { ...item, nameTranslations: { ...item.nameTranslations } }
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
      reserveLimit: Math.max(0, Math.min(100, Number(item.reserveLimit ?? map[item.id].reserveLimit))),
      visionRadius: Math.max(0, Math.min(12, Number(item.visionRadius ?? map[item.id].visionRadius))),
      defenseBonus: Math.max(0, Math.min(1, Number(item.defenseBonus ?? map[item.id].defenseBonus))),
      battleType: item.battleType === 'siege' ? 'siege' : 'settlement',
      allowsCaptainHire: Boolean(item.allowsCaptainHire),
      isCapital: Boolean(item.isCapital),
      allowedForDomain: item.allowedForDomain !== false,
      allowedForStronghold: Boolean(item.allowedForStronghold),
    }
  }
  return map
}

let activeMap = byId(DEFAULT_ECONOMIC_TYPES)
let activeList = DEFAULT_ECONOMIC_TYPES.map((item) => ({ ...item, nameTranslations: { ...item.nameTranslations } }))

export function createDefaultEconomicTypes(): EconomicTypeDefinition[] {
  return DEFAULT_ECONOMIC_TYPES.map((item) => ({ ...item, nameTranslations: { ...item.nameTranslations } }))
}

export function normalizeEconomicTypes(source: unknown): EconomicTypeDefinition[] {
  const incoming = Array.isArray(source) ? source as EconomicTypeDefinition[] : []
  const map = byId(incoming)
  return ALL_SETTLEMENT_TYPES.map((id) => ({ ...map[id], nameTranslations: { ...map[id].nameTranslations } }))
}

/** Activate definitions for runtime helpers (combat, fog, captains). */
export function setActiveEconomicTypes(definitions: EconomicTypeDefinition[]) {
  activeList = normalizeEconomicTypes(definitions)
  activeMap = byId(activeList)
}

export function getActiveEconomicTypes(): EconomicTypeDefinition[] {
  return activeList.map((item) => ({ ...item, nameTranslations: { ...item.nameTranslations } }))
}

export function getEconomicType(id: SettlementType | string | null | undefined): EconomicTypeDefinition {
  const key = (ALL_SETTLEMENT_TYPES.includes(id as SettlementType) ? id : 'village') as SettlementType
  return activeMap[key] ?? activeMap.village
}

export function economicTypeLabel(id: SettlementType, language: 'ru' | 'en' = 'en') {
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
    reserveLimit: def.reserveLimit,
  }
}

export function captainHireEconomicTypes(definitions: EconomicTypeDefinition[] = activeList) {
  return new Set(definitions.filter((item) => item.allowsCaptainHire).map((item) => item.id))
}

export function capitalEconomicTypes(definitions: EconomicTypeDefinition[] = activeList) {
  return new Set(definitions.filter((item) => item.isCapital).map((item) => item.id))
}
