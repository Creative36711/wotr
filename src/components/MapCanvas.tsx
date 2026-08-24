import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { areFactionsHostile, getFaction, TERRAIN_BY_ID, WORLD_HEIGHT, WORLD_WIDTH } from '../constants'
import { armyMovementCap, armyUnitSlotCap, commanderDefinition } from '../game/army'
import { canPlayerMoveArmy } from '../game/campaign'
import { armyIntelLabel, calculateVisibleHexes } from '../game/fogOfWar'
import {
  findPath,
  findReachable,
  hexCorners,
  locationHexId,
  neighborIds,
  pathMovementCost,
  pixelToAxial,
  polygonPoints,
  resolveGrid,
  smoothRoutePath,
} from '../hex/hexGrid'
import { useMapStore } from '../store/useMapStore'
import { translateText } from '../i18n'
import type { LogicalHex, MapLocation, MapViewMode } from '../types'

interface Camera { x: number; y: number; scale: number }
interface Point { x: number; y: number }
interface FocusTarget { id: string; nonce: number }
interface MapCanvasProps { focusTarget: FocusTarget | null; mapImageUrl: string }
interface Gesture {
  pointerId: number
  type: 'pan' | 'pin' | 'box'
  startClientX: number
  startClientY: number
  startCameraX: number
  startCameraY: number
  locationId?: string
  startWorldX?: number
  startWorldY?: number
  additive?: boolean
}

type HexTool = 'select' | 'pan'

const EDIT_MIN_SCALE = 0.08
const EDIT_MAX_SCALE = 2.4
const GAME_MAX_SCALE = 0.95
const DRAG_THRESHOLD = 3
const GRID_CANVAS_SCALE = 0.5

function fanOffset(index: number, total: number, radius: number, centerDegrees: number) {
  if (total <= 1) {
    const angle = centerDegrees * Math.PI / 180
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
  }
  const spread = Math.min(150, 44 * (total - 1))
  const angle = (centerDegrees - spread / 2 + spread * index / Math.max(1, total - 1)) * Math.PI / 180
  const ring = index >= 6 ? radius + 18 : radius
  return { x: Math.cos(angle) * ring, y: Math.sin(angle) * ring }
}

function gameMinimumScale(width: number, height: number) {
  return Math.max(width / WORLD_WIDTH, height / WORLD_HEIGHT)
}

function constrainGameCamera(camera: Camera, width: number, height: number): Camera {
  const minimumScale = gameMinimumScale(width, height)
  const maximumScale = Math.max(minimumScale, GAME_MAX_SCALE)
  const scale = Math.max(minimumScale, Math.min(maximumScale, camera.scale))
  const scaledWidth = WORLD_WIDTH * scale
  const scaledHeight = WORLD_HEIGHT * scale
  const minimumX = width - scaledWidth
  const minimumY = height - scaledHeight
  return {
    scale,
    x: scaledWidth <= width ? (width - scaledWidth) / 2 : Math.max(minimumX, Math.min(0, camera.x)),
    y: scaledHeight <= height ? (height - scaledHeight) / 2 : Math.max(minimumY, Math.min(0, camera.y)),
  }
}

function traceHex(context: CanvasRenderingContext2D, cell: LogicalHex, size: number) {
  const corners = hexCorners(cell, size)
  context.moveTo(corners[0].x, corners[0].y)
  for (let index = 1; index < corners.length; index += 1) context.lineTo(corners[index].x, corners[index].y)
  context.closePath()
}

function colorWithAlpha(color: string, alpha: number) {
  const value = color.replace('#', '')
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function KeepIcon() {
  return (
    <svg viewBox="0 0 26 30" aria-hidden="true">
      <path d="M3 4h5v4h3V3h4v5h3V4h5v9l-2 2v10l2 2H3l2-2V15l-2-2V4Zm7 13v8h6v-8a3 3 0 0 0-6 0Z" />
    </svg>
  )
}

function PlaceIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6"/><circle className="pin-core" cx="10" cy="10" r="2"/></svg>
}
const ECONOMIC_ICONS:Record<string,string>={village:'●',city:'◆',capital:'♛',port:'⚓',mine:'♦',farm:'♧',wilderness:'○',swamp:'≋',forest:'♠',mountains:'▲',ruins:'⌂',crossroads:'✣',ford:'≈',pass:'⌁',signal_tower:'♜',camp:'△'}
function EconomicLocationIcon({type}:{type:MapLocation['economicType']}){return type==='fortress'?<KeepIcon/>:<span className="economic-location-icon">{ECONOMIC_ICONS[type]??<PlaceIcon/>}</span>}

const VIEW_MODES: Array<{ id: MapViewMode; label: string; icon: string; hint: string }> = [
  { id: 'cinematic', label: 'Карта', icon: '◉', hint: 'Кинематографический режим: сетка скрыта' },
  { id: 'tactical', label: 'Тактика', icon: '⌁', hint: 'Область хода, маршрут и активный гекс' },
  { id: 'strategic', label: 'Сетка', icon: '⬡', hint: 'Точный стратегический режим (G)' },
]

