import { invoke } from '@tauri-apps/api/core'
import { DEFAULT_FACTIONS, DEFAULT_GRID_CONFIG, WORLD_HEIGHT, WORLD_WIDTH } from './constants'
import { hexId, pixelToAxial } from './hex/hexGrid'
import { BUILTIN_CONTENT_EN } from './contentTranslations'
import { armyMovementCap, captainInstanceFromCommander, captainNamesForFaction, generateArmyName, generateCaptainName } from './game/army'
import { createDefaultArmies, createDefaultCampaign, createDefaultRegions, DEFAULT_CAPTAINS, DEFAULT_HEROES, DEFAULT_UNIT_TYPES } from './game/defaultData'
import {
  partitionLandHexesIntoRegions,
  refreshRegionOwners,
  regenerateDomainHexes,
  regionIdForHex,
  syncMapObjectRegionIds,
  VANILLA_REGION_SEEDS,
  VANILLA_REGIONS,
  VANILLA_STRONGHOLD_IDS,
} from './game/regions'
import { createNewSaveGame } from './game/saveGame'
import { updateConflictRtsCompatibility } from './game/conflicts'
import { heroIsDeployed, heroSummonLocation } from './game/heroes'
import { defaultLocationTypesForUnit, defaultRequiredTagsForUnit, defaultTagsForLocation } from './game/recruitment'
import type { AppSettings, Army, ArmyCommander, ArmySlot, CampaignState, CaptainType, FactionDefinition, Hero, MapLocation, ModDefinition, ModSummary, Region, RosterData, RtsMapAsset, RtsStoredFile, SaveGameData, UnitType, WorldData } from './types'
import { GAME_VERSION, ROSTER_DATA_VERSION, SAVEGAME_DATA_VERSION, WORLD_DATA_VERSION } from './version'
import { DEFAULT_NETWORK_RULES, DEFAULT_RTS_EXECUTABLE, RTS_COLORS, normalizeRtsSettings } from './rts'

const MAJOR_LOCATIONS = new Set(['minas-tirith', 'arnor', 'edoras', 'lorien', 'rivendell', 'erebor', 'isengard', 'barad-dur', 'gundabad', 'harad', 'angmar', 'sea-rhun'])
const LOCATION_ECONOMY = {
  village: { gold: 30, materials: 0, recruitmentSlots: 1, reserveLimit: 5 },
  city: { gold: 80, materials: 10, recruitmentSlots: 2, reserveLimit: 10 },
  fortress: { gold: 100, materials: 20, recruitmentSlots: 3, reserveLimit: 15 },
  capital: { gold: 150, materials: 30, recruitmentSlots: 4, reserveLimit: 20 },
  port: { gold: 60, materials: 20, recruitmentSlots: 2, reserveLimit: 10 },
  mine: { gold: 20, materials: 40, recruitmentSlots: 2, reserveLimit: 10 },
  farm: { gold: 50, materials: 0, recruitmentSlots: 1, reserveLimit: 8 },
  wilderness:{gold:0,materials:0,recruitmentSlots:0,reserveLimit:4},swamp:{gold:0,materials:5,recruitmentSlots:0,reserveLimit:4},forest:{gold:10,materials:20,recruitmentSlots:1,reserveLimit:6},mountains:{gold:5,materials:30,recruitmentSlots:1,reserveLimit:6},ruins:{gold:5,materials:5,recruitmentSlots:0,reserveLimit:4},crossroads:{gold:20,materials:0,recruitmentSlots:1,reserveLimit:5},ford:{gold:15,materials:0,recruitmentSlots:0,reserveLimit:4},pass:{gold:15,materials:5,recruitmentSlots:0,reserveLimit:4},signal_tower:{gold:20,materials:5,recruitmentSlots:0,reserveLimit:4},camp:{gold:20,materials:5,recruitmentSlots:1,reserveLimit:6},
} as const

function defaultSettlementType(location: MapLocation) {
  if (MAJOR_LOCATIONS.has(location.id)) return 'capital' as const
  if (/(haven|harbor|port|umbar|pelargir|grey-havens)/i.test(location.id)) return 'port' as const
  if (/(mine|moria|iron-hills|ered-luin)/i.test(location.id)) return 'mine' as const
  if (/(farm|shire|westfold|eastemnet)/i.test(location.id)) return 'farm' as const
  return (location as any).kind === 'keep' ? 'fortress' as const : 'village' as const
}

function generatedObjectId(id: string, suffix: 'Horde' | 'Hero') {
  return id.split(/[^a-z0-9]+/i).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join('') + suffix
}

function normalizeRtsMapAsset(value: unknown): RtsMapAsset | null {
  const item = value as Partial<RtsMapAsset> | null
  if (!item || typeof item.assetId !== 'string' || typeof item.storageName !== 'string' || typeof item.mapPath !== 'string') return null
  return {
    assetId: item.assetId,
    originalFileName: item.originalFileName ?? item.storageName,
    storageName: item.storageName,
    size: Math.max(0, Number(item.size ?? 0)),
    cacheKey: item.cacheKey ?? '',
    mapPath: item.mapPath,
    mapName: item.mapName ?? item.mapPath.split(/[\\/]/).pop()?.replace(/\.map$/i, '') ?? '',
    numPlayers: Math.max(0, Number(item.numPlayers ?? 0)),
    playerStarts: Array.isArray(item.playerStarts) ? item.playerStarts.filter((start) => start && Number.isFinite(start.slot)).map((start) => ({ slot: Number(start.slot), x: Number(start.x), y: Number(start.y), z: Number(start.z) })) : [],
  }
}

function canonicalLocalized(legacyValue:unknown,legacyEnglish:unknown,translations:unknown){
  const original=typeof legacyValue==='string'?legacyValue:''
  const english=typeof legacyEnglish==='string'&&legacyEnglish.trim()?legacyEnglish.trim():BUILTIN_CONTENT_EN[original]??original
  const localized={...(translations&&typeof translations==='object'?translations as Record<string,string>:{})}
  if(original&&original!==english&&!localized.ru)localized.ru=original
  return {canonical:english,translations:localized}
}

function normalizeFactions(source: unknown): FactionDefinition[] {
  const values = Array.isArray(source) ? source : DEFAULT_FACTIONS
  return values.map((raw:any,index) => {
    const localized=canonicalLocalized(raw.label,raw.en,raw.labelTranslations)
    const rtsColor = RTS_COLORS.some((color) => color.id === raw.rtsColor) ? raw.rtsColor : RTS_COLORS[index % RTS_COLORS.length].id
    return { id:raw.id!,label:localized.canonical,labelTranslations:localized.translations,color:raw.color??RTS_COLORS.find((color)=>color.id===rtsColor)?.hex??'#8b918d',emblem:raw.emblem??'',playable:raw.playable??true,alignment:raw.alignment??'neutral',rtsColor,baseArmyLimit:Math.max(0,raw.baseArmyLimit??(raw.playable===false?0:2)),startingTreasury:{gold:Math.max(0,raw.startingTreasury?.gold??(raw.playable===false?0:500)),materials:Math.max(0,raw.startingTreasury?.materials??(raw.playable===false?0:200))}}
  }) as FactionDefinition[]
}

