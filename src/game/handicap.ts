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
 * Raw penalty fraction for one side, before it is compared with the opponent.
 *
 * Only genuinely *exceptional* weaknesses belong here. Marching into the battle
 * is what every attacking army does, so it must never produce a penalty —
 * otherwise both sides get an identical handicap, which is both meaningless
 * (the handicap is a relative advantage) and confusing to the player.
 */
export function rawHandicapReasons(context: HandicapContext): HandicapReason[] {
  const reasons: HandicapReason[] = []
  const round = context.campaign.round

  // Demoralized = an army that actually lost a battle and retreated recently.
  const demoralized = context.armies.filter((army) => army.status === 'retreating'
    && army.exhaustedUntilRound !== null && army.exhaustedUntilRound >= round)
  if (demoralized.length && context.armies.length) {
    const share = demoralized.length / context.armies.length
    reasons.push({ label: `Деморализация после поражения (${demoralized.length} из ${context.armies.length} армий)`, amount: DEMORALIZED_PENALTY * share })
  }

  const ring = context.campaign.ringState
  if (context.ringForging.enabled && ring?.forged && ring.ownerFactionId && ring.ownerFactionId !== context.factionId) {
    reasons.push({ label: 'Кольцо Всевластья у противника', amount: context.ringForging.effects.handicapToAllEnemies })
  }

  for (const item of context.extra ?? []) if (item.amount > 0) reasons.push(item)
  return reasons
}

/**
 * Absolute handicap for a single side. Prefer `calculateRelativeHandicaps` when
 * both sides are known: the BFME handicap is a *relative* advantage, so a
 * penalty shared by everybody cancels out and should not be applied at all.
 */
export function calculateHandicap(context: HandicapContext): HandicapResult {
  const reasons = rawHandicapReasons(context)
  const rawFraction = reasons.reduce((total, item) => total + item.amount, 0)
  return { percent: snapHandicap(rawFraction), rawFraction, reasons }
}

/**
 * Handicaps for every participating faction, normalised against each other.
 *
 * The BFME room handicap only weakens the slot it is applied to, so what
 * matters is the *difference* between sides. The common part is subtracted so
 * that the strongest side always ends at 0 % and only genuinely weaker sides
 * are penalised — «у кого фора, тот и слабее».
 */
export function calculateRelativeHandicaps(contexts: HandicapContext[]): Map<FactionId, HandicapResult> {
  const raw = contexts.map((context) => ({
    factionId: context.factionId,
    reasons: rawHandicapReasons(context),
  })).map((entry) => ({
    ...entry,
    fraction: entry.reasons.reduce((total, item) => total + item.amount, 0),
  }))
  // The floor is the weakness every side shares; it carries no advantage.
  const floor = raw.length ? Math.min(...raw.map((entry) => entry.fraction)) : 0
  const result = new Map<FactionId, HandicapResult>()
  for (const entry of raw) {
    const relative = Math.max(0, entry.fraction - floor)
    result.set(entry.factionId, {
      percent: snapHandicap(relative),
      rawFraction: relative,
      reasons: relative > 0 ? entry.reasons : [],
    })
  }
  return result
}
