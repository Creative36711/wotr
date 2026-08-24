import type { FactionDefinition, FactionId, StructuralType, TerrainType } from './types'

export interface TerrainDefinition {
  id: TerrainType
  label: string
  moveCost: number
  passable: boolean
  color: string
  icon: string
}

// Content factions belong to mods. The engine keeps only the neutral fallback.
export const DEFAULT_FACTIONS: FactionDefinition[] = [
  { id: 'civilian', label: 'Neutral', labelTranslations: { ru: 'Нейтральные' }, color: '#8b918d', emblem: '', playable: false, baseArmyLimit: 0, startingTreasury: { gold: 0, materials: 0 }, alignment: 'neutral', rtsColor: 'white' },
]

// Backward-compatible aliases. UI uses the editable world list from the store.
export const FACTIONS = DEFAULT_FACTIONS
export const FACTION_BY_ID = Object.fromEntries(DEFAULT_FACTIONS.map((faction) => [faction.id, faction])) as Record<FactionId, FactionDefinition>
export const getFaction = (factions: FactionDefinition[], id: string | null | undefined) => factions.find((faction) => faction.id === id) ?? DEFAULT_FACTIONS.find((faction) => faction.id === id) ?? DEFAULT_FACTIONS[DEFAULT_FACTIONS.length - 1]

export const areFactionsHostile = (factions: FactionDefinition[], leftId: string | null | undefined, rightId: string | null | undefined) => {
  if (!leftId || !rightId || leftId === rightId) return false
  const left = getFaction(factions, leftId)
  const right = getFaction(factions, rightId)
  return (left.alignment === 'good' && right.alignment === 'evil') || (left.alignment === 'evil' && right.alignment === 'good')
}

export const TERRAINS: TerrainDefinition[] = [
  { id: 'plains', label: 'Plains', moveCost: 1, passable: true, color: '#9eaa72', icon: '◇' },
  { id: 'forest', label: 'Forest', moveCost: 2, passable: true, color: '#527854', icon: '♠' },
  { id: 'hills', label: 'Hills', moveCost: 2, passable: true, color: '#9b855e', icon: '⌁' },
  { id: 'mountains', label: 'Mountains', moveCost: 3, passable: true, color: '#777b78', icon: '▲' },
  { id: 'swamp', label: 'Swamp', moveCost: 3, passable: true, color: '#66765f', icon: '≋' },
  { id: 'desert', label: 'Desert', moveCost: 2, passable: true, color: '#b99a62', icon: '☀' },
  { id: 'snow', label: 'Snow', moveCost: 2, passable: true, color: '#b8c9ce', icon: '✣' },
  { id: 'wasteland', label: 'Wasteland', moveCost: 2, passable: true, color: '#776656', icon: '✦' },
  { id: 'water', label: 'Water', moveCost: 99, passable: false, color: '#456d7c', icon: '≈' },
]

export const TERRAIN_BY_ID = Object.fromEntries(TERRAINS.map((terrain) => [terrain.id, terrain])) as Record<TerrainType, TerrainDefinition>
export const KIND_LABELS: Record<StructuralType, string> = { domain: 'Domain', stronghold: 'Stronghold' }
export const WORLD_WIDTH = 5120
export const WORLD_HEIGHT = 4115
export const DEFAULT_GRID_CONFIG = { orientation: 'pointy' as const, size: 72, originX: 36, originY: 36, movementBudget: 6 }
