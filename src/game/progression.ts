import type { ArmySlot, ArmyUpgradeId, Hero, UnitType } from '../types'
import { ARMY_UPGRADE_IDS } from '../types'

export const DEFAULT_UNIT_MAX_LEVEL = 5
export const DEFAULT_HERO_MAX_LEVEL = 10
/** BFME veterancy ceiling: aura objects exist only for levels 2..10. */
export const ABSOLUTE_MAX_LEVEL = 10

/** +10% strategic power per level above 1, softened above level 5 so that
 *  heroic 10-level formations do not run away with the auto-battle math. */
export function levelPowerMultiplier(level: number) {
  const clamped = Math.max(1, Math.min(ABSOLUTE_MAX_LEVEL, Math.round(level || 1)))
  const linear = Math.min(clamped, 5) - 1
  const heroic = Math.max(0, clamped - 5)
  return 1 + linear * 0.1 + heroic * 0.06
}

export function unitMaxLevel(unit: UnitType | undefined, worldDefault = DEFAULT_UNIT_MAX_LEVEL) {
  const raw = unit?.maxLevel
  if (raw === 0) return 0
  const value = Number.isFinite(raw) ? Number(raw) : worldDefault
  return Math.max(0, Math.min(ABSOLUTE_MAX_LEVEL, Math.round(value)))
}

export function heroMaxLevel(hero: Hero | undefined, worldDefault = DEFAULT_HERO_MAX_LEVEL) {
  const raw = hero?.maxLevel
  if (raw === 0) return 0
  const value = Number.isFinite(raw) ? Number(raw) : worldDefault
  return Math.max(0, Math.min(ABSOLUTE_MAX_LEVEL, Math.round(value)))
}

/** Missing `availableUpgrades` means every upgrade is allowed (old mods). */
export function availableUpgrades(unit: UnitType | undefined): ArmyUpgradeId[] {
  const raw = unit?.availableUpgrades
  if (!Array.isArray(raw)) return [...ARMY_UPGRADE_IDS]
  return ARMY_UPGRADE_IDS.filter((id) => raw.includes(id))
}

export function upgradePowerMultiplier(slot: Pick<ArmySlot, 'weaponUpgrade' | 'armorUpgrade' | 'bannerUpgrade'>) {
  return (slot.weaponUpgrade ? 1.1 : 1) * (slot.armorUpgrade ? 1.1 : 1) * (slot.bannerUpgrade ? 1.05 : 1)
}

/** Combined permanent-layer multiplier for one army slot. */
export function slotPowerMultiplier(slot: ArmySlot) {
  return levelPowerMultiplier(slot.level ?? 1) * upgradePowerMultiplier(slot)
}

/** Hero/commander multiplier: heroes keep their level in campaign.heroLevels. */
export function heroPowerMultiplier(heroLevels: Record<string, number>, heroId: string) {
  return levelPowerMultiplier(heroLevels[heroId] ?? 1)
}

export function normalizeSlotProgression<T extends Partial<ArmySlot>>(slot: T, maxLevel = ABSOLUTE_MAX_LEVEL) {
  const level = Math.max(1, Math.min(Math.max(1, maxLevel || 1), Math.round(Number(slot.level ?? 1)) || 1))
  return {
    level,
    weaponUpgrade: Boolean(slot.weaponUpgrade),
    armorUpgrade: Boolean(slot.armorUpgrade),
    bannerUpgrade: Boolean(slot.bannerUpgrade),
  }
}

/** +1 level for a battle survivor, capped by the entity's own maximum. */
export function grantBattleExperience(slot: ArmySlot, max: number): ArmySlot {
  if (max <= 1) return slot
  const level = Math.min(max, (slot.level ?? 1) + 1)
  return level === slot.level ? slot : { ...slot, level }
}
