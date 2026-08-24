import type { CampaignPhase, CampaignState, FactionDefinition, FactionId, StrategicSide } from '../types'

export const oppositeSide = (side: StrategicSide): StrategicSide => side === 'good' ? 'evil' : 'good'

export function factionSide(factions: FactionDefinition[], factionId: FactionId | null | undefined): StrategicSide | null {
  const alignment = factions.find((faction) => faction.id === factionId)?.alignment
  return alignment === 'good' || alignment === 'evil' ? alignment : null
}

export function activeSide(campaign: CampaignState): StrategicSide | null {
  if (campaign.phase === 'planning_good') return 'good'
  if (campaign.phase === 'planning_evil') return 'evil'
  if (campaign.phase === 'movement_first') return campaign.firstMoverThisRound
  if (campaign.phase === 'movement_second') return oppositeSide(campaign.firstMoverThisRound)
  return null
}

export function isMovementPhase(phase: CampaignPhase): phase is 'movement_first' | 'movement_second' {
  return phase === 'movement_first' || phase === 'movement_second'
}

export function isPlanningPhase(phase: CampaignPhase) {
  return phase === 'planning_good' || phase === 'planning_evil'
}

export function isFactionActive(campaign: CampaignState, factions: FactionDefinition[], factionId: FactionId) {
  return activeSide(campaign) === factionSide(factions, factionId)
}

export function isPlayerFaction(campaign: CampaignState, factionId: FactionId) {
  return Boolean(campaign.playerFactionId && campaign.playerFactionId === factionId)
}

export function factionIsActive(campaign: CampaignState, factionId: FactionId) {
  return campaign.factionStates[factionId]?.status === 'active'
}

export function canFactionPlan(campaign: CampaignState, factions: FactionDefinition[], factionId: FactionId) {
  return isPlanningPhase(campaign.phase)
    && isPlayerFaction(campaign, factionId)
    && isFactionActive(campaign, factions, factionId)
    && factionIsActive(campaign, factionId)
}

export function canPlayerMoveArmy(campaign: CampaignState, factions: FactionDefinition[], factionId: FactionId) {
  return (isMovementPhase(campaign.phase) || isPlanningPhase(campaign.phase))
    && isPlayerFaction(campaign, factionId)
    && isFactionActive(campaign, factions, factionId)
    && factionIsActive(campaign, factionId)
}

export function phaseLabel(campaign: CampaignState) {
  const side = activeSide(campaign)
  const sideLabel = side === 'good' ? 'Good' : side === 'evil' ? 'Evil' : ''
  if (campaign.phase === 'planning_good' || campaign.phase === 'planning_evil') return `Planning · ${sideLabel}`
  if (campaign.phase === 'movement_first') return `Movement · ${sideLabel} (first)`
  if (campaign.phase === 'movement_second') return `Movement · ${sideLabel} (second)`
  if (campaign.phase === 'conflicts') {
    const resolved = campaign.conflicts.filter((conflict) => conflict.status === 'resolved').length
    return `Conflicts · ${Math.min(resolved + 1, campaign.conflicts.length)}/${campaign.conflicts.length}`
  }
  return 'Aftermath'
}

export function phaseIcon(phase: CampaignPhase) {
  if (phase === 'planning_good' || phase === 'planning_evil') return '⚙'
  if (phase === 'movement_first' || phase === 'movement_second') return '➜'
  if (phase === 'conflicts') return '⚔'
  return '☷'
}

export function firstFactionForSide(factions: FactionDefinition[], side: StrategicSide, campaign?: CampaignState) {
  return factions.find((faction) => faction.playable && faction.alignment === side && (!campaign || factionIsActive(campaign, faction.id)))?.id ?? 'civilian'
}
