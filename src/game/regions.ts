import { hexDistance, hexId, parseHexId, resolveGrid } from '../hex/hexGrid'
import type { FactionId, HexGridData, MapLocation, Region } from '../types'

/** Built-in Middle-earth top-level regions for Vanilla 2.01. */
export const VANILLA_REGIONS: Array<Pick<Region, 'id' | 'name' | 'nameTranslations' | 'color' | 'description' | 'descriptionTranslations'>> = [
  {
    id: 'region-eriador',
    name: 'Eriador',
    nameTranslations: { ru: 'Эриадор' },
    color: '#6B8E6B',
    description: 'Lands west of the Misty Mountains, from the Blue Mountains to the Baranduin.',
    descriptionTranslations: { ru: 'Земли к западу от Мглистых Гор, от Синих Гор до Барадуина.' },
  },
  {
    id: 'region-angmar',
    name: 'Angmar',
    nameTranslations: { ru: 'Ангмар' },
    color: '#5C4A6E',
    description: 'The far north: icy wastes and the northern spurs of the Misty Mountains.',
    descriptionTranslations: { ru: 'Крайний север: ледяные пустоши и северные отроги Мглистых Гор.' },
  },
  {
    id: 'region-rhovanion',
    name: 'Rhovanion',
    nameTranslations: { ru: 'Рованион' },
    color: '#4A7A4A',
    description: 'Wilderland east of the Misty Mountains: Mirkwood, Dale, and the Iron Hills.',
    descriptionTranslations: { ru: 'Земли к востоку от Мглистых Гор: Лихолесье, Дейл и Железные Холмы.' },
  },
  {
    id: 'region-enedwaith',
    name: 'Enedwaith',
    nameTranslations: { ru: 'Энедвайт' },
    color: '#8B7D5B',
    description: 'The empty lands between Eriador and Rohan: Dunland, Fangorn, and Isengard.',
    descriptionTranslations: { ru: 'Пустоши между Эриадором и Роханом: Дунланд, Фангорн и Изенгард.' },
  },
  {
    id: 'region-rohan',
    name: 'Rohan',
    nameTranslations: { ru: 'Рохан' },
    color: '#7A9E3A',
    description: 'The grassy plains of the Rohirrim from the Gap of Rohan to the Entwash.',
    descriptionTranslations: { ru: 'Травянистые равнины Рохиррим от Врат Рохана до Энтуош.' },
  },
  {
    id: 'region-gondor',
    name: 'Gondor',
    nameTranslations: { ru: 'Гондор' },
    color: '#4A6FA5',
    description: 'The southern kingdom from the White Mountains to the Anduin and the sea.',
    descriptionTranslations: { ru: 'Южное королевство от Белых Гор до Андуина и моря.' },
  },
  {
    id: 'region-ithilien',
    name: 'Ithilien',
    nameTranslations: { ru: 'Итилиэн' },
    color: '#5A8A5A',
    description: 'The eastern province of Gondor between the Anduin and Mordor.',
    descriptionTranslations: { ru: 'Восточная провинция Гондора между Андуином и Мордором.' },
  },
  {
    id: 'region-mordor',
    name: 'Mordor',
    nameTranslations: { ru: 'Мордор' },
    color: '#8B2020',
    description: 'Volcanic wastes ringed by the Ephel Dúath and Ered Lithui.',
    descriptionTranslations: { ru: 'Вулканические пустоши, окружённые Эфель Дуат и Эред Литуй.' },
  },
  {
    id: 'region-harad',
    name: 'Harad',
    nameTranslations: { ru: 'Харад' },
    color: '#C4A035',
    description: 'Southern deserts and savannas beyond the Harnen.',
    descriptionTranslations: { ru: 'Южные пустыни и саванны за рекой Харнен.' },
  },
  {
    id: 'region-rhun',
    name: 'Rhûn',
    nameTranslations: { ru: 'Рун' },
    color: '#9E6B3A',
    description: 'Eastern lands around the Sea of Rhûn, home of the Easterlings.',
    descriptionTranslations: { ru: 'Восточные земли вокруг Моря Рун, родина истерлингов.' },
  },
]

/** Seed hexes used to partition the Vanilla map into the ten top-level regions. */
export const VANILLA_REGION_SEEDS: Record<string, string[]> = {
  'region-eriador': ['5:14', '8:16', '13:14', '-2:15', '7:12', '2:13', '6:18'],
  'region-angmar': ['9:10', '15:10', '8:8', '11:13', '21:9'],
  'region-rhovanion': ['21:13', '24:12', '18:16', '16:18', '29:11', '22:14', '21:17'],
  'region-enedwaith': ['8:22', '8:20', '4:23', '11:21', '5:20', '7:19'],
  'region-rohan': ['9:26', '7:25', '8:25', '11:24', '13:23', '8:23'],
  'region-gondor': ['14:27', '12:30', '5:30', '10:30', '6:28', '13:28', '5:29'],
  'region-ithilien': ['15:28', '14:25', '15:26', '17:27', '14:22', '15:22'],
  'region-mordor': ['22:25', '18:23', '19:24', '20:24', '18:30', '21:28', '18:26'],
  'region-harad': ['11:36', '5:37', '11:33', '5:34'],
  'region-rhun': ['29:18', '27:17', '22:34', '20:20'],
}

