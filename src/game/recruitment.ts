import type { LocationCampaignState, MapLocation, SettlementType, UnitCategory, UnitType } from '../types'

export const OCCUPATION_TURNS = 2
export const OCCUPATION_COUNTER_ON_CAPTURE = OCCUPATION_TURNS + 1

export const SETTLEMENT_RECRUITMENT_LABELS: Record<SettlementType, string> = {
  village: 'Village',
  city: 'City',
  fortress: 'Fortress',
  capital: 'Capital',
  port: 'Port',
  mine: 'Mine / Forge',
  farm:'Farm / Pasture',wilderness:'Wilderness',swamp:'Swamp',forest:'Forest',mountains:'Mountains',ruins:'Ruins',crossroads:'Crossroads',ford:'Ford',pass:'Pass',signal_tower:'Signal Tower',camp:'Camp',
}

export const ALL_SETTLEMENT_TYPES = Object.keys(SETTLEMENT_RECRUITMENT_LABELS) as SettlementType[]

export function defaultLocationTypesForUnit(category: UnitCategory, battlePower: number): SettlementType[] {
  if (category === 'cavalry') return ['farm', 'city', 'fortress', 'capital']
  if (category === 'monsters' || category === 'siege') return ['fortress', 'capital', 'mine']
  if (battlePower >= 140) return ['city', 'fortress', 'capital', 'mine']
  if (battlePower >= 110) return ['city', 'fortress', 'capital', 'port']
  return ['village', 'city', 'fortress', 'capital', 'port', 'farm']
}

export function defaultTagsForLocation(_location: Pick<MapLocation, 'id' | 'economicType' | 'side'>) {
  // Механика тегов сохранена, но стартовые теги задаются только вручную в редакторе.
  return [] as string[]
}

export function defaultRequiredTagsForUnit(_unitId: string) {
  // Требования по тегам также не назначаются автоматически.
  return [] as string[]
}

export function unitCanRecruitAtLocation(unit: UnitType, location: MapLocation, state?: LocationCampaignState | null) {
  if (unit.transformationSourceUnitId) return false
  if (unit.factionId !== location.side) return false
  if (location.blockedRecruitables.includes(unit.id)) return false
  const manuallyAllowed = location.extraRecruitables.includes(unit.id)
  const typeAllowed = unit.requiredLocationTypes.includes(location.economicType)
  const tagsAllowed = unit.requiredLocationTags.every((tag) => location.locationTags.includes(tag))
  if (!manuallyAllowed && (!typeAllowed || !tagsAllowed)) return false
  if ((state?.occupationTurnsLeft ?? 0) > 0 && !unit.recruitDuringOccupation) return false
  return true
}

export function recruitableUnitsAtLocation(location: MapLocation, state: LocationCampaignState | null | undefined, units: UnitType[]) {
  return units.filter((unit) => unitCanRecruitAtLocation(unit, location, state))
}