function normalizeUnits(source: unknown): UnitType[] {
  const values = Array.isArray(source) ? source : DEFAULT_UNIT_TYPES
  const normalized = values.map((raw) => {
    const old = raw as any
    const defaults = DEFAULT_UNIT_TYPES.find((item) => item.id === old.id)
    const localized=canonicalLocalized(old.name,old.en,old.nameTranslations)
    const calculatedPower = Math.round((old.attack ?? 6) * 8 + (old.defense ?? 6) * 6 + (old.vitality ?? 100) * .28 + (old.initiative ?? 5) * 2)
    return {
      id: old.id,
      objectId: old.objectId ?? defaults?.objectId ?? generatedObjectId(old.id, 'Horde'),
      factionId: old.factionId,
      name: localized.canonical,
      nameTranslations: localized.translations,
      category: old.category ?? 'infantry',
      battlePower: Math.max(1, old.battlePower ?? defaults?.battlePower ?? calculatedPower),
      movementPoints: Math.max(1, old.movementPoints ?? defaults?.movementPoints ?? ({ infantry: 5, archers: 5, cavalry: 7, monsters: 3, siege: 3 }[old.category ?? 'infantry'])),
      siegePower: Math.max(0, old.siegePower ?? old.siege ?? defaults?.siegePower ?? 0),
      recruitCost: { gold: Math.max(0, old.recruitCost?.gold ?? defaults?.recruitCost.gold ?? 100), materials: Math.max(0, old.recruitCost?.materials ?? defaults?.recruitCost.materials ?? 0) },
      recruitTime: Math.max(1, old.recruitTime ?? defaults?.recruitTime ?? 1),
      upkeep: Math.max(0, old.upkeep ?? defaults?.upkeep ?? 10),
      portrait: old.portrait ?? '',
      requiredLocationTypes: Array.isArray(old.requiredLocationTypes) && old.requiredLocationTypes.length ? old.requiredLocationTypes : defaults?.requiredLocationTypes ?? defaultLocationTypesForUnit(old.category ?? 'infantry', old.battlePower ?? defaults?.battlePower ?? calculatedPower),
      requiredLocationTags: Array.isArray(old.requiredLocationTags) ? old.requiredLocationTags : defaults?.requiredLocationTags ?? defaultRequiredTagsForUnit(old.id),
      recruitDuringOccupation: old.recruitDuringOccupation ?? defaults?.recruitDuringOccupation ?? (old.battlePower ?? defaults?.battlePower ?? calculatedPower) <= 80,
      transformationSourceUnitId: typeof old.transformationSourceUnitId === 'string' ? old.transformationSourceUnitId : defaults?.transformationSourceUnitId ?? null,
    } as UnitType
  })
  return normalized.map((unit) => {
    if (!unit.transformationSourceUnitId) return unit
    const sourceUnit = normalized.find((candidate) => candidate.id === unit.transformationSourceUnitId)
    return sourceUnit && sourceUnit.id !== unit.id && sourceUnit.factionId === unit.factionId ? unit : { ...unit, transformationSourceUnitId: null }
  })
}

function normalizeHeroes(source: unknown, rebalanceBuiltIns = false): Hero[] {
  const values = Array.isArray(source) ? source : DEFAULT_HEROES
  return values.map((raw) => {
    const old = raw as any
    const defaults = DEFAULT_HEROES.find((item) => item.id === old.id)
    const localizedName=canonicalLocalized(old.name,old.en,old.nameTranslations)
    if(old.id==='hwaldar'||old.objectId==='AngmarHwaldar'){localizedName.canonical='Haldar';localizedName.translations.ru='Халдар'}
    const localizedTitle=canonicalLocalized(old.title,old.titleEn,old.titleTranslations)
    return {
      id: old.id,
      objectId: old.objectId ?? defaults?.objectId ?? generatedObjectId(old.id, 'Hero'),
      factionId: old.factionId,
      name: localizedName.canonical,
      nameTranslations: localizedName.translations,
      title: localizedTitle.canonical,
      titleTranslations: localizedTitle.translations,
      battlePower: Math.max(1, rebalanceBuiltIns && defaults ? defaults.battlePower : old.battlePower ?? defaults?.battlePower ?? Math.round((old.combat ?? 5) * 14 + (old.defense ?? 5) * 8)),
      command: Math.max(0, old.command ?? defaults?.command ?? 5),
      movementBonus: Math.max(0, old.movementBonus ?? defaults?.movementBonus ?? 0),
      alive: old.alive ?? true,
      portrait: old.portrait ?? '',
      unlockType: ['starting', 'turn', 'location', 'turn_location', 'special'].includes(old.unlockType) ? old.unlockType : defaults?.unlockType ?? 'starting',
      requiredTurn: Math.max(1, Number(old.requiredTurn ?? defaults?.requiredTurn ?? 1)),
      requiredLocationId: old.requiredLocationId ?? defaults?.requiredLocationId ?? null,
      summonCostGold: Math.max(0, Number(old.summonCostGold ?? defaults?.summonCostGold ?? 0)),
    } as Hero
  })
}

function normalizeCaptains(source: unknown): CaptainType[] {
  const values = Array.isArray(source) ? source : DEFAULT_CAPTAINS
  return values.map((raw) => {
    const old = raw as any
    const defaults = DEFAULT_CAPTAINS.find((item) => item.id === old.id)
    const localized=canonicalLocalized(old.name,old.en,old.nameTranslations)
    const legacyPool=(Array.isArray(old.namePool)&&old.namePool.some((name:unknown)=>typeof name==='string'&&name.trim())?old.namePool:defaults?.namePool??captainNamesForFaction(old.factionId)).filter((name:string)=>name.trim())
    const hasLocalizedPools=old.namePoolTranslations&&typeof old.namePoolTranslations==='object'
    const canonicalPool=hasLocalizedPools?legacyPool:legacyPool.map((name:string)=>BUILTIN_CONTENT_EN[name]??name)
    const namePoolTranslations:Record<string,string[]>={...(hasLocalizedPools?old.namePoolTranslations:{})}
    if(!hasLocalizedPools&&legacyPool.some((name:string,index:number)=>name!==canonicalPool[index]))namePoolTranslations.ru=[...legacyPool]
    return {
      id: old.id,
      factionId: old.factionId,
      name: localized.canonical,
      nameTranslations: localized.translations,
      battlePower: Math.max(1, Math.min(50, old.battlePower ?? defaults?.battlePower ?? 40)),
      command: Math.max(0, old.command ?? defaults?.command ?? 5),
      movementBonus: Math.max(0, old.movementBonus ?? defaults?.movementBonus ?? 0),
      portrait: old.portrait ?? defaults?.portrait ?? '',
      namePool: canonicalPool,
      namePoolTranslations,
    } as CaptainType
  })
}

function normalizeArmies(source: unknown, units: UnitType[], heroes: Hero[], captains: CaptainType[], upgradeUnitLimits = false): Army[] {
  if (!Array.isArray(source)) return []
  const normalizeSlot = (slot: any, armyId: string, index: number, kind: 'unit' | 'hero'): ArmySlot | null => {
    const entity = kind === 'hero' ? heroes.find((item) => item.id === slot.entityId) : units.find((item) => item.id === slot.entityId)
    if (!entity) return null
    return { slotId: slot.slotId ?? `${armyId}-${kind}-${index + 1}`, kind, entityId: entity.id, objectId: entity.objectId }
  }
  return source.map((raw) => {
    const old = raw as any
    let commander: ArmyCommander | null = null
    let unitSlots: ArmySlot[] = []
    let heroSlots: ArmySlot[] = []

    if (old.commander) {
      const entity = old.commander.kind === 'hero'
        ? heroes.find((item) => item.id === old.commander.entityId)
        : captains.find((item) => item.id === old.commander.entityId)
      if (entity) commander = old.commander.kind === 'hero'
        ? { kind: 'hero', entityId: entity.id, objectId: (entity as Hero).objectId }
        : {
          kind: 'captain',
          entityId: entity.id,
          displayName: BUILTIN_CONTENT_EN[old.commander.displayName] ?? old.commander.displayName ?? generateCaptainName(old.factionId, (entity as CaptainType).namePool),
          instanceId: old.commander.instanceId ?? `captain-${old.id}-${String(old.commander.displayName ?? entity.id).toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-')}`,
        }
      unitSlots = (old.unitSlots ?? []).map((slot: any, index: number) => normalizeSlot(slot, old.id, index, 'unit')).filter(Boolean) as ArmySlot[]
      heroSlots = (old.heroSlots ?? []).map((slot: any, index: number) => normalizeSlot(slot, old.id, index, 'hero')).filter(Boolean) as ArmySlot[]
    } else {
      const legacySlots: ArmySlot[] = Array.isArray(old.slots)
        ? old.slots.map((slot: any, index: number) => normalizeSlot(slot, old.id, index, slot.kind === 'hero' ? 'hero' : 'unit')).filter(Boolean) as ArmySlot[]
        : []
      const legacyHeroes = legacySlots.filter((slot) => slot.kind === 'hero')
      const firstHero = legacyHeroes[0] ? heroes.find((item) => item.id === legacyHeroes[0].entityId) : null
      if (firstHero) commander = { kind: 'hero', entityId: firstHero.id, objectId: firstHero.objectId }
      heroSlots = legacyHeroes.slice(1, 3)
      unitSlots = legacySlots.filter((slot) => slot.kind === 'unit')
    }

    if (!commander && old.commander === undefined) {
      const captain = captains.find((item) => item.factionId === old.factionId)
      if (captain) commander = {
        kind: 'captain',
        entityId: captain.id,
        displayName: generateCaptainName(old.factionId, captain.namePool),
        instanceId: `captain-${old.id}-legacy`,
      }
    }

    const legacyBaseLimit = old.baseUnitSlotLimit ?? 8
    const baseUnitSlotLimit = Math.max(1, Math.min(20, upgradeUnitLimits && legacyBaseLimit <= 8 ? 15 : legacyBaseLimit))
    const heroSlotLimit = Math.max(0, Math.min(5, old.heroSlotLimit ?? 2))
    const unitCap = baseUnitSlotLimit

    return {
      id: old.id,
      name: old.name,
      factionId: old.factionId,
      hexId: old.hexId,
      movementRemaining: Math.max(0, old.movementRemaining ?? old.maxMovement ?? 5),
      baseUnitSlotLimit,
      heroSlotLimit,
      commander,
      unitSlots: unitSlots.slice(0, unitCap),
      heroSlots: heroSlots.slice(0, heroSlotLimit),
      status: old.status ?? 'ready',
      canInitiateBattle: old.canInitiateBattle ?? true,
      engaged: old.engaged ?? false,
      movedRound: Number.isFinite(old.movedRound) ? Number(old.movedRound) : null,
      movedInPhase: old.movedInPhase === 'movement_first' || old.movedInPhase === 'movement_second' ? old.movedInPhase : null,
      exhaustedUntilRound: Number.isFinite(old.exhaustedUntilRound) ? Number(old.exhaustedUntilRound) : null,
    } as Army
  })
}