/** Map objects that should be strongholds rather than domains in Vanilla 2.01. */
export const VANILLA_STRONGHOLD_IDS = new Set([
  'helms-deep',
  'cair-andros',
  'weathertop',
  'gap-rohan',
  'argonath',
  'amon-hen',
  'cirith-ungol',
  'black-gate',
  'dead-marshes',
  'emyn-muil',
  'tolfalas',
  'orodruin',
])

const STRONGHOLD_ECONOMIC = new Set(['ruins', 'crossroads', 'ford', 'pass', 'signal_tower', 'camp'])

export function isStrongholdEconomicType(economicType: string) {
  return STRONGHOLD_ECONOMIC.has(economicType)
}

export function emptyRegion(
  id: string,
  name = 'New Region',
  nameTranslations: Record<string, string> = { ru: 'Новый регион' },
  color = '#7A8B99',
): Region {
  return {
    id,
    name,
    nameTranslations,
    hexes: [],
    color,
    description: '',
    descriptionTranslations: {},
  }
}

export function regionContainingHex(regions: Region[], hex: string): Region | null {
  return regions.find((region) => region.hexes.includes(hex)) ?? null
}

export function regionIdForHex(regions: Region[], hex: string): string | null {
  return regionContainingHex(regions, hex)?.id ?? null
}

/** Assign every land hex to the nearest region seed (or existing region centroid). */
export function partitionLandHexesIntoRegions(
  grid: HexGridData,
  regionDefs: Array<Pick<Region, 'id' | 'name' | 'nameTranslations' | 'color' | 'description' | 'descriptionTranslations'>>,
  seeds: Record<string, string[]>,
): Region[] {
  const landHexes = Object.entries(grid.cells)
    .filter(([, cell]) => cell.terrain !== 'water' && cell.passable !== false)
    .map(([id]) => id)

  const seedPoints = regionDefs.map((def) => {
    const points = (seeds[def.id] ?? []).map((id) => parseHexId(id))
    return { def, points }
  })

  const hexesByRegion = new Map<string, string[]>(regionDefs.map((def) => [def.id, []]))

  for (const hex of landHexes) {
    const coords = parseHexId(hex)
    let bestId = regionDefs[0]?.id ?? ''
    let bestDistance = Number.POSITIVE_INFINITY
    for (const { def, points } of seedPoints) {
      if (!points.length) continue
      const distance = Math.min(...points.map((point) => hexDistance(coords, point)))
      if (distance < bestDistance) {
        bestDistance = distance
        bestId = def.id
      }
    }
    hexesByRegion.get(bestId)?.push(hex)
  }

  return regionDefs.map((def) => ({
    ...def,
    hexes: [...(hexesByRegion.get(def.id) ?? [])].sort(),
  }))
}

/** Recompute domain hex sets inside each region (nearest domain, skipping stronghold hexes). */
export function regenerateDomainHexes(locations: MapLocation[], regions: Region[]): MapLocation[] {
  const regionById = new Map(regions.map((region) => [region.id, region]))
  const strongholdHexes = new Set(
    locations.filter((location) => location.structuralType === 'stronghold').map((location) => location.hex),
  )
  const domains = locations.filter((location) => location.structuralType === 'domain')
  const domainHexes = new Map<string, string[]>(domains.map((domain) => [domain.id, []]))

  for (const region of regions) {
    const regionDomains = domains.filter((domain) => domain.regionId === region.id)
    if (!regionDomains.length) continue
    for (const hex of region.hexes) {
      if (strongholdHexes.has(hex)) continue
      const coords = parseHexId(hex)
      let nearest = regionDomains[0]
      let nearestDistance = Number.POSITIVE_INFINITY
      for (const domain of regionDomains) {
        const distance = hexDistance(coords, parseHexId(domain.hex))
        if (distance < nearestDistance) {
          nearestDistance = distance
          nearest = domain
        }
      }
      domainHexes.get(nearest.id)?.push(hex)
    }
  }

  return locations.map((location) => {
    if (location.structuralType !== 'domain') {
      const { hexes: _removed, ...rest } = location as MapLocation & { hexes?: string[] }
      return { ...rest }
    }
    return {
      ...location,
      hexes: [...(domainHexes.get(location.id) ?? (location.hex && !strongholdHexes.has(location.hex) ? [location.hex] : []))].sort(),
    }
  })
}

