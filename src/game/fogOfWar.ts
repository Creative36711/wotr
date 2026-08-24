import { factionSide } from './campaign'
import { hexDistance, locationHexId, resolveGrid } from '../hex/hexGrid'
import type { Army, ArmyIntelSize, CampaignState, FactionDefinition, HexGridData, LastSeenArmyIntel, LastSeenLocationIntel, MapLocation, Region } from '../types'

const LOCATION_VISION: Record<MapLocation['economicType'], number> = {
  village: 2,
  city: 3,
  fortress: 4,
  capital: 5,
  port: 3,
  mine: 2,
  farm:2,wilderness:2,swamp:2,forest:3,mountains:3,ruins:2,crossroads:2,ford:2,pass:2,signal_tower:4,camp:2,
}

export function armyIntelSize(army: Army): ArmyIntelSize {
  const count = army.unitSlots.length
  if (count <= 4) return 'small'
  if (count <= 8) return 'medium'
  if (count <= 12) return 'large'
  return 'huge'
}

export function armyIntelLabel(size: ArmyIntelSize) {
  return size === 'small' ? 'Small Force' : size === 'medium' ? 'Medium Army' : size === 'large' ? 'Large Army' : 'Huge Army'
}

export function garrisonIntelCategory(count: number): LastSeenLocationIntel['garrisonCategory'] {
  if (count <= 0) return 'none'
  if (count <= 4) return 'weak'
  if (count <= 9) return 'medium'
  return 'strong'
}

export function garrisonIntelLabel(category: LastSeenLocationIntel['garrisonCategory']) {
  return category === 'none' ? 'none' : category === 'weak' ? 'weak' : category === 'medium' ? 'medium' : 'strong'
}

export function calculateVisibleHexes(
  campaign: CampaignState,
  armies: Army[],
  locations: MapLocation[],
  factions: FactionDefinition[],
  grid: HexGridData,
  regions: Region[],
) {
  const resolved = resolveGrid(grid, locations, regions)
  if (!campaign.fogOfWar.enabled || !campaign.playerFactionId) return new Set(resolved.cells.map((cell) => cell.id))
  const visible = new Set<string>()
  const sources: Array<{ hexId: string; radius: number }> = []
  for(const location of locations.filter((candidate)=>candidate.side===campaign.playerFactionId)){sources.push({hexId:locationHexId(location,grid.config),radius:location.structuralType==='stronghold'?2:LOCATION_VISION[location.economicType]});if(location.structuralType==='domain'){const region=regions.find((item)=>item.locationId===location.id);if(region)for(const cell of resolved.cells)if(cell.regionId===region.id)visible.add(cell.id)}}
  for (const army of armies.filter((candidate) => candidate.factionId === campaign.playerFactionId)) {
    const cell = resolved.byId.get(army.hexId)
    const radius = Math.max(1, 2 + (cell?.terrain === 'hills' || cell?.terrain === 'mountains' ? 1 : 0) - (cell?.terrain === 'forest' ? 1 : 0))
    sources.push({ hexId: army.hexId, radius })
  }
  for (const source of sources) {
    const origin = resolved.byId.get(source.hexId)
    if (!origin) continue
    for (const cell of resolved.cells) if (hexDistance(origin, cell) <= source.radius) visible.add(cell.id)
  }
  return visible
}

export function refreshFogIntel(
  campaign: CampaignState,
  armies: Army[],
  locations: MapLocation[],
  factions: FactionDefinition[],
  grid: HexGridData,
  regions: Region[],
  seedAllLocations = false,
) {
  const visible = calculateVisibleHexes(campaign, armies, locations, factions, grid, regions)
  const enemyArmies = armies.filter((army) => factionSide(factions, army.factionId) !== campaign.playerSide)
  const enemyById = new Map(enemyArmies.map((army) => [army.id, army]))
  const retainedArmyIntel = campaign.fogOfWar.lastSeenArmies.filter((intel) => {
    if (!visible.has(intel.hexId)) return true
    const actual = enemyById.get(intel.armyId)
    return Boolean(actual && actual.hexId === intel.hexId)
  })
  const armyIntel = new Map(retainedArmyIntel.map((intel) => [intel.armyId, { ...intel }]))
  for (const army of enemyArmies.filter((candidate) => visible.has(candidate.hexId))) armyIntel.set(army.id, {
    armyId: army.id,
    hexId: army.hexId,
    factionId: army.factionId,
    sizeCategory: armyIntelSize(army),
    hasHero: army.commander?.kind === 'hero' || army.heroSlots.length > 0,
    wasMoving: army.movedRound === campaign.round,
    lastSeenRound: campaign.round,
  } as LastSeenArmyIntel)
  campaign.fogOfWar.lastSeenArmies = [...armyIntel.values()]

  const previousLocations = new Map(campaign.fogOfWar.lastSeenLocations.map((intel) => [intel.locationId, { ...intel }]))
  for (const location of locations) {
    const shouldUpdate = seedAllLocations || visible.has(locationHexId(location, grid.config))
    if (!shouldUpdate) continue
    const reserveCount = campaign.locationStates[location.id]?.reserve.filter((slot) => slot.kind === 'unit').length ?? 0
    previousLocations.set(location.id, {
      locationId: location.id,
      lastKnownOwner: location.side,
      hasGarrison: reserveCount > 0,
      garrisonCategory: garrisonIntelCategory(reserveCount),
      lastSeenRound: campaign.round,
    })
  }
  campaign.fogOfWar.lastSeenLocations = [...previousLocations.values()]
  return visible
}