function normalizeCampaign(source: any, factions: FactionDefinition[], locations: MapLocation[], heroes: Hero[]): CampaignState {
  const defaults = createDefaultCampaign(factions, locations, heroes)
  const campaign = source ?? defaults
  const treasuries = Object.fromEntries(factions.map((faction) => {
    const existing = campaign.treasuries?.[faction.id]
    return [faction.id, existing ? {
      gold: Number(existing.gold ?? faction.startingTreasury.gold),
      materials: Number(existing.materials ?? faction.startingTreasury.materials),
      lastIncome: { gold: Number(existing.lastIncome?.gold ?? 0), materials: Number(existing.lastIncome?.materials ?? 0) },
      lastUpkeep: Number(existing.lastUpkeep ?? 0),
    } : defaults.treasuries[faction.id]]
  }))
  const locationStates = Object.fromEntries(locations.map((location) => {
    const existing = campaign.locationStates?.[location.id]
    return [location.id, existing ? {
      locationId: location.id,
      recruitmentQueue: Array.isArray(existing.recruitmentQueue) ? existing.recruitmentQueue : [],
      reserve: Array.isArray(existing.reserve) ? existing.reserve : [],
      occupationTurnsLeft: Math.max(0, Number(existing.occupationTurnsLeft ?? 0)),
    } : defaults.locationStates[location.id]]
  }))
  const validPhases = ['planning_good', 'planning_evil', 'movement_first', 'movement_second', 'conflicts', 'aftermath']
  const phase = validPhases.includes(campaign.phase)
    ? campaign.phase
    : campaign.phase === 'movement' ? 'movement_first' : 'planning_good'
  const heroStates = Object.fromEntries(heroes.map((hero) => {
    const existing = campaign.heroStates?.[hero.id]
    const fallbackStatus = !hero.alive ? 'dead' : hero.unlockType === 'starting' ? 'active' : 'locked'
    const status = existing && ['locked', 'available', 'active', 'wounded', 'dead'].includes(existing.status) ? existing.status : fallbackStatus
    return [hero.id, {
      status,
      summoned: existing?.summoned ?? ['active', 'wounded', 'dead'].includes(status),
      availableSinceRound: Number.isFinite(existing?.availableSinceRound) ? Number(existing.availableSinceRound) : null,
      summonLocationId: existing?.summonLocationId ?? hero.requiredLocationId ?? null,
      healTurnsLeft: Math.max(0, Number(existing?.healTurnsLeft ?? 0)),
      recoveryLocationId: existing?.recoveryLocationId ?? null,
      diedRound: Number.isFinite(existing?.diedRound) ? Number(existing.diedRound) : null,
      diedLocationId: existing?.diedLocationId ?? null,
    }]
  }))
  const factionStates = Object.fromEntries(factions.filter((faction) => faction.playable).map((faction) => {
    const existing = campaign.factionStates?.[faction.id]
    return [faction.id, {
      status: existing?.status === 'eliminated' ? 'eliminated' as const : existing?.status === 'inactive' ? 'inactive' as const : 'active' as const,
      eliminatedOnRound: Number.isFinite(existing?.eliminatedOnRound) ? Number(existing.eliminatedOnRound) : null,
      statistics: {
        battlesWon: Math.max(0, Number(existing?.statistics?.battlesWon ?? 0)),
        battlesLost: Math.max(0, Number(existing?.statistics?.battlesLost ?? 0)),
        locationsCaptured: Math.max(0, Number(existing?.statistics?.locationsCaptured ?? 0)),
        heroesLost: Math.max(0, Number(existing?.statistics?.heroesLost ?? 0)),
      },
    }]
  }))
  const freeCaptains = Object.fromEntries(factions.map((faction) => {
    const items = Array.isArray(campaign.freeCaptains?.[faction.id]) ? campaign.freeCaptains[faction.id] : []
    return [faction.id, items.filter((item: any) => item && typeof item.displayName === 'string').map((item: any, index: number) => ({
      instanceId: item.instanceId ?? `captain-free-${faction.id}-${index + 1}`,
      captainTypeId: item.captainTypeId ?? `${faction.id}-captain`,
      displayName: BUILTIN_CONTENT_EN[item.displayName] ?? item.displayName,
    }))]
  }))
  const conflicts = Array.isArray(campaign.conflicts) ? campaign.conflicts.filter((conflict: any) => conflict && typeof conflict.id === 'string').map((conflict: any) => ({
    ...conflict,
    attackerArmyIds: Array.isArray(conflict.attackerArmyIds) ? conflict.attackerArmyIds : [],
    defenderArmyIds: Array.isArray(conflict.defenderArmyIds) ? conflict.defenderArmyIds : [],
    attackerReinforcementArmyIds: Array.isArray(conflict.attackerReinforcementArmyIds) ? conflict.attackerReinforcementArmyIds : [],
    defenderReinforcementArmyIds: Array.isArray(conflict.defenderReinforcementArmyIds) ? conflict.defenderReinforcementArmyIds : [],
    attackerDistantReinforcementArmyIds: Array.isArray(conflict.attackerDistantReinforcementArmyIds) ? conflict.attackerDistantReinforcementArmyIds : [],
    defenderDistantReinforcementArmyIds: Array.isArray(conflict.defenderDistantReinforcementArmyIds) ? conflict.defenderDistantReinforcementArmyIds : [],
    optionalPlayerReinforcements: Array.isArray(conflict.optionalPlayerReinforcements) ? conflict.optionalPlayerReinforcements.map((option: any) => ({ ...option })) : [],
    regionId: conflict.regionId ?? null,
    rtsLocationId:conflict.rtsLocationId??conflict.locationId??null,
    rtsMapSource:'location',
    rtsMapId: conflict.rtsMapId ?? '',
    rtsDefenderStartPosition: conflict.rtsDefenderStartPosition && Number.isFinite(conflict.rtsDefenderStartPosition.x) && Number.isFinite(conflict.rtsDefenderStartPosition.y) ? { x: Number(conflict.rtsDefenderStartPosition.x), y: Number(conflict.rtsDefenderStartPosition.y) } : null,
    rtsAttackerSlots: Math.max(0, Number(conflict.rtsAttackerSlots ?? 0)),
    rtsDefenderSlots: Math.max(0, Number(conflict.rtsDefenderSlots ?? 0)),
    rtsCompatible: Boolean(conflict.rtsCompatible),
    status: conflict.status === 'resolved' ? 'resolved' : 'pending',
    resolution: conflict.resolution ?? null,
    winnerSide: conflict.winnerSide ?? null,
    attackerPower: Number.isFinite(conflict.attackerPower) ? Number(conflict.attackerPower) : null,
    defenderPower: Number.isFinite(conflict.defenderPower) ? Number(conflict.defenderPower) : null,
    attackerLosses: Math.max(0, Number(conflict.attackerLosses ?? 0)),
    defenderLosses: Math.max(0, Number(conflict.defenderLosses ?? 0)),
  })) : []
  const participatingFactionIds = new Set(Object.entries(factionStates).filter(([, state]) => state.status !== 'inactive').map(([id]) => id))
  const normalizedTurnOrder = (Array.isArray(campaign.turnOrder) ? campaign.turnOrder : defaults.turnOrder)
    .filter((id: unknown): id is string => typeof id === 'string' && participatingFactionIds.has(id))
  const playerFactionId = factions.some((faction) => faction.playable && faction.id === campaign.playerFactionId && participatingFactionIds.has(faction.id)) ? campaign.playerFactionId as string : null
  const playerAlignment = factions.find((faction) => faction.id === playerFactionId)?.alignment
  const fogSource = campaign.fogOfWar ?? defaults.fogOfWar
  const fogOfWar = {
    enabled: fogSource.enabled !== false,
    overlayVisible: fogSource.overlayVisible !== false,
    lastSeenArmies: Array.isArray(fogSource.lastSeenArmies) ? fogSource.lastSeenArmies.filter((intel: any) => intel && typeof intel.armyId === 'string').map((intel: any) => ({ ...intel })) : [],
    lastSeenLocations: Array.isArray(fogSource.lastSeenLocations) ? fogSource.lastSeenLocations.filter((intel: any) => intel && typeof intel.locationId === 'string').map((intel: any) => ({ ...intel })) : [],
  }
  return {
    round: Math.max(1, Number(campaign.round ?? 1)),
    activeFactionId: participatingFactionIds.has(campaign.activeFactionId) ? campaign.activeFactionId : normalizedTurnOrder[0] ?? 'civilian',
    turnOrder: normalizedTurnOrder,
    phase,
    firstMoverThisRound: campaign.firstMoverThisRound === 'evil' ? 'evil' : 'good',
    playerFactionId,
    playerSide: playerAlignment === 'evil' ? 'evil' : playerAlignment === 'good' ? 'good' : campaign.playerSide === 'evil' ? 'evil' : 'good',
    aiEnabled: campaign.aiEnabled ?? true,
    aiDifficulty: {
      strategic: ['recruit','warrior','veteran','slayer'].includes(campaign.aiDifficulty?.strategic) ? campaign.aiDifficulty.strategic : 'warrior',
      rts: ['recruit','warrior','veteran','slayer'].includes(campaign.aiDifficulty?.rts) ? campaign.aiDifficulty.rts : 'warrior',
    },
    gameStatus: ['active', 'victory_good', 'victory_evil', 'player_defeated'].includes(campaign.gameStatus) ? campaign.gameStatus : 'active',
    gameResultDismissed: Boolean(campaign.gameResultDismissed),
    factionStates,
    freeCaptains,
    fogOfWar,
    treasuries,
    locationStates,
    heroStates,
    pendingOrders:Array.isArray(campaign.pendingOrders)?campaign.pendingOrders.filter((order:any)=>order&&typeof order.armyId==='string'&&Array.isArray(order.path)).map((order:any)=>({armyId:order.armyId,destinationHexId:String(order.destinationHexId??order.path.at(-1)??''),path:order.path.map(String),cost:Math.max(0,Number(order.cost??0)),locationId:typeof order.locationId==='string'?order.locationId:null})):[],
    alliedPlans:Array.isArray(campaign.alliedPlans)?campaign.alliedPlans.filter((plan:any)=>plan&&typeof plan.armyId==='string'&&Array.isArray(plan.path)&&plan.path.length>=2).map((plan:any)=>({armyId:plan.armyId,factionId:String(plan.factionId??''),path:plan.path.map(String),destinationHexId:String(plan.destinationHexId??plan.path.at(-1)??''),locationId:typeof plan.locationId==='string'?plan.locationId:null,cost:Math.max(0,Number(plan.cost??0))})):[],
    turnMovements:Array.isArray(campaign.turnMovements)?campaign.turnMovements.filter((entry:any)=>entry&&typeof entry.armyName==='string').map((entry:any)=>({id:String(entry.id??`move-${Math.random().toString(36).slice(2,8)}`),round:Math.max(1,Number(entry.round??1)),factionId:String(entry.factionId??'civilian'),armyName:entry.armyName,commanderName:typeof entry.commanderName==='string'?entry.commanderName:null,action:['moved','stayed','retreated','besieged'].includes(entry.action)?entry.action:'moved',targetLabel:typeof entry.targetLabel==='string'?entry.targetLabel:null,distance:Math.max(0,Number(entry.distance??0))})):[],
    conflicts,
    currentConflictId: campaign.currentConflictId ?? conflicts.find((conflict: any) => conflict.status === 'pending')?.id ?? null,
    log: Array.isArray(campaign.log) ? campaign.log.map((entry: any) => ({ ...entry, phase: validPhases.includes(entry.phase) ? entry.phase : phase })) : defaults.log,
  }
}

