import { TERRAIN_BY_ID, WORLD_HEIGHT, WORLD_WIDTH } from '../constants'
import type {
  FactionId,
  HexGridData,
  HexGridConfig,
  LogicalHex,
  MapLocation,
  Region,
} from '../types'

export const HEX_DIRECTIONS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
] as const

export const hexId = (q: number, r: number) => `${q}:${r}`

export function parseHexId(id: string) {
  const [q, r] = id.split(':').map(Number)
  return { q, r }
}

export function axialToPixel(q: number, r: number, config: HexGridConfig) {
  return {
    x: config.originX + config.size * Math.sqrt(3) * (q + r / 2),
    y: config.originY + config.size * 1.5 * r,
  }
}

function roundAxial(q: number, r: number) {
  let x = q
  let z = r
  let y = -x - z
  let rx = Math.round(x)
  let ry = Math.round(y)
  let rz = Math.round(z)
  const xDifference = Math.abs(rx - x)
  const yDifference = Math.abs(ry - y)
  const zDifference = Math.abs(rz - z)

  if (xDifference > yDifference && xDifference > zDifference) rx = -ry - rz
  else if (yDifference > zDifference) ry = -rx - rz
  else rz = -rx - ry

  return { q: rx, r: rz }
}

export function pixelToAxial(x: number, y: number, config: HexGridConfig) {
  const px = (x - config.originX) / config.size
  const py = (y - config.originY) / config.size
  return roundAxial(
    (Math.sqrt(3) / 3) * px - (1 / 3) * py,
    (2 / 3) * py,
  )
}

export function locationHexId(location: MapLocation, _config: HexGridConfig) {
  return location.hex
}

export function hexCorners(hex: Pick<LogicalHex, 'x' | 'y'>, size: number) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = ((60 * index - 90) * Math.PI) / 180
    return {
      x: hex.x + size * Math.cos(angle),
      y: hex.y + size * Math.sin(angle),
    }
  })
}

export function polygonPoints(hex: Pick<LogicalHex, 'x' | 'y'>, size: number) {
  return hexCorners(hex, size).map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')
}

export function neighborIds(q: number, r: number) {
  return HEX_DIRECTIONS.map((direction) => hexId(q + direction.q, r + direction.r))
}

export function hexDistance(left: Pick<LogicalHex, 'q' | 'r'>, right: Pick<LogicalHex, 'q' | 'r'>) {
  const leftS = -left.q - left.r
  const rightS = -right.q - right.r
  return Math.max(Math.abs(left.q - right.q), Math.abs(left.r - right.r), Math.abs(leftS - rightS))
}

interface ResolvedGrid {
  cells: LogicalHex[]
  byId: Map<string, LogicalHex>
}

let cachedGrid: HexGridData | null = null
let cachedLocations: MapLocation[] | null = null
let cachedRegions: Region[] | null = null
let cachedResult: ResolvedGrid | null = null