/** Sync regionId on every map object from its anchor hex. */
export function syncMapObjectRegionIds(locations: MapLocation[], regions: Region[]): MapLocation[] {
  return locations.map((location) => {
    const regionId = regionIdForHex(regions, location.hex)
    return regionId ? { ...location, regionId } : { ...location, regionId: location.regionId ?? '' }
  })
}

/** Full control owner of a region, or null when split / empty. */
export function regionController(region: Region, locations: MapLocation[]): FactionId | null {
  const objects = locations.filter((location) => location.regionId === region.id)
  if (!objects.length) return null
  const owner = objects[0].side === 'civilian' ? null : objects[0].side
  for (const object of objects) {
    const side = object.side === 'civilian' ? null : object.side
    if (side !== owner) return null
  }
  return owner
}

export function refreshRegionOwners(regions: Region[], locations: MapLocation[]): Region[] {
  return regions.map((region) => ({
    ...region,
    ownerFactionId: regionController(region, locations),
  }))
}

/** Land hexes that are not covered by any region (editor validation). */
export function uncoveredLandHexes(grid: HexGridData, regions: Region[]): string[] {
  const covered = new Set(regions.flatMap((region) => region.hexes))
  return Object.entries(grid.cells)
    .filter(([id, cell]) => cell.terrain !== 'water' && (cell.passable ?? true) && !covered.has(id))
    .map(([id]) => id)
}

export function addHexesToRegion(regions: Region[], regionId: string, hexIds: string[]): Region[] {
  const unique = [...new Set(hexIds)]
  return regions.map((region) => {
    if (region.id === regionId) {
      const hexes = new Set([...region.hexes, ...unique])
      return { ...region, hexes: [...hexes].sort() }
    }
    return { ...region, hexes: region.hexes.filter((hex) => !unique.includes(hex)) }
  })
}

export function removeHexesFromRegion(regions: Region[], regionId: string, hexIds: string[]): Region[] {
  const remove = new Set(hexIds)
  return regions.map((region) => (
    region.id === regionId
      ? { ...region, hexes: region.hexes.filter((hex) => !remove.has(hex)) }
      : region
  ))
}

/** Paint ownership on grid cells from domains / strongholds (editor display source of truth at runtime is resolveGrid). */
export function applyTerritoryOwners(grid: HexGridData, locations: MapLocation[], regions: Region[]): HexGridData {
  const resolved = resolveGrid(grid, locations, regions)
  const cells = { ...grid.cells }
  for (const cell of resolved.cells) {
    const existing = cells[cell.id]
    if (!existing && cell.owner == null && cell.regionId == null) continue
    cells[cell.id] = {
      q: cell.q,
      r: cell.r,
      ...(existing ?? {}),
      owner: cell.owner,
      regionId: cell.regionId,
    }
  }
  return { config: { ...grid.config }, cells }
}

export function makeRegionId(base: string, used: string[]) {
  const root = base.toLowerCase().trim().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-|-$/g, '') || 'region'
  let id = root.startsWith('region-') ? root : `region-${root}`
  let suffix = 2
  while (used.includes(id)) id = `${root.startsWith('region-') ? root : `region-${root}`}-${suffix++}`
  return id
}

export function regionCentroidHex(region: Region): string | null {
  if (!region.hexes.length) return null
  let sumQ = 0
  let sumR = 0
  for (const hex of region.hexes) {
    const { q, r } = parseHexId(hex)
    sumQ += q
    sumR += r
  }
  const average = { q: sumQ / region.hexes.length, r: sumR / region.hexes.length }
  let best = region.hexes[0]
  let bestDistance = Number.POSITIVE_INFINITY
  for (const hex of region.hexes) {
    const distance = hexDistance(average, parseHexId(hex))
    if (distance < bestDistance) {
      bestDistance = distance
      best = hex
    }
  }
  return best
}

export function mapObjectForRegionBattle(locations: MapLocation[], regionId: string | null, preferredHex?: string | null): MapLocation | null {
  if (!regionId) return null
  const inRegion = locations.filter((location) => location.regionId === regionId)
  if (!inRegion.length) return null
  if (preferredHex) {
    const onHex = inRegion.find((location) => location.hex === preferredHex)
    if (onHex) return onHex
  }
  return inRegion.find((location) => location.structuralType === 'domain' && location.rtsMapCache)
    ?? inRegion.find((location) => location.rtsMapCache)
    ?? inRegion.find((location) => location.structuralType === 'domain')
    ?? inRegion[0]
    ?? null
}

export { hexId }