function enforceCaptainHierarchy(armies: Army[], campaign: CampaignState) {
  for (const army of armies) {
    if (army.commander?.kind !== 'captain' || !army.heroSlots.length) continue
    const released = captainInstanceFromCommander(army.commander)
    if (released) {
      const pool = campaign.freeCaptains[army.factionId] ?? []
      if (!pool.some((captain) => captain.instanceId === released.instanceId)) pool.push(released)
      campaign.freeCaptains[army.factionId] = pool
    }
    const promoted = army.heroSlots.shift()!
    army.commander = { kind: 'hero', entityId: promoted.entityId, objectId: promoted.objectId }
  }
}

function restoreMissingActiveHeroes(armies: Army[], campaign: CampaignState, heroes: Hero[], locations: MapLocation[]) {
  for (const hero of heroes) {
    const state = campaign.heroStates[hero.id]
    if (!hero.alive || state?.status !== 'active' || !state.summoned || heroIsDeployed(hero.id, armies, campaign.locationStates)) continue
    const recovery = state.recoveryLocationId ? locations.find((location) => location.id === state.recoveryLocationId && location.side === hero.factionId) : null
    const destination = recovery ?? heroSummonLocation(hero, locations)
    if (!destination) continue
    const locationState = campaign.locationStates[destination.id] ?? { locationId: destination.id, recruitmentQueue: [], reserve: [], occupationTurnsLeft: 0 }
    locationState.reserve.push({ slotId: `restored-hero-${hero.id}`, kind: 'hero', entityId: hero.id, objectId: hero.objectId })
    campaign.locationStates[destination.id] = locationState
  }
}

