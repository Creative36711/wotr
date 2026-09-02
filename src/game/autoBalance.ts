import type { Hero, UnitType } from '../types'

/** Converts the original BFME BuildCost into strategic defaults. BuildCost itself
 * remains reference data and is never used by the campaign economy directly. */
export const DEFAULT_AUTO_BALANCE_COEFFICIENT = 0.24

export function autoBalanceUnit(unit: UnitType, coefficient = DEFAULT_AUTO_BALANCE_COEFFICIENT) {
  const cost = Math.max(0, unit.buildCost ?? 0)
  const power = Math.max(1, Math.round(cost * coefficient))
  return {
    battlePower: power,
    recruitCost: { gold: cost, materials: 0 },
    recruitTime: Math.max(1, Math.min(10, Math.round(cost / 250))),
    upkeep: Math.max(0, Math.round(cost / 100)),
    siegePower: unit.category === 'siege' ? Math.max(10, Math.round(power * 0.45)) : unit.siegePower,
  }
}

export function autoBalanceHero(hero: Hero, coefficient = DEFAULT_AUTO_BALANCE_COEFFICIENT) {
  const cost = Math.max(0, hero.buildCost ?? 0)
  return { battlePower: Math.max(1, Math.round(cost * coefficient * 0.85)), summonCostGold: cost }
}