export function resolveGrid(grid: HexGridData, locations: MapLocation[], regions: Region[] = []): ResolvedGrid {
  if (cachedGrid === grid && cachedLocations === locations && cachedRegions === regions && cachedResult) return cachedResult
  const { config } = grid

  // Top-level region membership comes from authored region.hexes.
  const regionByHex = new Map<string, string>()
  for (const region of regions) {
    for (const hex of region.hexes) regionByHex.set(hex, region.id)
  }

  // Domain territory is stored on the domain (or derived as nearest domain in-region).
  const domainByHex = new Map<string, MapLocation>()
  const strongholdByHex = new Map<string, MapLocation>()
  const locationIds = new Map<string, string[]>()
  const locationAnchors = locations.map((location) => {
    const id = locationHexId(location, config)
    const coordinates = parseHexId(id)
    locationIds.set(id, [...(locationIds.get(id) ?? []), location.id])
    if (location.structuralType === 'stronghold') strongholdByHex.set(id, location)
    return { location, id, ...coordinates }
  })

  const domains = locations.filter((location) => location.structuralType === 'domain')
  for (const domain of domains) {
    const owned = domain.hexes?.length ? domain.hexes : [domain.hex]
    for (const hex of owned) {
      if (strongholdByHex.has(hex)) continue
      domainByHex.set(hex, domain)
    }
  }

  // Fill any region hex not yet claimed by a stored domain hex list.
  const domainsByRegion = new Map<string, MapLocation[]>()
  for (const domain of domains) {
    if (!domain.regionId) continue
    const list = domainsByRegion.get(domain.regionId) ?? []
    list.push(domain)
    domainsByRegion.set(domain.regionId, list)
  }
  for (const region of regions) {
    const regionDomains = domainsByRegion.get(region.id) ?? []
    if (!regionDomains.length) continue
    for (const hex of region.hexes) {
      if (domainByHex.has(hex) || strongholdByHex.has(hex)) continue
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
      domainByHex.set(hex, nearest)
    }
  }

  const cells: LogicalHex[] = []
  const minimumR = Math.floor((-config.originY) / (1.5 * config.size)) - 1
  const maximumR = Math.ceil((WORLD_HEIGHT - config.originY) / (1.5 * config.size)) + 1

  for (let r = minimumR; r <= maximumR; r += 1) {
    const base = config.size * Math.sqrt(3)
    const minimumQ = Math.floor((-config.originX) / base - r / 2) - 1
    const maximumQ = Math.ceil((WORLD_WIDTH - config.originX) / base - r / 2) + 1

    for (let q = minimumQ; q <= maximumQ; q += 1) {
      const position = axialToPixel(q, r, config)
      if (
        position.x < -config.size || position.x > WORLD_WIDTH + config.size
        || position.y < -config.size || position.y > WORLD_HEIGHT + config.size
      ) continue

      const id = hexId(q, r)
      const override = grid.cells[id]
      const terrain = override?.terrain ?? 'plains'
      const terrainDefinition = TERRAIN_BY_ID[terrain]
      let nearestLocationId: string | null = null
      let nearestDistance = Number.POSITIVE_INFINITY
      for (const anchor of locationAnchors) {
        const distance = hexDistance({ q, r }, anchor)
        if (distance < nearestDistance) {
          nearestDistance = distance
          nearestLocationId = anchor.location.id
        }
      }

      const stronghold = strongholdByHex.get(id)
      const domain = domainByHex.get(id) ?? null
      const regionId = override?.regionId !== undefined && override.regionId !== null
        ? override.regionId
        : regionByHex.get(id) ?? stronghold?.regionId ?? domain?.regionId ?? null
      const territoryOwner = stronghold
        ? (stronghold.side === 'civilian' ? null : stronghold.side)
        : domain
          ? (domain.side === 'civilian' ? null : domain.side)
          : null

      cells.push({
        id,
        q,
        r,
        x: position.x,
        y: position.y,
        terrain,
        moveCost: override?.moveCost ?? terrainDefinition.moveCost,
        owner: override?.owner !== undefined ? override.owner : territoryOwner,
        zoneOfControl: override?.zoneOfControl ?? null,
        regionId,
        domainId: stronghold ? null : domain?.id ?? null,
        passable: override?.passable ?? terrainDefinition.passable,
        road: override?.road ?? false,
        river: override?.river ?? false,
        ford: override?.ford ?? false,
        bridge: override?.bridge ?? false,
        locationIds: locationIds.get(id) ?? [],
        nearestLocationId,
      })
    }
  }

  cachedGrid = grid
  cachedLocations = locations
  cachedRegions = regions
  cachedResult = {
    cells,
    byId: new Map(cells.map((cell) => [cell.id, cell])),
  }
  return cachedResult
}

export function cellMovementCost(cell: LogicalHex, movingFaction: FactionId | null) {
  if (!cell.passable) return Number.POSITIVE_INFINITY
  let cost = Math.max(1, cell.moveCost)
  if (cell.road) cost = Math.max(1, cost - 1)
  if (cell.river) cost += cell.bridge ? 1 : cell.ford ? 2 : 3
  if (cell.zoneOfControl && cell.zoneOfControl !== movingFaction) cost += 2
  return cost
}

class PriorityQueue<T> {
  private items: Array<{ value: T; priority: number }> = []