function sanitizeArmies(armies: Army[], campaign: CampaignState, heroes: Hero[], captains: CaptainType[], removeGhosts = true) {
  const heroAvailable = (heroId: string) => {
    const hero = heroes.find((candidate) => candidate.id === heroId)
    return Boolean(hero?.alive && campaign.heroStates[heroId]?.status === 'active')
  }
  for (const army of armies) {
    army.heroSlots = army.heroSlots.filter((slot) => heroAvailable(slot.entityId))
    if (army.commander?.kind === 'hero' && !heroAvailable(army.commander.entityId)) army.commander = null
    if (!army.commander && army.heroSlots.length) {
      const promoted = army.heroSlots.shift()!
      army.commander = { kind: 'hero', entityId: promoted.entityId, objectId: promoted.objectId }
    }
    if (!army.commander) {
      const pool = campaign.freeCaptains[army.factionId] ?? []
      const index = pool.findIndex((instance) => captains.some((captain) => captain.id === instance.captainTypeId && captain.factionId === army.factionId))
      if (index >= 0) {
        const [instance] = pool.splice(index, 1)
        const type = captains.find((captain) => captain.id === instance.captainTypeId)!
        army.commander = { kind: 'captain', entityId: type.id, displayName: instance.displayName, instanceId: instance.instanceId }
      }
    }
  }
  if (removeGhosts) {
    const ghosts = new Set(armies.filter((army) => army.unitSlots.length === 0 && army.heroSlots.length === 0 && army.commander?.kind !== 'hero').map((army) => army.id))
    for (let index = armies.length - 1; index >= 0; index -= 1) if (ghosts.has(armies[index].id)) armies.splice(index, 1)
  }
}

export function normalizeRoster(value: unknown): RosterData {
  if (!value || typeof value !== 'object') return { version: ROSTER_DATA_VERSION, unitTypes: [], heroes: [], captains: [] }
  const source = value as Partial<RosterData>
  return {
    version: ROSTER_DATA_VERSION,
    unitTypes: normalizeUnits(source.unitTypes ?? []),
    heroes: normalizeHeroes(source.heroes ?? []),
    captains: normalizeCaptains((source.version ?? 0) >= 2 ? source.captains ?? [] : DEFAULT_CAPTAINS),
  }
}

export function normalizeWorld(value: unknown, rosterValue?: unknown): WorldData {
  const legacyLocations = Array.isArray(value) ? value as MapLocation[] : null
  if (!legacyLocations && (!value || typeof value !== 'object')) throw new Error('Файл world.json имеет неверный формат')
  const source = (legacyLocations ? { locations: legacyLocations } : value) as any
  if (!Array.isArray(source.locations)) throw new Error('В world.json отсутствует массив locations')

  const rawCells = source.grid?.cells ?? {}
  const cells = Object.fromEntries(Object.entries(rawCells).map(([id, raw]) => {
    const cell = raw as any
    return [id, {
      q: cell.q, r: cell.r, terrain: cell.terrain, moveCost: cell.moveCost,
      owner: cell.owner, zoneOfControl: cell.zoneOfControl, regionId: cell.regionId,
      passable: cell.passable, road: cell.road, river: cell.river,
      ford: cell.ford, bridge: cell.bridge,
    }]
  }))
  const grid = { config: { ...DEFAULT_GRID_CONFIG, ...(source.grid?.config ?? {}) }, cells }
  const factions = normalizeFactions(source.factions)
  const roster = rosterValue && typeof rosterValue === 'object' ? rosterValue as Partial<RosterData> : null
  const unitTypes = normalizeUnits(rosterValue !== undefined ? roster?.unitTypes ?? [] : source.unitTypes)
  const heroes = normalizeHeroes(rosterValue !== undefined ? roster?.heroes ?? [] : source.heroes, (source.version ?? 0) < 5)
  const captains = normalizeCaptains(rosterValue !== undefined ? roster?.captains ?? [] : source.captains)
  const looksLikeVanilla = source.locations.length === 79
    && source.locations.some((location: any) => location.id === 'helms-deep')
    && source.locations.some((location: any) => location.id === 'minas-tirith')
  const needsRegionHierarchy = (source.version ?? 0) < 31
  const sourceRegions = Array.isArray(source.regions) ? source.regions : []
  const hasAuthoredRegions = sourceRegions.some((region: any) => Array.isArray(region?.hexes) && region.hexes.length > 0 && !region.locationId)

  let regions: Region[]
  if (hasAuthoredRegions) {
    regions = sourceRegions.map((region: any) => {
      const localizedName = canonicalLocalized(region.name, region.en, region.nameTranslations)
      const localizedDescription = canonicalLocalized(region.description, region.descriptionEn, region.descriptionTranslations)
      return {
        id: String(region.id ?? 'region'),
        name: localizedName.canonical,
        nameTranslations: localizedName.translations,
        hexes: Array.isArray(region.hexes) ? region.hexes.map(String).filter((hex: string) => /^-?\d+:-?\d+$/.test(hex)) : [],
        color: typeof region.color === 'string' && /^#[0-9a-f]{6}$/i.test(region.color) ? region.color : '#7A8B99',
        ownerFactionId: region.ownerFactionId ?? null,
        description: localizedDescription.canonical,
        descriptionTranslations: localizedDescription.translations,
      } as Region
    }).filter((region) => region.id)
  } else if (looksLikeVanilla || needsRegionHierarchy) {
    regions = partitionLandHexesIntoRegions(grid, VANILLA_REGIONS, VANILLA_REGION_SEEDS)
  } else {
    regions = createDefaultRegions()
  }

  const locations = source.locations.map((location: any) => {
    const localized = canonicalLocalized(location.name, location.en, location.nameTranslations)
    const { en: _legacyEnglishName, x: _legacyX, y: _legacyY, kind: _legacyKind, settlementType: _legacyEconomicType, ...baseLocation } = location
    let structuralType: 'domain' | 'stronghold' =
      location.structuralType === 'stronghold' || location.structuralType === 'domain'
        ? location.structuralType
        : location.kind === 'keep' ? 'stronghold' : 'domain'
    if (needsRegionHierarchy && looksLikeVanilla && VANILLA_STRONGHOLD_IDS.has(location.id)) structuralType = 'stronghold'
    const legacyAxial = pixelToAxial((Number(location.x ?? 0) / 100) * WORLD_WIDTH, (Number(location.y ?? 0) / 100) * WORLD_HEIGHT, grid.config)
    const hex = typeof location.hex === 'string' && /^-?\d+:-?\d+$/.test(location.hex) ? location.hex : hexId(legacyAxial.q, legacyAxial.r)
    const economicType = location.economicType ?? location.settlementType ?? defaultSettlementType(location)
    const defaults = LOCATION_ECONOMY[economicType as keyof typeof LOCATION_ECONOMY] ?? LOCATION_ECONOMY.village
    const factionRecruitment = unitTypes.filter((unit) => unit.factionId === location.side).map((unit) => unit.id)
    const recruitment = Array.isArray(location.recruitment)
      ? location.recruitment
      : ['capital', 'fortress', 'city'].includes(economicType) ? factionRecruitment : factionRecruitment.slice(0, 2)
    const rtsMapCache = normalizeRtsMapAsset(location.rtsMapCache)
    const fortressPosition = location.rtsFortress?.defenderStartPosition
    const rtsFortress = fortressPosition
      ? { defenderStartPosition: { x: Number.isFinite(fortressPosition.x) ? Math.max(0, Math.min(1, Number(fortressPosition.x))) : null, y: Number.isFinite(fortressPosition.y) ? Math.max(0, Math.min(1, Number(fortressPosition.y))) : null } }
      : null
    const regionId = typeof location.regionId === 'string' && regions.some((region) => region.id === location.regionId)
      ? location.regionId
      : regionIdForHex(regions, hex) ?? ''
    const hexes = structuralType === 'domain' && Array.isArray(location.hexes)
      ? location.hexes.map(String).filter((value: string) => /^-?\d+:-?\d+$/.test(value))
      : undefined
    return {
      ...baseLocation,
      name: localized.canonical,
      nameTranslations: localized.translations,
      structuralType,
      hex,
      regionId,
      ...(structuralType === 'domain' ? { hexes: hexes ?? [] } : {}),
      image: location.image ?? '',
      economicType,
      income: { gold: Math.max(0, location.income?.gold ?? defaults.gold), materials: Math.max(0, location.income?.materials ?? defaults.materials) },
      recruitmentSlots: Math.max(0, location.recruitmentSlots ?? defaults.recruitmentSlots),
      reserveLimit: Math.max(0, location.reserveLimit ?? defaults.reserveLimit),
      recruitment,
      locationTags: Array.isArray(location.locationTags) ? [...new Set(location.locationTags)] : defaultTagsForLocation({ id: location.id, economicType, side: location.side }),
      culture: factions.some((faction) => faction.id === location.culture)
        ? location.culture
        : location.side !== 'civilian' && factions.some((faction) => faction.id === location.side) ? location.side : null,
      extraRecruitables: Array.isArray(location.extraRecruitables) ? location.extraRecruitables : [],
      blockedRecruitables: Array.isArray(location.blockedRecruitables) ? location.blockedRecruitables : [],
      rtsMapId: rtsMapCache?.mapPath ?? location.rtsMapId ?? '',
      rtsMapCache,
      rtsFortress,
      armyLimitBonus: Math.max(0, location.armyLimitBonus ?? (MAJOR_LOCATIONS.has(location.id) ? 1 : 0)),
    } as MapLocation
  })
  const occupiedHexes = new Set<string>()
  for (const location of locations) {
    if (occupiedHexes.has(location.hex)) {
      const [q, r] = location.hex.split(':').map(Number)
      let replacement = ''
      for (let radius = 1; radius < 20 && !replacement; radius++) {
        for (let dq = -radius; dq <= radius && !replacement; dq++) {
          for (let dr = -radius; dr <= radius && !replacement; dr++) {
            const candidate = `${q + dq}:${r + dr}`
            if (!occupiedHexes.has(candidate)) replacement = candidate
          }
        }
      }
      if (replacement) location.hex = replacement
    }
    occupiedHexes.add(location.hex)
  }

  let normalizedLocations = syncMapObjectRegionIds(locations, regions)
  const shouldRegenerateDomains = needsRegionHierarchy || normalizedLocations.some((location) => location.structuralType === 'domain' && !(location.hexes && location.hexes.length))
  if (shouldRegenerateDomains) normalizedLocations = regenerateDomainHexes(normalizedLocations, regions)
  regions = refreshRegionOwners(regions, normalizedLocations)

  const validRegionIds = new Set(regions.map((region) => region.id))
  for (const cell of Object.values(grid.cells)) {
    if (cell.regionId && !validRegionIds.has(cell.regionId)) cell.regionId = undefined
  }

  const defaultArmies = createDefaultArmies(normalizedLocations, grid)
  const armies = normalizeArmies(Array.isArray(source.armies) ? source.armies : defaultArmies, unitTypes, heroes, captains, (source.version ?? 0) < 13)
  for (const army of armies) {
    army.name = generateArmyName(army, armies, factions, normalizedLocations, heroes, grid.config)
    const cap = armyMovementCap(army, heroes, captains, unitTypes)
    army.movementRemaining = (source.version ?? 0) < 13 ? cap : Math.min(army.movementRemaining, cap)
  }
  const campaign = normalizeCampaign(source.campaign, factions, normalizedLocations, heroes)
  enforceCaptainHierarchy(armies, campaign)
  for (const army of armies) army.name = generateArmyName(army, armies, factions, normalizedLocations, heroes, grid.config)
  if ((source.version ?? 0) < 16) {
    campaign.phase = 'planning_good'
    campaign.firstMoverThisRound = campaign.round % 2 === 1 ? 'good' : 'evil'
    campaign.conflicts = []
    campaign.currentConflictId = null
  }

  return {
    version: WORLD_DATA_VERSION,
    locations: normalizedLocations,
    grid,
    factions,
    unitTypes,
    heroes,
    captains,
    armies,
    regions,
    campaign: { ...campaign, turnOrder: [...campaign.turnOrder], log: [...campaign.log] },
    battles: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33].includes(source.version) && Array.isArray(source.battles) ? source.battles.map((battle: any) => ({ ...battle, conflictId: battle.conflictId ?? null, attackerArmyIds: battle.attackerArmyIds ?? [battle.attackerArmyId], defenderArmyIds: battle.defenderArmyIds ?? [battle.defenderArmyId], attackerReinforcementArmyIds: battle.attackerReinforcementArmyIds ?? [], defenderReinforcementArmyIds: battle.defenderReinforcementArmyIds ?? [], defenseBonus: battle.defenseBonus ?? 0, winnerSide: battle.winnerSide ?? (battle.winnerArmyId === battle.attackerArmyId ? 'good' : 'evil'), garrisonLosses: battle.garrisonLosses ?? [] })) : [],
  }
}

