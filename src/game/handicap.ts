import type { Army, CampaignState, FactionId, RingForgingSettings } from '../types'

/**
 * BFME room handicap ("фора"): 0, then −5 % … −95 % in 5 % steps
 * (see _test_integration-bfme/bridge/room.py, HANDICAP_VALUES).
 * The strategic layer produces a penalty fraction; this module snaps it to the
 * BFME grid so the automation can pick the right dropdown row.
 */
export const HANDICAP_STEP = 5
export const HANDICAP_MIN = -95

export interface HandicapReason {
  label: string
  /** Positive fraction of the penalty, e.g. 0.2 = −20 %. */
  amount: number
}

export interface HandicapResult {
  /** BFME value: 0 or a negative multiple of 5, never below −95. */
  percent: number
  /** Raw summed fraction before snapping. */
  rawFraction: number
  reasons: HandicapReason[]
}

export function snapHandicap(fraction: number) {
  if (!Number.isFinite(fraction) || fraction <= 0) return 0
  const percent = -Math.round((fraction * 100) / HANDICAP_STEP) * HANDICAP_STEP
  return Math.max(HANDICAP_MIN, Math.min(0, percent))
}

/** A defeated army keeps fighting at −20 % on the global map (see conflicts.ts). */
export const DEMORALIZED_PENALTY = 0.2
/** Any army that already spent its movement enters the battle slightly worn out. */
export const EXHAUSTED_PENALTY = 0.05

export interface HandicapContext {
  factionId: FactionId
  /** Armies of this faction participating in the battle. */
  armies: Army[]
  campaign: CampaignState
  ringForging: RingForgingSettings
  /** Extra penalties supplied by the caller (e.g. occupied location). */
  extra?: HandicapReason[]
}

/**
 * Everything that weakens a side in a real BFME battle is summed here and then
 * applied as one room handicap. Sources: demoralization after a lost battle,
 * exhaustion, and the enemy Ring.
 */
export function calculateHandicap(context: HandicapContext): HandicapResult {
  const reasons: HandicapReason[] = []
  const round = context.campaign.round

  const demoralized = context.armies.filter((army) => army.status === 'retreating'
    && army.exhaustedUntilRound !== null && army.exhaustedUntilRound >= round)
  if (demoralized.length && context.armies.length) {
    const share = demoralized.length / context.armies.length
    reasons.push({ label: `Деморализация после поражения (${demoralized.length} из ${context.armies.length} армий)`, amount: DEMORALIZED_PENALTY * share })
  }

  const exhausted = context.armies.filter((army) => army.movementRemaining <= 0 && !demoralized.includes(army))
  if (exhausted.length && context.armies.length) {
    reasons.push({ label: 'Марш без отдыха', amount: EXHAUSTED_PENALTY * (exhausted.length / context.armies.length) })
  }

  const ring = context.campaign.ringState
  if (context.ringForging.enabled && ring?.forged && ring.ownerFactionId && ring.ownerFactionId !== context.factionId) {
    reasons.push({ label: 'Кольцо Всевластья у противника', amount: context.ringForging.effects.handicapToAllEnemies })
  }

  for (const item of context.extra ?? []) if (item.amount > 0) reasons.push(item)

  const rawFraction = reasons.reduce((total, item) => total + item.amount, 0)
  return { percent: snapHandicap(rawFraction), rawFraction, reasons }
}
