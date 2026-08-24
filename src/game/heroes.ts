import { factionSide } from './campaign'
import { locationHexId, resolveGrid, hexDistance } from '../hex/hexGrid'
import type { Army, CampaignState, FactionDefinition, Hero, HexGridData, LocationCampaignState, MapLocation, Region } from '../types'

export function heroUnlockSatisfied(hero: Hero, campaign: CampaignState, locations: MapLocation[]) {
  if (!hero.alive) return false
  if (hero.unlockType === 'special') return false
  const turnReady = hero.unlockType === 'starting' || hero.unlockType === 'location' || campaign.round >= Math.max(1, hero.requiredTurn)
  const locationReady = hero.unlockType === 'starting' || hero.unlockType === 'turn' || Boolean(hero.requiredLocationId && locations.some((location) => location.id === hero.requiredLocationId && location.side === hero.factionId))
  return turnReady && locationReady
}

export function heroSummonLocation(hero: Hero, locations: MapLocation[]) {
  const required = hero.requiredLocationId ? locations.find((location) => location.id === hero.requiredLocationId && location.side === hero.factionId) : null
  if (required) return required
  return locations.find((location) => location.side === hero.factionId && location.economicType === 'capital')
    ?? locations.find((location) => location.side === hero.factionId)
    ?? null
}

export function heroIsDeployed(heroId: string, armies: Army[], locationStates: Record<string, LocationCampaignState>) {
  return armies.some((army) => army.commander?.kind === 'hero' && army.commander.entityId === heroId || army.heroSlots.some((slot) => slot.entityId === heroId))
    || Object.values(locationStates).some((state) => state.reserve.some((slot) => slot.kind === 'hero' && slot.entityId === heroId))
}

export function nearestFriendlyHeroLocation(
  hero: Hero,
  originHexId: string,
  locations: MapLocation[],
  factions: FactionDefinition[],
  grid: HexGridData,
  regions: Region[],
  preferOwn = true,
) {
  const resolved = resolveGrid(grid, locations, regions)
  const origin = resolved.byId.get(originHexId)
  const side = factionSide(factions, hero.factionId)
  const own = locations.filter((location) => location.side === hero.factionId)
  const allied = locations.filter((location) => factionSide(factions, location.side) === side)
  const pool = preferOwn && own.length ? own : allied
  return pool.map((location) => {
    const target = resolved.byId.get(locationHexId(location, grid.config))
    return { location, distance: origin && target ? hexDistance(origin, target) : Number.POSITIVE_INFINITY }
  }).filter((item) => Number.isFinite(item.distance)).sort((left, right) => left.distance - right.distance || left.location.name.localeCompare(right.location.name, 'ru'))[0]?.location ?? null
}