export function normalizeSaveGame(value: unknown, world: WorldData): SaveGameData {
  if (!value || typeof value !== 'object') throw new Error('Файл сохранения отсутствует или повреждён')
  const source = value as any
  if (source.version !== SAVEGAME_DATA_VERSION || source.gameVersion !== GAME_VERSION) throw new Error(`Сохранение создано в другой версии игры: ${source.gameVersion ?? `данные ${source.version ?? 'неизвестны'}`}`)
  if (!Array.isArray(source.armies) || !source.campaign) throw new Error('Сохранение повреждено')
  const campaign = normalizeCampaign(source.campaign, world.factions, world.locations, world.heroes)
  const armies = normalizeArmies(source.armies, world.unitTypes, world.heroes, world.captains, false)
  const battles = Array.isArray(source.battles) ? source.battles.map((battle: any) => ({ ...battle, conflictId: battle.conflictId ?? null, attackerArmyIds: battle.attackerArmyIds ?? [battle.attackerArmyId], defenderArmyIds: battle.defenderArmyIds ?? [battle.defenderArmyId], attackerReinforcementArmyIds: battle.attackerReinforcementArmyIds ?? [], defenderReinforcementArmyIds: battle.defenderReinforcementArmyIds ?? [], defenseBonus: battle.defenseBonus ?? 0, winnerSide: battle.winnerSide ?? (battle.winnerArmyId === battle.attackerArmyId ? 'good' : 'evil'), garrisonLosses: battle.garrisonLosses ?? [] })) : []
  const heroAlive = { ...(source.heroAlive ?? Object.fromEntries(world.heroes.map((hero) => [hero.id, hero.alive]))) }
  for (const battle of battles) {
    const results = [...(battle.attackerLosses ?? []), ...(battle.defenderLosses ?? []), ...(battle.garrisonLosses ?? [])]
    for (const result of results.filter((loss: any) => loss.kind === 'hero' && (loss.outcome === 'dead'))) {
      const hero = world.heroes.find((candidate) => candidate.objectId === result.objectId)
      if (!hero) continue
      heroAlive[hero.id] = false
      const previous = campaign.heroStates[hero.id]
      campaign.heroStates[hero.id] = { ...previous, status: 'dead', summoned: previous?.summoned ?? true, availableSinceRound: previous?.availableSinceRound ?? null, summonLocationId: previous?.summonLocationId ?? hero.requiredLocationId, healTurnsLeft: 0, recoveryLocationId: null, diedRound: battle.round ?? campaign.round, diedLocationId: battle.locationId ?? null }
    }
  }
  for (const locationState of Object.values(campaign.locationStates)) locationState.reserve = locationState.reserve.filter((slot) => slot.kind !== 'hero' || campaign.heroStates[slot.entityId]?.status === 'active')
  enforceCaptainHierarchy(armies, campaign)
  const savedHeroes = world.heroes.map((hero) => ({ ...hero, alive: heroAlive[hero.id] ?? hero.alive }))
  sanitizeArmies(armies, campaign, savedHeroes, world.captains, Boolean(world.unitTypes.length || world.heroes.length || world.captains.length))
  restoreMissingActiveHeroes(armies, campaign, savedHeroes, world.locations)
  for (const army of armies) {
    army.name = generateArmyName(army, armies, world.factions, world.locations, world.heroes, world.grid.config)
    army.movementRemaining = Math.min(army.movementRemaining, armyMovementCap(army, world.heroes, world.captains, world.unitTypes))
  }

  return {
    version: SAVEGAME_DATA_VERSION,
    gameVersion: GAME_VERSION,
    modId: source.modId,
    name: source.name ?? 'Main Campaign',
    createdAt: source.createdAt ?? new Date().toISOString(),
    updatedAt: source.updatedAt ?? new Date().toISOString(),
    locationOwners: source.locationOwners ?? Object.fromEntries(world.locations.map((location) => [location.id, location.side])),
    regionOwners: source.regionOwners ?? Object.fromEntries(world.regions.map((region) => [region.id, region.ownerFactionId])),
    heroAlive,
    armies,
    campaign,
    battles,
  }
}