  push(value: T, priority: number) {
    this.items.push({ value, priority })
    let index = this.items.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (this.items[parent].priority <= this.items[index].priority) break
      ;[this.items[parent], this.items[index]] = [this.items[index], this.items[parent]]
      index = parent
    }
  }

  pop(): T | undefined {
    if (!this.items.length) return undefined
    const root = this.items[0].value
    const last = this.items.pop()!
    if (this.items.length) {
      this.items[0] = last
      let index = 0
      while (true) {
        const left = index * 2 + 1
        const right = left + 1
        let smallest = index
        if (left < this.items.length && this.items[left].priority < this.items[smallest].priority) smallest = left
        if (right < this.items.length && this.items[right].priority < this.items[smallest].priority) smallest = right
        if (smallest === index) break
        ;[this.items[index], this.items[smallest]] = [this.items[smallest], this.items[index]]
        index = smallest
      }
    }
    return root
  }

  get length() { return this.items.length }
}

export function findReachable(
  cells: Map<string, LogicalHex>,
  startId: string,
  budget: number,
  faction: FactionId | null,
  stopAt: Set<string> = new Set(),
) {
  const costs = new Map<string, number>([[startId, 0]])
  const frontier = new PriorityQueue<string>()
  frontier.push(startId, 0)

  while (frontier.length) {
    const currentId = frontier.pop()!
    const current = cells.get(currentId)
    const currentCost = costs.get(currentId)!
    if (!current || currentCost > budget) continue

    for (const neighborId of neighborIds(current.q, current.r)) {
      const neighbor = cells.get(neighborId)
      if (!neighbor) continue
      const nextCost = currentCost + cellMovementCost(neighbor, faction)
      if (nextCost > budget || nextCost >= (costs.get(neighborId) ?? Number.POSITIVE_INFINITY)) continue
      costs.set(neighborId, nextCost)
      if (!stopAt.has(neighborId)) frontier.push(neighborId, nextCost)
    }
  }

  return costs
}

export function findPath(
  cells: Map<string, LogicalHex>,
  startId: string,
  destinationId: string,
  faction: FactionId | null,
) {
  if (startId === destinationId) return [startId]
  const start = cells.get(startId)
  const destination = cells.get(destinationId)
  if (!start || !destination || !destination.passable) return []

  const frontier = new PriorityQueue<string>()
  const cameFrom = new Map<string, string>()
  const costs = new Map<string, number>([[startId, 0]])
  frontier.push(startId, 0)

  while (frontier.length) {
    const currentId = frontier.pop()!
    if (currentId === destinationId) break
    const current = cells.get(currentId)
    if (!current) continue

    for (const neighborId of neighborIds(current.q, current.r)) {
      const neighbor = cells.get(neighborId)
      if (!neighbor) continue
      const stepCost = cellMovementCost(neighbor, faction)
      if (!Number.isFinite(stepCost)) continue
      const nextCost = costs.get(currentId)! + stepCost
      if (nextCost >= (costs.get(neighborId) ?? Number.POSITIVE_INFINITY)) continue
      costs.set(neighborId, nextCost)
      cameFrom.set(neighborId, currentId)
      frontier.push(neighborId, nextCost + hexDistance(neighbor, destination))
    }
  }

  if (!cameFrom.has(destinationId)) return []
  const path = [destinationId]
  while (path[0] !== startId) path.unshift(cameFrom.get(path[0])!)
  return path
}

export function pathMovementCost(path: string[], cells: Map<string, LogicalHex>, faction: FactionId | null) {
  return path.slice(1).reduce((total, id) => total + cellMovementCost(cells.get(id)!, faction), 0)
}

/** Smooth quadratic route through logical hex centres. */
export function smoothRoutePath(path: string[], cells: Map<string, LogicalHex>) {
  const points = path.map((id) => cells.get(id)).filter(Boolean) as LogicalHex[]
  if (points.length < 2) return ''
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`
  let result = `M ${points[0].x} ${points[0].y}`
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index]
    const next = points[index + 1]
    const middleX = (current.x + next.x) / 2
    const middleY = (current.y + next.y) / 2
    result += ` Q ${current.x} ${current.y} ${middleX} ${middleY}`
  }
  const last = points[points.length - 1]
  result += ` T ${last.x} ${last.y}`
  return result
}
