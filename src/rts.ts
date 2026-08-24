import type { AiDifficulty, FactionDefinition, RtsColorId, RtsIntegrationSettings, RtsMapAsset, RtsStoredFile } from './types'

export const RTS_DIFFICULTIES: Array<{ id: AiDifficulty; label: string; bfmeIndex: number }> = [
  { id: 'recruit', label: 'Recruit', bfmeIndex: 0 },
  { id: 'warrior', label: 'Warrior', bfmeIndex: 1 },
  { id: 'veteran', label: 'Veteran', bfmeIndex: 2 },
  { id: 'slayer', label: 'Slayer', bfmeIndex: 3 },
]

export const RTS_COLORS: Array<{ id: RtsColorId; label: string; code: number; hex: string }> = [
  { id: 'blue', label: 'Blue', code: 0, hex: '#3978c5' },
  { id: 'red', label: 'Red', code: 1, hex: '#b9463f' },
  { id: 'yellow', label: 'Yellow', code: 2, hex: '#d2ad45' },
  { id: 'green', label: 'Green', code: 3, hex: '#57964d' },
  { id: 'orange', label: 'Orange', code: 4, hex: '#ce7841' },
  { id: 'light_blue', label: 'Light Blue', code: 5, hex: '#62aeca' },
  { id: 'purple', label: 'Purple', code: 6, hex: '#815fa8' },
  { id: 'pink', label: 'Pink', code: 7, hex: '#c97998' },
  { id: 'black', label: 'Black', code: 8, hex: '#4b4b50' },
  { id: 'white', label: 'White', code: 9, hex: '#d7d9d4' },
]

export const DEFAULT_RTS_EXECUTABLE = ''
export const DEFAULT_MAP_CACHE_TARGET = '__wotr_maps_cache.big'
export const DEFAULT_NETWORK_RULES = '0 0 0 400 1000 -1 -1 -1 -1 -1'

export function defaultRtsSettings(factions: FactionDefinition[] = []): RtsIntegrationSettings {
  return {
    enabled: true,
    factionOrder: factions.filter((faction) => faction.playable).map((faction) => faction.id),
    moduleFiles: [],
    mapsFile: null,
    mapCacheTargetFileName: DEFAULT_MAP_CACHE_TARGET,
    networkRules: DEFAULT_NETWORK_RULES,
  }
}

export function normalizeRtsSettings(source: Partial<RtsIntegrationSettings> | null | undefined, factions: FactionDefinition[] = []): RtsIntegrationSettings {
  const defaults = defaultRtsSettings(factions)
  const playable = new Set(factions.filter((faction) => faction.playable).map((faction) => faction.id))
  const order = Array.isArray(source?.factionOrder) ? source!.factionOrder.filter((id) => playable.has(id)) : defaults.factionOrder
  const cleanFile = (value: unknown): RtsStoredFile | null => {
    const file = value as Partial<RtsStoredFile> | null
    if (!file || typeof file.id !== 'string' || typeof file.storageName !== 'string' || typeof file.targetFileName !== 'string') return null
    return { id: file.id, originalFileName: file.originalFileName ?? file.targetFileName, targetFileName: file.targetFileName, storageName: file.storageName, size: Math.max(0, Number(file.size ?? 0)) }
  }
  return {
    enabled: source?.enabled !== false,
    factionOrder: [...new Set(order)],
    moduleFiles: Array.isArray(source?.moduleFiles) ? source!.moduleFiles.map(cleanFile).filter(Boolean) as RtsStoredFile[] : [],
    mapsFile: cleanFile(source?.mapsFile),
    mapCacheTargetFileName: validBigFileName(source?.mapCacheTargetFileName ?? '') ? source!.mapCacheTargetFileName : DEFAULT_MAP_CACHE_TARGET,
    networkRules: typeof source?.networkRules === 'string' && source.networkRules.trim() ? source.networkRules.trim() : DEFAULT_NETWORK_RULES,
  }
}

export function validBigFileName(value: string) {
  return /^[^<>:"/\\|?*\x00-\x1f]+\.big$/i.test(value.trim())
}

export function createAssetId(prefix = 'asset') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function decodeCacheKey(value: string) {
  return value.replace(/_([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
}

export async function parseMapCacheBig(file: File, assetId: string, storageName: string): Promise<RtsMapAsset> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const text = new TextDecoder('windows-1252').decode(bytes)
  const cache = text.match(/MapCache\s+([^\r\n]+)/i)
  if (!cache) throw new Error('В BIG-файле не найден блок MapCache')
  const cacheKey = cache[1].trim()
  const mapPath = decodeCacheKey(cacheKey)
  const mapFile = mapPath.split(/[\\/]/).pop() ?? mapPath
  const mapName = mapFile.replace(/\.map$/i, '')
  const numPlayers = Math.max(0, Number(text.match(/\bnumPlayers\s*=\s*(-?\d+)/i)?.[1] ?? 0))
  const playerStarts = [...text.matchAll(/Player_(\d+)_Start\s*=\s*X:([-\d.]+)\s+Y:([-\d.]+)\s+Z:([-\d.]+)/gi)].map((match) => ({ slot: Number(match[1]), x: Number(match[2]), y: Number(match[3]), z: Number(match[4]) }))
  return { assetId, originalFileName: file.name, storageName, size: file.size, cacheKey, mapPath, mapName, numPlayers, playerStarts }
}

export function colorDefinition(id: RtsColorId) {
  return RTS_COLORS.find((color) => color.id === id) ?? RTS_COLORS[0]
}