const isTauriRuntime = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
const BROWSER_LANGUAGE_KEY = 'wotr.interface-language'

async function parseError(response: Response, fallback: string) {
  const body = await response.text().catch(() => '')
  try { return (JSON.parse(body) as { error?: string }).error ?? body ?? fallback } catch { return body || fallback }
}
async function readModJson(modId: string, kind: 'world' | 'roster' | 'savegame' | 'mod') {
  if (isTauriRuntime()) return JSON.parse(await invoke<string>('read_mod_file', { modId, kind }))
  const response = await fetch(`/api/mod-file?modId=${encodeURIComponent(modId)}&kind=${kind}&t=${Date.now()}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(await parseError(response, `Не удалось прочитать ${kind}`))
  return response.json()
}
async function writeModJson(modId: string, kind: 'world' | 'roster' | 'savegame' | 'mod', value: unknown) {
  const contents = JSON.stringify(value, null, 2)
  if (isTauriRuntime()) { await invoke('write_mod_file', { modId, kind, contents }); return }
  const response = await fetch(`/api/mod-file?modId=${encodeURIComponent(modId)}&kind=${kind}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: contents })
  if (!response.ok) throw new Error(await parseError(response, `Не удалось сохранить ${kind}`))
}

export async function loadAppSettings(): Promise<AppSettings> {
  const desktop=isTauriRuntime()
  const raw = desktop
    ? JSON.parse(await invoke<string>('read_app_settings'))
    : await (async () => { const response = await fetch(`/api/app-settings?t=${Date.now()}`, { cache: 'no-store' }); if (!response.ok) throw new Error(await parseError(response, 'Не удалось прочитать app.json')); return response.json() })()
  let rtsExecutablePath=typeof raw.rtsExecutablePath==='string'?raw.rtsExecutablePath:''
  if(desktop&&!rtsExecutablePath)rtsExecutablePath=await discoverRtsExecutable()??DEFAULT_RTS_EXECUTABLE
  let storedBrowserLanguage:string|null=null
  if(!desktop){try{storedBrowserLanguage=window.localStorage.getItem(BROWSER_LANGUAGE_KEY)}catch{/* Browser storage may be unavailable in a restricted iframe. */}}
  const languageSource=desktop?raw.language:storedBrowserLanguage
  const language=languageSource==='ru'||languageSource==='en'?languageSource:null
  return { ...raw, language, rtsExecutablePath }
}
export async function saveAppSettings(settings: AppSettings) {
  if (isTauriRuntime()) { const contents=JSON.stringify(settings,null,2);await invoke('write_app_settings', { contents }); return }
  try {
    if(settings.language==='ru'||settings.language==='en')window.localStorage.setItem(BROWSER_LANGUAGE_KEY,settings.language)
    else window.localStorage.removeItem(BROWSER_LANGUAGE_KEY)
  } catch { /* The first-run selector will appear again if storage is unavailable. */ }
  // Browser-dev may be opened by several people over the LAN. Language is
  // intentionally per browser and must never be written into shared app.json.
  const contents=JSON.stringify({...settings,language:null},null,2)
  const response = await fetch('/api/app-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: contents }); if (!response.ok) throw new Error(await parseError(response, 'Не удалось сохранить app.json'))
}
export async function listMods(): Promise<ModSummary[]> {
  if (isTauriRuntime()) return invoke<ModSummary[]>('list_mods')
  const response = await fetch(`/api/mods?t=${Date.now()}`, { cache: 'no-store' }); if (!response.ok) throw new Error(await parseError(response, 'Не удалось получить список модов')); return response.json()
}
export async function createMod(metadata: Pick<ModDefinition, 'id' | 'name' | 'description' | 'author' | 'version' | 'bfmeVersion'>, sourceModId?: string | null) {
  if (isTauriRuntime()) return invoke<ModDefinition>('create_mod', { metadata, sourceModId: sourceModId ?? null })
  const response = await fetch('/api/mods', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', metadata, sourceModId: sourceModId ?? null }) }); if (!response.ok) throw new Error(await parseError(response, 'Не удалось создать мод')); return response.json()
}
export async function deleteMod(modId: string) {
  if (isTauriRuntime()) { await invoke('delete_mod', { modId }); return }
  const response = await fetch('/api/mods', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', modId }) }); if (!response.ok) throw new Error(await parseError(response, 'Не удалось удалить мод'))
}
export async function openModsFolder() {
  if (isTauriRuntime()) return invoke<string>('open_mods_folder')
  const response = await fetch('/api/mods', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'folder' }) }); if (!response.ok) throw new Error(await parseError(response, 'Не удалось открыть папку модов')); return (await response.json()).path as string
}
export async function openApplicationFolder(){if(isTauriRuntime())return invoke<string>('open_application_folder');return ''}
export async function exitApplication(){if(isTauriRuntime())await invoke('exit_application')}
export async function portableDataDirectory(){if(isTauriRuntime())return invoke<string>('portable_data_directory');return 'public/'}
export async function loadModDefinition(modId: string, factions: FactionDefinition[] = []): Promise<ModDefinition> {
  const raw = await readModJson(modId, 'mod') as ModDefinition
  const rts=normalizeRtsSettings(raw.rts,factions)
  if(modId==='default'){rts.moduleFiles=[];rts.mapsFile=null;if(rts.networkRules==='0 0 0 200 4000 -1 -1 -1 -1 -1')rts.networkRules=DEFAULT_NETWORK_RULES}
  return { ...raw, rts }
}
export async function saveModDefinition(modId: string, definition: ModDefinition) { await writeModJson(modId, 'mod', definition) }
async function listStoredRtsMapCaches(modId:string):Promise<Array<{scope:'location-cache';entityId:string;asset:RtsMapAsset}>>{
  const raw:any[]=isTauriRuntime()?await invoke<any[]>('list_rts_map_caches',{modId}):await(async()=>{const response=await fetch(`/api/rts-map-caches?modId=${encodeURIComponent(modId)}&t=${Date.now()}`,{cache:'no-store'});if(!response.ok)throw new Error(await parseError(response,'Не удалось прочитать каталог MapCache'));return response.json()})()
  return raw.map((item)=>({scope:item.scope,entityId:item.entityId,asset:{assetId:item.assetId??item.entityId,originalFileName:item.originalFileName??`${item.entityId}.big`,storageName:item.storageName,size:Number(item.size??0),cacheKey:item.cacheKey??'',mapPath:item.mapPath??'',mapName:item.mapName??'',numPlayers:Number(item.numPlayers??0),playerStarts:Array.isArray(item.playerStarts)?item.playerStarts:[]}}))
}
function refreshCampaignRts(campaign: CampaignState, armies: Army[], locations: MapLocation[], regions: Region[]) {
  for (const conflict of campaign.conflicts) {
    const direct = conflict.locationId ? locations.find((item) => item.id === conflict.locationId) : null
    const regionObjects = conflict.regionId ? locations.filter((item) => item.regionId === conflict.regionId) : []
    const owner = locations.find((item) => item.id === (conflict.rtsLocationId ?? direct?.id))
      ?? regionObjects.find((item) => item.rtsMapCache)
      ?? regionObjects.find((item) => item.structuralType === 'domain')
      ?? regionObjects[0]
      ?? null
    conflict.rtsLocationId = owner?.id ?? null
    conflict.rtsMapSource = 'location'
    conflict.rtsMapId = owner?.rtsMapCache?.mapPath ?? ''
    const position = direct?.rtsFortress?.defenderStartPosition
    conflict.rtsDefenderStartPosition = conflict.battleType === 'siege' && Number.isFinite(position?.x) && Number.isFinite(position?.y)
      ? { x: Number(position!.x), y: Number(position!.y) }
      : null
    updateConflictRtsCompatibility(conflict, armies, locations)
  }
}
export async function loadWorld(modId: string) {
  const rawWorld = await readModJson(modId, 'world')
  let rawRoster: unknown = { version: ROSTER_DATA_VERSION, unitTypes: [], heroes: [], captains: [] }
  try { rawRoster = await readModJson(modId, 'roster') } catch { /* Intentionally empty roster. */ }
  const world=normalizeWorld(rawWorld, rawRoster)
  try {
    const caches=await listStoredRtsMapCaches(modId)
    const locationCaches=new Map(caches.filter((item)=>item.scope==='location-cache').map((item)=>[item.entityId,item.asset]))
    world.locations=world.locations.map((location)=>{const stored=locationCaches.get(location.id);return stored?{...location,rtsMapCache:{...stored,originalFileName:location.rtsMapCache?.originalFileName??stored.originalFileName},rtsMapId:stored.mapPath}:{...location,rtsMapCache:null,rtsMapId:''}})
  } catch { /* JSON data remains usable even if the asset catalog is unavailable. */ }
  refreshCampaignRts(world.campaign,world.armies,world.locations,world.regions)
  return world
}
export interface LoadedSaveGame { saveGame: SaveGameData; compatible: boolean; savedGameVersion: string | null; reason: string | null }
export async function loadSaveGame(world: WorldData, modId: string, modDisplayName?: string): Promise<LoadedSaveGame> {
  try {
    const raw = await readModJson(modId, 'savegame') as any
    const savedGameVersion = typeof raw?.gameVersion === 'string' ? raw.gameVersion : null
    if (raw?.version !== SAVEGAME_DATA_VERSION || savedGameVersion !== GAME_VERSION || raw?.modId !== modId) return { saveGame: createNewSaveGame(world, modId), compatible: false, savedGameVersion, reason: `Сохранение не соответствует моду «${modDisplayName ?? modId}» или версии ${GAME_VERSION}.` }
    const saveGame=normalizeSaveGame(raw,world);refreshCampaignRts(saveGame.campaign,saveGame.armies,world.locations,world.regions);return { saveGame, compatible: true, savedGameVersion, reason: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const missing = /ENOENT|not found|не найден|os error [23]/i.test(message)
    return { saveGame: createNewSaveGame(world, modId), compatible: false, savedGameVersion: null, reason: missing ? 'Сохранение ещё не создано.' : message }
  }
}
export async function loadModMapUrl(modId: string) {
  if (isTauriRuntime()) return invoke<string>('read_mod_map', { modId })
  return `/api/mod-map?modId=${encodeURIComponent(modId)}&t=${Date.now()}`
}
export async function saveModMap(modId:string,file:File){
  if(isTauriRuntime()){const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file)});await invoke('write_mod_map',{modId,dataUrl});return}
  const response=await fetch(`/api/mod-map?modId=${encodeURIComponent(modId)}`,{method:'PUT',headers:{'Content-Type':file.type||'image/jpeg'},body:file});if(!response.ok)throw new Error(await parseError(response,'Не удалось сохранить карту'))
}
export async function resetModMap(modId:string){
  if(isTauriRuntime()){await invoke('reset_mod_map',{modId});return}
  const response=await fetch(`/api/mod-map?modId=${encodeURIComponent(modId)}`,{method:'DELETE'});if(!response.ok)throw new Error(await parseError(response,'Не удалось вернуть стандартную карту'))
}