export default function MapCanvas({ focusTarget, mapImageUrl }: MapCanvasProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const gridCanvasRef = useRef<HTMLCanvasElement>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const initializedRef = useRef(false)
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, scale: 0.2 })
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [dragPreview, setDragPreview] = useState<Record<string, string>>({})
  const [hoveredHexId, setHoveredHexId] = useState<string | null>(null)
  const [cursor, setCursor] = useState({ x: 0, y: 0 })
  const [hexTool, setHexTool] = useState<HexTool>('select')
  const [showRegions, setShowRegions] = useState(false)
  const [selectionBox, setSelectionBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  const locations = useMapStore((state) => state.locations)
  const unitTypes = useMapStore((state) => state.unitTypes)
  const grid = useMapStore((state) => state.grid)
  const factions = useMapStore((state) => state.factions)
  const regions = useMapStore((state) => state.regions)
  const armies = useMapStore((state) => state.armies)
  const heroes = useMapStore((state) => state.heroes)
  const captains = useMapStore((state) => state.captains)
  const campaign = useMapStore((state) => state.campaign)
  const selectedId = useMapStore((state) => state.selectedId)
  const selectedArmyId = useMapStore((state) => state.selectedArmyId)
  const selectedHexId = useMapStore((state) => state.selectedHexId)
  const selectedHexIds = useMapStore((state) => state.selectedHexIds)
  const mode = useMapStore((state) => state.mode)
  const viewMode = useMapStore((state) => state.viewMode)
  const hexEdit = useMapStore((state) => state.hexEdit)
  const addKind = useMapStore((state) => state.addKind)
  const select = useMapStore((state) => state.select)
  const selectArmy = useMapStore((state) => state.selectArmy)
  const selectHex = useMapStore((state) => state.selectHex)
  const selectHexes = useMapStore((state) => state.selectHexes)
  const clearSelection = useMapStore((state) => state.clearSelection)
  const setViewMode = useMapStore((state) => state.setViewMode)
  const setHexEdit = useMapStore((state) => state.setHexEdit)
  const moveLocation = useMapStore((state) => state.moveLocation)
  const addLocation = useMapStore((state) => state.addLocation)
  const setAddKind = useMapStore((state) => state.setAddKind)
  const moveArmy = useMapStore((state) => state.moveArmy)
  const cancelArmyOrder=useMapStore((state)=>state.cancelArmyOrder)

  const logicalGrid = useMemo(() => resolveGrid(grid, locations, regions), [grid, locations, regions])
  const fogEnabled = mode === 'game' && campaign.fogOfWar.enabled
  const fogOverlayVisible = fogEnabled && campaign.fogOfWar.overlayVisible
  const visibleHexes = useMemo(() => mode === 'game' ? calculateVisibleHexes(campaign, armies, locations, factions, grid, regions) : new Set(logicalGrid.cells.map((cell) => cell.id)), [armies, campaign, factions, grid, locations, logicalGrid, mode, regions])
  const lastSeenArmyById = useMemo(() => new Map(campaign.fogOfWar.lastSeenArmies.map((intel) => [intel.armyId, intel])), [campaign.fogOfWar.lastSeenArmies])
  const lastSeenLocationById = useMemo(() => new Map(campaign.fogOfWar.lastSeenLocations.map((intel) => [intel.locationId, intel])), [campaign.fogOfWar.lastSeenLocations])
  const selectedArmy = useMemo(() => armies.find((army) => army.id === selectedArmyId) ?? null, [armies, selectedArmyId])
  const selectedCommander = selectedArmy ? commanderDefinition(selectedArmy, heroes, captains) : null
  const originHexId = selectedArmy?.hexId ?? null
  const movingFaction = selectedArmy?.factionId ?? null
  const movementBudget = selectedArmy?.movementRemaining ?? 0
  const enemyHexIds = useMemo(() => new Set(armies.filter((army) => areFactionsHostile(factions, army.factionId, movingFaction) && (!fogEnabled || visibleHexes.has(army.hexId))).map((army) => army.hexId)), [armies, factions, fogEnabled, movingFaction, visibleHexes])
  const reachable = useMemo(() => {
    if (viewMode !== 'tactical' || !originHexId || (mode === 'game' && selectedArmy && (!canPlayerMoveArmy(campaign, factions, selectedArmy.factionId) || !selectedCommander || selectedArmy.engaged))) return new Map<string, number>()
    return findReachable(logicalGrid.byId, originHexId, movementBudget, movingFaction, enemyHexIds)
  }, [campaign.activeFactionId, campaign.phase, enemyHexIds, logicalGrid, mode, movementBudget, movingFaction, originHexId, selectedArmy, selectedCommander, viewMode])
  const routeTargetId = hoveredHexId ?? selectedHexId
  const route = useMemo(() => {
    if (viewMode !== 'tactical' || !originHexId || !routeTargetId) return []
    const result = findPath(logicalGrid.byId, originHexId, routeTargetId, movingFaction)
    return result.some((id, index) => index > 0 && index < result.length - 1 && enemyHexIds.has(id)) ? [] : result
  }, [enemyHexIds, logicalGrid, movingFaction, originHexId, routeTargetId, viewMode])
  const routeCost = useMemo(
    () => pathMovementCost(route, logicalGrid.byId, movingFaction),
    [logicalGrid, movingFaction, route],
  )
  const routePath = useMemo(() => smoothRoutePath(route, logicalGrid.byId), [logicalGrid, route])
  const pendingOrderPaths=useMemo(()=>campaign.pendingOrders.map((order)=>({order,path:smoothRoutePath(order.path,logicalGrid.byId),army:armies.find((army)=>army.id===order.armyId)})).filter((item)=>item.path&&item.army),[campaign.pendingOrders,logicalGrid,armies])
  const hoveredHex = hoveredHexId ? logicalGrid.byId.get(hoveredHexId) ?? null : null
  const placementActive=Boolean(addKind||gestureRef.current?.type==='pin')
  const placementOccupied=Boolean(hoveredHex&&locations.some((location)=>location.hex===hoveredHex.id&&location.id!==gestureRef.current?.locationId))
  const hoverNeighbors = useMemo(
    () => hoveredHex ? neighborIds(hoveredHex.q, hoveredHex.r).map((id) => logicalGrid.byId.get(id)).filter(Boolean) as LogicalHex[] : [],
    [hoveredHex, logicalGrid],
  )
  const reachableBoundary = useMemo(() => new Set(
    [...reachable.keys()].filter((id) => {
      const cell = logicalGrid.byId.get(id)
      return cell && neighborIds(cell.q, cell.r).some((neighborId) => !reachable.has(neighborId))
    }),
  ), [logicalGrid, reachable])

  useEffect(() => {
    if (hexEdit) setHexTool('select')
    else setSelectionBox(null)
  }, [hexEdit])

  useEffect(() => {
    const canvas = gridCanvasRef.current
    if (!canvas) return
    const width = Math.ceil(WORLD_WIDTH * GRID_CANVAS_SCALE)
    const height = Math.ceil(WORLD_HEIGHT * GRID_CANVAS_SCALE)
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, canvas.width, canvas.height)
    if (viewMode === 'cinematic' && !hexEdit && !showRegions) return
    context.setTransform(GRID_CANVAS_SCALE, 0, 0, GRID_CANVAS_SCALE, 0, 0)
    const lineWidth = Math.min(7, Math.max(1.2, 1 / Math.max(camera.scale, .01)))
    const displayOwnerForCell = (cell: LogicalHex) => {
      if (!fogEnabled || visibleHexes.has(cell.id)) return cell.owner
      const region = cell.regionId ? regions.find((item) => item.id === cell.regionId) : null
      const intel = region?.locationId ? lastSeenLocationById.get(region.locationId) : null
      return intel?.lastKnownOwner ?? null
    }

    if (showRegions) {
      const cellsByRegion = new Map<string, LogicalHex[]>()
      for (const cell of logicalGrid.cells) {
        if (!cell.regionId || !cell.passable) continue
        cellsByRegion.set(cell.regionId, [...(cellsByRegion.get(cell.regionId) ?? []), cell])
      }
      const edgePairs = [[1,2],[0,1],[5,0],[4,5],[3,4],[2,3]] as const
      for (const [regionId, cells] of cellsByRegion) {
        const region = regions.find((item) => item.id === regionId)
        const regionVisible = !fogEnabled || cells.some((cell) => visibleHexes.has(cell.id))
        const knownOwner = regionVisible ? region?.ownerFactionId : region?.locationId ? lastSeenLocationById.get(region.locationId)?.lastKnownOwner : null
        const color = getFaction(factions, knownOwner).color
        context.beginPath()
        for (const cell of cells) traceHex(context, cell, grid.config.size * 1.005)
        context.fillStyle = colorWithAlpha(color, .14)
        context.fill()
        context.beginPath()
        for (const cell of cells) {
          const corners = hexCorners(cell, grid.config.size)
          const neighbors = neighborIds(cell.q, cell.r)
          neighbors.forEach((neighborId, directionIndex) => {
            if (logicalGrid.byId.get(neighborId)?.regionId === regionId) return
            const [from, to] = edgePairs[directionIndex]
            context.moveTo(corners[from].x, corners[from].y)
            context.lineTo(corners[to].x, corners[to].y)
          })
        }
        context.strokeStyle = colorWithAlpha(color, .9)
        context.lineWidth = lineWidth * 2.2
        context.stroke()
      }
      if (camera.scale >= .2) {
        const fontSize = 13 / camera.scale
        context.textAlign = 'center'; context.textBaseline = 'middle'
        for (const region of regions) {
          const location = locations.find((item) => item.id === region.locationId)
          if (!location) continue
          const cell = logicalGrid.byId.get(locationHexId(location, grid.config))
          if (!cell) continue
          context.font = `700 ${fontSize}px Cinzel, Georgia, serif`
          context.lineWidth = 4 / camera.scale
          context.strokeStyle = 'rgba(6,10,12,.9)'; context.fillStyle = 'rgba(235,224,195,.9)'
          const localizedRegionName=translateText(region.name)
          context.strokeText(localizedRegionName, cell.x, cell.y + grid.config.size * .58)
          context.fillText(localizedRegionName, cell.x, cell.y + grid.config.size * .58)
        }
      }
    }

    if(showRegions||viewMode==='strategic'||hexEdit){for(const location of locations.filter((item)=>item.structuralType==='stronghold')){const cell=logicalGrid.byId.get(location.hex);if(!cell)continue;context.beginPath();traceHex(context,cell,grid.config.size*.97);const color=getFaction(factions,location.side).color;context.fillStyle=colorWithAlpha(color,.3);context.fill();context.strokeStyle=colorWithAlpha(color,.95);context.lineWidth=lineWidth*2.2;context.stroke()}}

    if (viewMode === 'strategic' || hexEdit) {
      const ownerGroups = new Map<string, LogicalHex[]>()
      for (const cell of logicalGrid.cells) {
        const displayOwner = displayOwnerForCell(cell)
        if (!displayOwner || !cell.passable) continue
        ownerGroups.set(displayOwner, [...(ownerGroups.get(displayOwner) ?? []), cell])
      }
      for (const [ownerId, cells] of ownerGroups) {
        context.beginPath()
        for (const cell of cells) traceHex(context, cell, grid.config.size)
        context.fillStyle = colorWithAlpha(getFaction(factions, ownerId).color, showRegions ? .025 : .055)
        context.fill()
      }
      context.beginPath()
      for (const cell of logicalGrid.cells) traceHex(context, cell, grid.config.size)
      context.strokeStyle = 'rgba(222, 210, 175, .34)'
      context.lineWidth = lineWidth
      context.stroke()

      for (const cell of logicalGrid.cells) {
        if (!grid.cells[cell.id]) continue
        context.beginPath()
        traceHex(context, cell, grid.config.size - lineWidth)
        context.fillStyle = colorWithAlpha(TERRAIN_BY_ID[cell.terrain].color, cell.passable ? .18 : .22)
        context.fill()
        context.strokeStyle = colorWithAlpha(TERRAIN_BY_ID[cell.terrain].color, .78)
        context.lineWidth = lineWidth * 1.15
        context.setLineDash(cell.passable ? [] : [lineWidth * 4, lineWidth * 3])
        context.stroke()
      }
      context.setLineDash([])

      if (camera.scale >= .38) {
        const fontSize = 10 / camera.scale
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        for (const cell of logicalGrid.cells) {
          context.font = `600 ${fontSize}px ui-monospace, SFMono-Regular, Consolas, monospace`
          context.lineWidth = 3 / camera.scale
          context.strokeStyle = 'rgba(7, 11, 13, .88)'
          context.fillStyle = 'rgba(238, 224, 187, .76)'
          const coordinate = `${cell.q},${cell.r}`
          context.strokeText(coordinate, cell.x, cell.y - fontSize * .32)
          context.fillText(coordinate, cell.x, cell.y - fontSize * .32)
          context.font = `500 ${fontSize * .72}px ui-monospace, SFMono-Regular, Consolas, monospace`
          context.fillStyle = 'rgba(181, 193, 186, .68)'
          context.fillText(cell.passable ? String(cell.moveCost) : '×', cell.x, cell.y + fontSize * .55)
        }
      }
    }

    if (selectedHexIds.length > 0) {
      context.beginPath()
      for (const id of selectedHexIds) {
        const cell = logicalGrid.byId.get(id)
        if (cell) traceHex(context, cell, grid.config.size * .91)
      }
      context.fillStyle = 'rgba(83, 153, 184, .22)'
      context.fill()
      context.strokeStyle = 'rgba(145, 210, 232, .95)'
      context.lineWidth = lineWidth * 2
      context.stroke()
    }
  }, [camera.scale, factions, fogEnabled, grid.cells, grid.config, hexEdit, lastSeenLocationById, locations, logicalGrid, regions, selectedHexIds, showRegions, viewMode, visibleHexes])

  const fitMap = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const scale = mode === 'game'
      ? gameMinimumScale(rect.width, rect.height)
      : Math.min(rect.width / WORLD_WIDTH, rect.height / WORLD_HEIGHT) * 0.965
    const next = { scale, x: (rect.width - WORLD_WIDTH * scale) / 2, y: (rect.height - WORLD_HEIGHT * scale) / 2 }
    setCamera(mode === 'game' ? constrainGameCamera(next, rect.width, rect.height) : next)
  }, [mode])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setStageSize({ width, height })
      if (!initializedRef.current && width > 0 && height > 0) {
        initializedRef.current = true
        requestAnimationFrame(fitMap)
      } else if (mode === 'game' && width > 0 && height > 0) {
        setCamera((current) => constrainGameCamera(current, width, height))
      }
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [fitMap, mode])

  useEffect(() => {
    requestAnimationFrame(fitMap)
  }, [fitMap, mode])

  useEffect(() => {
    if (!focusTarget || !stageRef.current) return
    const location = locations.find((item) => item.id === focusTarget.id)
    const army=armies.find((item)=>item.id===focusTarget.id)
    const targetCell=location?logicalGrid.byId.get(location.hex):army?logicalGrid.byId.get(army.hexId):null
    if(!targetCell)return
    const target=targetCell
    const rect = stageRef.current.getBoundingClientRect()
    setCamera((current) => {
      const scale = Math.max(current.scale, Math.min(rect.width / 2200, 0.55))
      const next = {
        scale: mode === 'game' ? Math.min(GAME_MAX_SCALE, scale) : scale,
        x: rect.width / 2 - target.x * scale,
        y: rect.height / 2 - target.y * scale,
      }
      return mode === 'game' ? constrainGameCamera(next, rect.width, rect.height) : next
    })
  }, [armies,focusTarget,locations,logicalGrid,mode])

  const screenToWorld = useCallback((clientX: number, clientY: number): Point => {
    const rect = stageRef.current!.getBoundingClientRect()
    return {
      x: (clientX - rect.left - camera.x) / camera.scale,
      y: (clientY - rect.top - camera.y) / camera.scale,
    }
  }, [camera])

  const hexAtScreenPoint = useCallback((clientX: number, clientY: number) => {
    const point = screenToWorld(clientX, clientY)
    const axial = pixelToAxial(point.x, point.y, grid.config)
    return logicalGrid.byId.get(`${axial.q}:${axial.r}`) ?? null
  }, [grid.config, logicalGrid, screenToWorld])

  const updateHover = (clientX: number, clientY: number) => {
    const rect = stageRef.current!.getBoundingClientRect()
    setCursor({ x: clientX - rect.left, y: clientY - rect.top })
    if (viewMode === 'cinematic' && !hexEdit && !showRegions) {
      setHoveredHexId(null)
      return
    }
    setHoveredHexId(hexAtScreenPoint(clientX, clientY)?.id ?? null)
  }

  const zoomAtCenter = useCallback((factor: number) => {
    const stage = stageRef.current
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    setCamera((current) => {
      const minimumScale = mode === 'game' ? gameMinimumScale(rect.width, rect.height) : EDIT_MIN_SCALE
      const maximumScale = mode === 'game' ? Math.max(minimumScale, GAME_MAX_SCALE) : EDIT_MAX_SCALE
      const nextScale = Math.max(minimumScale, Math.min(maximumScale, current.scale * factor))
      const centerX = rect.width / 2
      const centerY = rect.height / 2
      const worldX = (centerX - current.x) / current.scale
      const worldY = (centerY - current.y) / current.scale
      const next = { scale: nextScale, x: centerX - worldX * nextScale, y: centerY - worldY * nextScale }
      return mode === 'game' ? constrainGameCamera(next, rect.width, rect.height) : next
    })
  }, [mode])

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const pointerX = event.clientX - rect.left
    const pointerY = event.clientY - rect.top
    setCamera((current) => {
      const minimumScale = mode === 'game' ? gameMinimumScale(rect.width, rect.height) : EDIT_MIN_SCALE
      const maximumScale = mode === 'game' ? Math.max(minimumScale, GAME_MAX_SCALE) : EDIT_MAX_SCALE
      const nextScale = Math.max(minimumScale, Math.min(maximumScale, current.scale * Math.exp(-event.deltaY * 0.0012)))
      const worldX = (pointerX - current.x) / current.scale
      const worldY = (pointerY - current.y) / current.scale
      const next = { scale: nextScale, x: pointerX - worldX * nextScale, y: pointerY - worldY * nextScale }
      return mode === 'game' ? constrainGameCamera(next, rect.width, rect.height) : next
    })
  }

  const handleStagePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const shouldBoxSelect = event.button === 0 && hexEdit && hexTool === 'select' && !event.altKey
    if (shouldBoxSelect) {
      const world = screenToWorld(event.clientX, event.clientY)
      const rect = event.currentTarget.getBoundingClientRect()
      gestureRef.current = {
        pointerId: event.pointerId,
        type: 'box',
        startClientX: event.clientX,
        startClientY: event.clientY,
        startCameraX: camera.x,
        startCameraY: camera.y,
        startWorldX: world.x,
        startWorldY: world.y,
        additive: event.shiftKey || event.ctrlKey || event.metaKey,
      }
      setSelectionBox({ left: event.clientX - rect.left, top: event.clientY - rect.top, width: 0, height: 0 })
      return
    }
    gestureRef.current = {
      pointerId: event.pointerId,
      type: 'pan',
      startClientX: event.clientX,
      startClientY: event.clientY,
      startCameraX: camera.x,
      startCameraY: camera.y,
    }
    setIsPanning(true)
  }

  const affordableOrder=(army:typeof armies[number],targetHexId:string)=>{const calculated=findPath(logicalGrid.byId,army.hexId,targetHexId,army.factionId);const interception=calculated.findIndex((id,index)=>index>0&&enemyHexIds.has(id));const full=interception>0?calculated.slice(0,interception+1):calculated;if(full.length<2)return null;let selected=full.slice(0,2);for(let length=2;length<=full.length;length++){const candidate=full.slice(0,length);if(pathMovementCost(candidate,logicalGrid.byId,army.factionId)>army.movementRemaining)break;selected=candidate}const cost=pathMovementCost(selected,logicalGrid.byId,army.factionId);return cost<=army.movementRemaining?{path:selected,destinationId:selected.at(-1)!,cost}:null}

  const handlePinPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, location: MapLocation) => {
    event.stopPropagation()
    if (hexEdit) return // Маркеры не сбрасывают массовое выделение гексов.
    if (mode === 'game' && selectedArmy && canPlayerMoveArmy(campaign, factions, selectedArmy.factionId) && !selectedArmy.engaged) {
      const order=affordableOrder(selectedArmy,location.hex)
      const destination=order?logicalGrid.byId.get(order.destinationId):null
      if(order&&destination){moveArmy(selectedArmy.id,order.destinationId,order.path,order.cost,destination.terrain,order.destinationId===location.hex?location.id:null);return}
    }
    select(location.id)
    if (event.button !== 0 || mode !== 'edit') return
    stageRef.current?.setPointerCapture(event.pointerId)
    gestureRef.current = {
      pointerId: event.pointerId,
      type: 'pin',
      startClientX: event.clientX,
      startClientY: event.clientY,
      startCameraX: camera.x,
      startCameraY: camera.y,
      locationId: location.id,
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) {
      updateHover(event.clientX, event.clientY)
      return
    }
    if (gesture.type === 'pan') {
      setHoveredHexId(null)
      setCamera((current) => {
        const next = {
          ...current,
          x: gesture.startCameraX + event.clientX - gesture.startClientX,
          y: gesture.startCameraY + event.clientY - gesture.startClientY,
        }
        if (mode !== 'game' || !stageRef.current) return next
        const rect = stageRef.current.getBoundingClientRect()
        return constrainGameCamera(next, rect.width, rect.height)
      })
      return
    }
    if (gesture.type === 'box') {
      const rect = stageRef.current!.getBoundingClientRect()
      const startX = gesture.startClientX - rect.left
      const startY = gesture.startClientY - rect.top
      const currentX = event.clientX - rect.left
      const currentY = event.clientY - rect.top
      setSelectionBox({
        left: Math.min(startX, currentX),
        top: Math.min(startY, currentY),
        width: Math.abs(currentX - startX),
        height: Math.abs(currentY - startY),
      })
      updateHover(event.clientX, event.clientY)
      return
    }
    if(gesture.locationId&&mode==='edit'&&!hexEdit){const cell=hexAtScreenPoint(event.clientX,event.clientY);if(cell)setDragPreview({[gesture.locationId]:cell.id});setHoveredHexId(cell?.id??null)}
  }

  const finishGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const distance = Math.hypot(event.clientX - gesture.startClientX, event.clientY - gesture.startClientY)

    if (gesture.type === 'pin' && gesture.locationId) {
      if(mode==='edit'&&!hexEdit&&distance>=DRAG_THRESHOLD){const cell=hexAtScreenPoint(event.clientX,event.clientY);if(cell)moveLocation(gesture.locationId,cell.id)}
      setDragPreview({})
    } else if (gesture.type === 'box') {
      if (distance < DRAG_THRESHOLD) {
        const cell = hexAtScreenPoint(event.clientX, event.clientY)
        if (cell) selectHex(cell.id, gesture.additive ? 'toggle' : 'replace')
        else if (!gesture.additive) selectHex(null)
      } else {
        const end = screenToWorld(event.clientX, event.clientY)
        const minimumX = Math.min(gesture.startWorldX!, end.x)
        const maximumX = Math.max(gesture.startWorldX!, end.x)
        const minimumY = Math.min(gesture.startWorldY!, end.y)
        const maximumY = Math.max(gesture.startWorldY!, end.y)
        const ids = logicalGrid.cells
          .filter((cell) => cell.x >= minimumX && cell.x <= maximumX && cell.y >= minimumY && cell.y <= maximumY)
          .map((cell) => cell.id)
        selectHexes(ids, gesture.additive ? 'add' : 'replace')
      }
      setSelectionBox(null)
    } else if (gesture.type === 'pan') {
      if (distance < DRAG_THRESHOLD) {
        if (addKind && mode === 'edit' && !hexEdit) {
          const cell=hexAtScreenPoint(event.clientX,event.clientY)
          if(cell)addLocation(addKind,cell.id)
        } else if (viewMode !== 'cinematic' || hexEdit || showRegions) {
          const cell = hexAtScreenPoint(event.clientX, event.clientY)
          if (cell && mode === 'game' && selectedArmy && viewMode === 'tactical' && cell.id !== selectedArmy.hexId) {
            const order=affordableOrder(selectedArmy,cell.id)
            if(order){const destination=logicalGrid.byId.get(order.destinationId)!;moveArmy(selectedArmy.id,order.destinationId,order.path,order.cost,destination.terrain,destination.locationIds[0]??null);selectHex(order.destinationId)}else selectHex(cell.id)
          } else if (cell) selectHex(cell.id)
          else clearSelection()
        } else {
          clearSelection()
        }
      }
      setIsPanning(false)
    }

    if (stageRef.current?.hasPointerCapture(event.pointerId)) stageRef.current.releasePointerCapture(event.pointerId)
    gestureRef.current = null
    updateHover(event.clientX, event.clientY)
  }

  const renderedLocations=useMemo(()=>locations.map((location)=>{const displayHex=dragPreview[location.id]??location.hex;return{...location,displayHex,cell:logicalGrid.byId.get(displayHex)??null,invalid:locations.some((item)=>item.id!==location.id&&item.hex===displayHex)}}),[locations,dragPreview,logicalGrid])

  const changeView = (nextMode: MapViewMode) => {
    if (hexEdit) setHexEdit(false)
    setViewMode(nextMode)
    if (nextMode === 'cinematic') selectHex(null)
  }

  const pinScale = 1 / Math.max(camera.scale, 0.001)
  const worldStyle: CSSProperties = { transform: `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.scale})` }
  const tooltipTerrain = hoveredHex ? TERRAIN_BY_ID[hoveredHex.terrain] : null
  const tooltipLocationNames = hoveredHex?.locationIds
    .map((id) => locations.find((location) => location.id === id)?.name)
    .filter(Boolean) ?? []
  const tooltipNearestLocation = hoveredHex?.nearestLocationId
    ? locations.find((location) => location.id === hoveredHex.nearestLocationId)
    : null
  const hoveredRegion = hoveredHex?.regionId ? regions.find((region) => region.id === hoveredHex.regionId) : null
  const hoveredRegionOwner = hoveredRegion?.ownerFactionId ? getFaction(factions, hoveredRegion.ownerFactionId) : null
  const hoveredCurrentlyVisible = !fogEnabled || Boolean(hoveredHex && visibleHexes.has(hoveredHex.id))
  const turns = routeCost ? Math.ceil(routeCost / Math.max(1, movementBudget)) : 0

  return (
    <div
      ref={stageRef}
      className={`map-stage ${isPanning ? 'is-panning' : ''} ${addKind ? 'is-adding' : ''} view-${viewMode} ${hexEdit ? 'hex-editing' : ''} ${hexEdit ? `hex-tool-${hexTool}` : ''}`}
      onWheel={handleWheel}
      onPointerDown={handleStagePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishGesture}
      onPointerCancel={finishGesture}
      onPointerLeave={() => { if (!gestureRef.current) setHoveredHexId(null) }}
      aria-label="Стратегическая карта Средиземья"
    >
      <div className="map-world" style={worldStyle}>
        <img className="map-img" src={mapImageUrl} alt="Карта активного мода" draggable={false} />
        <div className="map-vignette" />
        <canvas ref={gridCanvasRef} className="hex-grid-canvas" aria-hidden="true" />

        <svg className="hex-layer" viewBox={`0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`} aria-hidden="true">
          {viewMode === 'tactical' && reachable.size > 0 && (
            <g className="movement-range">
              {[...reachable.entries()].map(([id, cost]) => {
                const cell = logicalGrid.byId.get(id)!
                return (
                  <polygon
                    key={id}
                    points={polygonPoints(cell, grid.config.size * 1.015)}
                    className={`${reachableBoundary.has(id) ? 'range-boundary' : ''} ${cell.zoneOfControl && cell.zoneOfControl !== movingFaction ? 'enemy-zoc' : ''}`}
                    style={{ '--range-strength': 1 - Math.min(0.58, cost / Math.max(1, movementBudget) * 0.4) } as CSSProperties}
                  />
                )
              })}
            </g>
          )}

          {(viewMode !== 'cinematic' || hexEdit || showRegions) && hoverNeighbors.length > 0 && (
            <g className="hover-neighbors">
              {hoverNeighbors.map((cell) => <polygon key={cell.id} points={polygonPoints(cell, grid.config.size * .9)} />)}
            </g>
          )}

          {hoveredHex && (viewMode !== 'cinematic' || hexEdit || showRegions) && (
            <polygon className={`hovered-hex ${placementActive?(placementOccupied?'placement-invalid':'placement-valid'):''}`} points={polygonPoints(hoveredHex,grid.config.size*.93)}/>
          )}

          {pendingOrderPaths.length>0&&<g className="pending-order-lines">{pendingOrderPaths.map(({order,path,army})=><path key={order.armyId} d={path} style={{'--order-color':getFaction(factions,army!.factionId).color}as CSSProperties} onContextMenu={(event)=>{event.preventDefault();event.stopPropagation();cancelArmyOrder(order.armyId)}}/>)}</g>}
          {routePath && (
            <g className={`route-line ${routeCost > movementBudget ? 'multi-turn' : ''}`}>
              <path className="route-shadow" d={routePath} />
              <path className="route-main" d={routePath} />
              {route.map((id, index) => {
                const cell = logicalGrid.byId.get(id)!
                return index === 0 || index === route.length - 1 ? null : <circle key={id} cx={cell.x} cy={cell.y} r="8" />
              })}
            </g>
          )}

        </svg>

        {fogOverlayVisible && <svg className="fog-of-war-layer" viewBox={`0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`} aria-hidden="true"><g>{logicalGrid.cells.filter((cell) => !visibleHexes.has(cell.id)).map((cell) => <polygon key={cell.id} points={polygonPoints(cell, grid.config.size * 1.04)} />)}</g></svg>}

        <div className="pins">
          {renderedLocations.map((location) => {
            const locationVisible = !fogEnabled || visibleHexes.has(locationHexId(location, grid.config))
            const knownIntel = lastSeenLocationById.get(location.id)
            const knownSide = locationVisible ? location.side : knownIntel?.lastKnownOwner ?? location.side
            const faction = getFaction(factions, knownSide)
            if(!location.cell)return null
            const style = {
              left: `${location.cell.x}px`,
              top: `${location.cell.y}px`,
              '--pin-scale': pinScale,
              '--pin-color': faction.color,
            } as CSSProperties
            return (
              <button
                type="button"
                key={location.id}
                className={`pin ${location.structuralType} economic-${location.economicType} side-${knownSide} ${location.invalid?'invalid-placement':''} ${!locationVisible?'fogged-location':''} ${selectedId===location.id?'selected':''} ${dragPreview[location.id]?'is-dragging':''} ${mode==='game'||hexEdit?'locked':''}`}
                style={style}
                onPointerDown={(event) => handlePinPointerDown(event, location)}
                onDoubleClick={(event) => {
                  event.stopPropagation()
                  setCamera((current) => ({
                    ...current,
                    x:stageSize.width/2-location.cell!.x*current.scale,
                    y:stageSize.height/2-location.cell!.y*current.scale,
                  }))
                }}
                aria-label={`${location.structuralType==='stronghold'?'Оплот':'Владение'}: ${location.name}`}
              >
                <EconomicLocationIcon type={location.economicType}/>
                <span className="pin-label">
                  <b>{location.name}</b>
                  {!locationVisible && <i>Сведения на раунд {knownIntel?.lastSeenRound ?? 1}</i>}
                </span>
              </button>
            )
          })}
        </div>

        <div className="armies-layer">
          {armies.map((army) => {
            const cell = logicalGrid.byId.get(army.hexId)
            if (!cell) return null
            const faction = getFaction(factions, army.factionId)
            const enemyToPlayer = mode === 'game' && faction.alignment !== campaign.playerSide
            const armyVisible = !fogEnabled || !enemyToPlayer || visibleHexes.has(army.hexId)
            if (!armyVisible) return null
            const sameHexArmies = armies.filter((item) => item.hexId === army.hexId)
            const locationOnHex = cell.locationIds.map((id) => locations.find((location) => location.id === id)).find(Boolean) ?? null
            const besieging = Boolean(locationOnHex && areFactionsHostile(factions, army.factionId, locationOnHex.side))
            const relationGroup = locationOnHex ? sameHexArmies.filter((item) => areFactionsHostile(factions, item.factionId, locationOnHex.side) === besieging) : sameHexArmies
            const relationIndex = relationGroup.findIndex((item) => item.id === army.id)
            const visualOffset = locationOnHex
              ? fanOffset(relationIndex, relationGroup.length, besieging ? 52 : 39, besieging ? 25 : 145)
              : sameHexArmies.length > 1 ? fanOffset(sameHexArmies.findIndex((item) => item.id === army.id), sameHexArmies.length, 29, 90) : { x: 0, y: 0 }
            const anchor=cell
            const leader = commanderDefinition(army, heroes, captains)
            const leaderName = army.commander?.kind === 'captain' ? army.commander.displayName ?? leader?.name : leader?.name
            const enemyHeroPresent = army.commander?.kind === 'hero' || army.heroSlots.length > 0
            const displayArmyName = enemyToPlayer ? `${armyIntelLabel(army.unitSlots.length <= 4 ? 'small' : army.unitSlots.length <= 8 ? 'medium' : army.unitSlots.length <= 12 ? 'large' : 'huge')}: ${faction.label}` : army.name
            const displayCommander = enemyToPlayer ? (enemyHeroPresent ? 'Замечен герой' : 'Герои не замечены') : leaderName ?? 'Нет командира'
            const occupiedSlots = army.unitSlots.length + army.heroSlots.length + (army.commander?.kind === 'hero' ? 1 : 0)
            const totalSlotLimit = armyUnitSlotCap(army) + army.heroSlotLimit + 1
            const movementCap = armyMovementCap(army, heroes, captains, unitTypes)
            const style = {
              left: `${anchor.x + visualOffset.x / Math.max(camera.scale, .001)}px`,
              top: `${anchor.y + visualOffset.y / Math.max(camera.scale, .001)}px`,
              '--army-scale': pinScale,
              '--army-color': faction.color,
            } as CSSProperties
            return (
              <button
                type="button"
                key={army.id}
                className={`army-marker ${locationOnHex ? 'at-location' : ''} ${locationOnHex && !besieging ? 'friendly-location' : ''} ${besieging ? 'besieging' : ''} ${sameHexArmies.length > 1 ? 'in-stack' : ''} ${selectedArmyId === army.id ? 'selected' : ''} ${army.factionId === campaign.playerFactionId ? 'active-faction' : ''} ${army.engaged?'engaged':''} ${campaign.pendingOrders.some((order)=>order.armyId===army.id)?'has-pending-order':''}`}
                style={style}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  if (hexEdit) return
                  if (mode === 'game' && selectedArmy && !selectedArmy.engaged && canPlayerMoveArmy(campaign, factions, selectedArmy.factionId) && areFactionsHostile(factions, army.factionId, selectedArmy.factionId)) {
                    const order=affordableOrder(selectedArmy,army.hexId)
                    if(order){const destination=logicalGrid.byId.get(order.destinationId)!;moveArmy(selectedArmy.id,order.destinationId,order.path,order.cost,destination.terrain,destination.locationIds[0]??null)}
                  } else selectArmy(army.id)
                }}
                onContextMenu={(event)=>{if(campaign.pendingOrders.some((order)=>order.armyId===army.id)){event.preventDefault();event.stopPropagation();cancelArmyOrder(army.id)}}}
                title={enemyToPlayer ? `${displayArmyName} · ${displayCommander}${army.movedRound === campaign.round ? ' · двигалась в этом раунде' : ''}` : `${army.name} · ${occupiedSlots}/${totalSlotLimit} слотов · ${army.movementRemaining}/${movementCap} ОД · ${leaderName ?? 'Нет командира'}`}
              >
                <span className="army-banner"><i>⚔</i></span>
                <b>{enemyToPlayer ? '?' : occupiedSlots}</b>
                <span className="army-label"><strong>{displayArmyName}</strong><small>{enemyToPlayer ? `${displayCommander}${army.movedRound === campaign.round ? ' · перемещалась' : ''}` : `${army.status === 'retreating' ? 'Деморализована · сила −20%' : displayCommander} · ${army.movementRemaining}/${movementCap} ОД`}</small></span>
              </button>
            )
          })}
          {fogEnabled && campaign.fogOfWar.lastSeenArmies.filter((intel) => !visibleHexes.has(intel.hexId)).map((intel) => { const cell = logicalGrid.byId.get(intel.hexId); if (!cell) return null; const faction = getFaction(factions, intel.factionId); return <div key={`ghost-${intel.armyId}`} className="ghost-army-marker" style={{ left: `${cell.x + 24 / Math.max(camera.scale,.001)}px`, top: `${cell.y + 24 / Math.max(camera.scale,.001)}px`, '--army-scale': pinScale, '--army-color': faction.color } as CSSProperties} title={`${armyIntelLabel(intel.sizeCategory)} · ${faction.label} · последний раз замечена в раунде ${intel.lastSeenRound}`}><span className="army-banner"><i>?</i></span><b>{intel.lastSeenRound}</b><span className="army-label"><strong>{armyIntelLabel(intel.sizeCategory)}: {faction.label}</strong><small>Последний раз замечена: раунд {intel.lastSeenRound}</small></span></div> })}
        </div>
      </div>

      <div className="map-view-toolbar" onPointerDown={(event) => event.stopPropagation()}>
        <div className="view-mode-buttons">
          {VIEW_MODES.map((item) => (
            <button
              type="button"
              key={item.id}
              className={viewMode === item.id && !hexEdit ? 'active' : ''}
              onClick={() => changeView(item.id)}
              title={item.hint}
            >
              <span>{item.icon}</span>{item.label}
            </button>
          ))}
        </div>
        <button type="button" className={`region-overlay-toggle ${showRegions ? 'active' : ''}`} onClick={() => setShowRegions((value) => !value)} title="Показать границы, названия и владельцев регионов"><span>▧</span>Регионы</button>
        {mode === 'edit' && (
          <>
            <button
              type="button"
              className={`hex-editor-toggle ${hexEdit ? 'active' : ''}`}
              onClick={() => setHexEdit(!hexEdit)}
              title="Редактировать рельеф, дороги, реки и контроль гексов"
            >
              <span>⬢</span>{hexEdit ? 'Гексы включены' : 'Редактор гексов'}
            </button>
            {hexEdit && (
              <div className="hex-tool-buttons" role="group" aria-label="Инструмент редактора гексов">
                <button type="button" className={hexTool === 'select' ? 'active' : ''} onClick={() => setHexTool('select')} title="Клик или рамка: выбрать гексы">
                  <span>▱</span> Выбор
                </button>
                <button type="button" className={hexTool === 'pan' ? 'active' : ''} onClick={() => setHexTool('pan')} title="Перетаскивать карту">
                  <span>✥</span> Карта
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {selectionBox && <div className="hex-selection-box" style={selectionBox} />}
      {hexEdit && (
        <div className="hex-selection-help">
          <b>{selectedHexIds.length ? `Выбрано гексов: ${selectedHexIds.length}` : 'Выделение гексов'}</b>
          <span>{hexTool === 'select' ? 'Протяните рамку · Shift добавляет к выбору · Alt перетаскивает карту' : 'Перетаскивайте карту · переключитесь на «Выбор» для рамки'}</span>
          {selectedHexIds.length > 0 && <button type="button" onClick={() => selectHex(null)}>Снять выделение</button>}
        </div>
      )}

      {addKind && mode === 'edit' && (
        <div className="placement-hint">
          <span>{addKind==='stronghold' ? '♜' : '●'}</span>
          Укажите место на карте
          <button type="button" onClick={(event) => { event.stopPropagation(); setAddKind(null) }}>Отмена</button>
        </div>
      )}

      {viewMode === 'tactical' && selectedArmy && (
        <div className="tactical-summary">
          <span className="summary-sigil">⌁</span>
          <div>
            <b>Армия: {selectedArmy.name}</b>
            <small>Осталось движения: {movementBudget} ОД · доступно гексов: {reachable.size}</small>
          </div>
          {route.length > 1 && <strong>{routeCost} ОД · {turns} {turns === 1 ? 'ход' : turns < 5 ? 'хода' : 'ходов'}</strong>}
        </div>
      )}

      {hoveredHex && tooltipTerrain && (viewMode !== 'cinematic' || hexEdit || showRegions) && !isPanning && (
        <div
          className="hex-tooltip"
          style={{ left: Math.max(8, Math.min(cursor.x + 18, stageSize.width - 235)), top: Math.max(8, Math.min(cursor.y + 18, stageSize.height - 215)) }}
        >
          <header><span style={{ color: tooltipTerrain.color }}>{tooltipTerrain.icon}</span><b>{tooltipTerrain.label}</b>{mode === 'edit' && <code>{hoveredHex.id}</code>}</header>
          <div className="tooltip-stats">
            <span><i>Ход</i><b>{hoveredHex.passable ? hoveredHex.moveCost : 'Закрыт'}</b></span>
            <span><i>Дорога</i><b>{hoveredHex.road ? 'Да' : 'Нет'}</b></span>
            <span><i>Река</i><b>{hoveredHex.river ? (hoveredHex.bridge ? 'Мост +1' : hoveredHex.ford ? 'Брод +2' : 'Река +3') : 'Нет'}</b></span>
          </div>
          {tooltipLocationNames.length > 0
            ? <p>⌖ {tooltipLocationNames.join(', ')}</p>
            : tooltipNearestLocation && <p>Ближайшая: {tooltipNearestLocation.name}</p>}
          {hoveredRegion && <p className="tooltip-region"><span style={{ color: hoveredCurrentlyVisible ? hoveredRegionOwner?.color : '#7b8587' }}>▧</span> Регион: {hoveredRegion.name} · {hoveredCurrentlyVisible ? hoveredRegionOwner?.label ?? 'Нейтральный' : 'владелец неизвестен'}</p>}
          {!hoveredHex.passable && <p className="blocked-reason">Проход через этот гекс запрещён</p>}
        </div>
      )}

      <div className="map-controls" onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => zoomAtCenter(1.25)} aria-label="Приблизить">+</button>
        <button type="button" onClick={() => zoomAtCenter(0.8)} aria-label="Отдалить">−</button>
        <button type="button" className="fit-button" onClick={fitMap} aria-label="Показать всю карту">⌗</button>
      </div>
    </div>
  )
}