export type RtsAssetScope = 'module' | 'maps' | 'location-cache'
export interface ImportedRtsAsset { id:string; originalFileName:string; targetFileName:string; storageName:string; size:number; cacheKey?:string; mapPath?:string; mapName?:string; numPlayers?:number; playerStarts?:RtsMapAsset['playerStarts'] }

export async function uploadRtsAsset(modId:string,scope:RtsAssetScope,entityId:string,file:File,targetFileName=''):Promise<ImportedRtsAsset>{
  const url=`/api/rts-asset?modId=${encodeURIComponent(modId)}&scope=${encodeURIComponent(scope)}&entityId=${encodeURIComponent(entityId)}&fileName=${encodeURIComponent(file.name)}&targetFileName=${encodeURIComponent(targetFileName)}`
  if(isTauriRuntime()){
    const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file)})
    return invoke<ImportedRtsAsset>('write_rts_asset',{modId,scope,entityId,fileName:file.name,targetFileName,dataUrl})
  }
  const response=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:file});if(!response.ok)throw new Error(await parseError(response,'Не удалось сохранить BIG-файл'));return response.json()
}

export async function pickAndImportRtsAsset(modId:string,scope:RtsAssetScope,entityId:string,targetFileName=''):Promise<ImportedRtsAsset|null>{
  if(!isTauriRuntime())return null
  return invoke<ImportedRtsAsset|null>('pick_and_import_rts_asset',{modId,scope,entityId,targetFileName})
}

export async function deleteRtsAsset(modId:string,scope:RtsAssetScope,entityId:string){
  if(isTauriRuntime()){await invoke('delete_rts_asset',{modId,scope,entityId});return}
  const response=await fetch(`/api/rts-asset?modId=${encodeURIComponent(modId)}&scope=${encodeURIComponent(scope)}&entityId=${encodeURIComponent(entityId)}`,{method:'DELETE'});if(!response.ok)throw new Error(await parseError(response,'Не удалось удалить BIG-файл'))
}

export interface RtsPreflightReport { ok:boolean; gameDirectory:string; executablePath:string; deployed:Array<{name:string;expectedSize:number;actualSize:number;action:'kept'|'copied'|'replaced'}>; errors:string[]; battleConfigPath:string }
export async function prepareRtsBattle(modId:string,executablePath:string,cacheScope:'location-cache',entityId:string,battleConfig:unknown):Promise<RtsPreflightReport>{
  if(!isTauriRuntime())throw new Error('Подготовка BFME доступна только в desktop-версии Tauri')
  return invoke<RtsPreflightReport>('prepare_rts_battle',{modId,executablePath,cacheScope,entityId,battleConfig})
}
export async function prepareAndStartRtsBattle(modId:string,executablePath:string,cacheScope:'location-cache',entityId:string,battleConfig:unknown):Promise<RtsPreflightReport>{
  if(!isTauriRuntime())throw new Error('Подготовка и запуск BFME доступны только в desktop-версии Tauri')
  return invoke<RtsPreflightReport>('prepare_and_start_rts_battle',{modId,executablePath,cacheScope,entityId,battleConfig})
}
export async function launchRtsGame(executablePath:string){if(!isTauriRuntime())throw new Error('Запуск BFME доступен только в desktop-версии Tauri');await invoke('launch_rts_game',{executablePath})}
export async function configureAndStartRtsBattle(executablePath:string,battleConfig:unknown){if(!isTauriRuntime())throw new Error('Автоматизация BFME доступна только в desktop-версии Tauri');await invoke('configure_and_start_rts_battle',{executablePath,battleConfig})}
export async function discoverRtsExecutable():Promise<string|null>{if(!isTauriRuntime())return null;return invoke<string|null>('discover_rts_executable')}
export async function validateRtsExecutable(executablePath:string):Promise<boolean>{if(!isTauriRuntime())return Boolean(executablePath);return invoke<boolean>('validate_rts_executable',{executablePath})}
export async function pickRtsExecutable():Promise<string|null>{if(!isTauriRuntime())return null;return invoke<string|null>('pick_rts_executable')}

export async function saveWorld(world: WorldData, modId: string) {
  const { unitTypes, heroes, captains, ...worldFile } = world
  const roster: RosterData = { version: ROSTER_DATA_VERSION, unitTypes, heroes, captains }
  await Promise.all([writeModJson(modId, 'world', worldFile), writeModJson(modId, 'roster', roster)])
  const metadata = await loadModDefinition(modId, world.factions)
  await writeModJson(modId, 'mod', { ...metadata, updatedAt: new Date().toISOString(), dataVersions: { world: WORLD_DATA_VERSION, roster: ROSTER_DATA_VERSION } })
}
export const saveGame = (save: SaveGameData, modId: string) => writeModJson(modId, 'savegame', save)
