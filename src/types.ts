export type StructuralType = 'domain' | 'stronghold'
export type FactionId = string

export type TerrainType = 'plains' | 'forest' | 'hills' | 'mountains' | 'swamp' | 'desert' | 'snow' | 'wasteland' | 'water'
export type HexDirection = 'NE' | 'E' | 'SE' | 'SW' | 'W' | 'NW'
export type AppMode = 'edit' | 'game'
export type MapViewMode = 'cinematic' | 'tactical' | 'strategic'
export type SaveState = 'idle' | 'saving' | 'saved' | 'error'
export type UnitCategory = 'infantry' | 'archers' | 'cavalry' | 'monsters' | 'siege'
export type ArmyStatus = 'ready' | 'marched' | 'retreating' | 'garrison' | 'camp'
export type BattleType = 'field' | 'siege' | 'settlement'
export type SettlementType = 'village' | 'city' | 'fortress' | 'capital' | 'port' | 'mine' | 'farm' | 'wilderness' | 'swamp' | 'forest' | 'mountains' | 'ruins' | 'crossroads' | 'ford' | 'pass' | 'signal_tower' | 'camp'
export type ArmySlotKind = 'unit' | 'hero'
export type StrategicSide = 'good' | 'evil'
export type CampaignPhase = 'planning_good' | 'planning_evil' | 'movement_first' | 'movement_second' | 'conflicts' | 'aftermath'
export type MovementPhase = 'movement_first' | 'movement_second'
export type HeroUnlockType = 'starting' | 'turn' | 'location' | 'turn_location' | 'special'
export type AiDifficulty = 'recruit' | 'warrior' | 'veteran' | 'slayer'
export type RtsColorId = 'blue' | 'red' | 'yellow' | 'green' | 'orange' | 'light_blue' | 'purple' | 'pink' | 'black' | 'white'
/** English is canonical; any number of additional locales can be added here. */
export type LocalizedTranslations = Record<string, string>

export interface ResourceAmount {
  gold: number
  materials: number
}
export type CommanderKind = 'hero' | 'captain'

export interface RtsStoredFile {
  id: string
  originalFileName: string
  targetFileName: string
  storageName: string
  size: number
}

export interface RtsIntegrationSettings {
  enabled: boolean
  factionOrder: FactionId[]
  moduleFiles: RtsStoredFile[]
  mapsFile: RtsStoredFile | null
  mapCacheTargetFileName: string
  networkRules: string
}

export interface RtsMapAsset {
  assetId: string
  originalFileName: string
  storageName: string
  size: number
  cacheKey: string
  mapPath: string
  mapName: string
  numPlayers: number
  playerStarts: Array<{ slot: number; x: number; y: number; z: number }>
}

export interface RtsFortressSettings {
  defenderStartPosition: { x: number | null; y: number | null } | null
}

export interface ModDefinition {
  id: string
  name: string
  description: string
  author: string
  version: string
  createdAt: string
  updatedAt: string
  bfmeVersion: string
  /** Optional per-mod override. Null means the shared templates/map.jpg is used. */
  mapImage: string | null
  rts: RtsIntegrationSettings
  dataVersions: { world: number; roster: number }
}

export interface ModSummary extends ModDefinition {
  locationCount: number
  heroCount: number
  factionCount: number
  hasCompatibleSave: boolean
}

export interface AppSettings {
  activeModId: string
  lastPlayedMod: string
  appVersion: string
  language: 'ru' | 'en' | null
  recentMods: string[]
  /** Local machine setting; never exported as mod content. */
  rtsExecutablePath: string
}

export interface FactionDefinition {
  id: FactionId
  /** Canonical English display name. Never used as an ID. */
  label: string
  labelTranslations: LocalizedTranslations
  color: string
  emblem: string
  playable: boolean
  alignment: 'good' | 'evil' | 'neutral'
  /** Fixed BFME color selected from the game's 10-color palette. */
  rtsColor: RtsColorId
  /** Base cap before bonuses from controlled major locations. */
  baseArmyLimit: number
  startingTreasury: ResourceAmount
}

/** Catalog entry mapped to an Object ID from BFME code. */
export interface UnitType {
  id: string
  objectId: string
  factionId: FactionId
  /** Canonical English display name. */
  name: string
  nameTranslations: LocalizedTranslations
  category: UnitCategory
  /** Strategic auto-resolve power of one BFME Horde. */
  battlePower: number
  /** Strategic movement points; the slowest unit determines army speed. */
  movementPoints: number
  siegePower: number
  recruitCost: ResourceAmount
  recruitTime: number
  upkeep: number
  portrait: string
  requiredLocationTypes: SettlementType[]
  requiredLocationTags: string[]
  recruitDuringOccupation: boolean
  /** Non-null units are created by converting a reserve source unit and are not recruited directly. */
  transformationSourceUnitId: string | null
}

/** Named BFME hero catalog entry. Heroes use normal army slots. */
export interface Hero {
  id: string
  objectId: string
  factionId: FactionId
  /** Canonical English name and title. */
  name: string
  nameTranslations: LocalizedTranslations
  title: string
  titleTranslations: LocalizedTranslations
  battlePower: number
  command: number
  movementBonus: number
  alive: boolean
  portrait: string
  unlockType: HeroUnlockType
  requiredTurn: number
  requiredLocationId: string | null
  summonCostGold: number
}

export interface CaptainType {
  id: string
  factionId: FactionId
  /** Canonical English captain type name. */
  name: string
  nameTranslations: LocalizedTranslations
  /** Symbolic strategic contribution; captains are administrators, not combat heroes. */
  battlePower: number
  command: number
  movementBonus: number
  portrait: string
  /** Canonical English pool and locale-specific alternatives. */
  namePool: string[]
  namePoolTranslations: Record<string, string[]>
}

export interface CaptainInstance {
  instanceId: string
  captainTypeId: string
  displayName: string
}

export interface ArmyCommander {
  kind: CommanderKind
  entityId: string
  /** Present only for a named BFME Hero; strategic captains never spawn in RTS. */
  objectId?: string
  /** Generated once for a nonunique captain instance. */
  displayName?: string
  /** Stable identity used when the captain is released to or assigned from the free pool. */
  instanceId?: string
}

/** One army slot maps directly to one BFME object spawned for the RTS battle. */
export interface ArmySlot {
  slotId: string
  kind: ArmySlotKind
  entityId: string
  objectId: string
}

export interface Army {
  id: string
  name: string
  factionId: FactionId
  hexId: string
  movementRemaining: number
  baseUnitSlotLimit: number
  heroSlotLimit: number
  commander: ArmyCommander | null
  unitSlots: ArmySlot[]
  heroSlots: ArmySlot[]
  status: ArmyStatus
  canInitiateBattle: boolean
  /** An engaged army shares a hex with an enemy or attacks a hostile garrison. */
  engaged: boolean
  /** Used to decide which side initiated a conflict. */
  movedRound: number | null
  movedInPhase: MovementPhase | null
  /** Retreating after a defeat skips movement through this round. */
  exhaustedUntilRound: number | null
}

/**
 * Top-level geographic region (e.g. Eriador, Rohan).
 * Manually authored set of land hexes. Not 1:1 with a domain.
 */
export interface Region {
  id: string
  /** Canonical English name and description. */
  name: string
  nameTranslations: LocalizedTranslations
  /** Axial hex IDs that belong to this region. Authored in the editor. */
  hexes: string[]
  /** Fill / border color for region visualization. */
  color: string
  /**
   * Derived full-control owner: set when every domain and stronghold inside
   * the region belongs to the same faction. Null when split or empty.
   */
  ownerFactionId?: FactionId | null
  description: string
  descriptionTranslations: LocalizedTranslations
}

export interface CampaignLogEntry {
  id: string
  round: number
  factionId: FactionId | null
  phase: CampaignPhase
  text: string
  kind: 'turn' | 'move' | 'battle' | 'capture' | 'retreat' | 'hero' | 'army_destroyed' | 'system'
}

export interface FactionTreasuryState {
  gold: number
  materials: number
  lastIncome: ResourceAmount
  lastUpkeep: number
}

export interface RecruitmentQueueItem {
  id: string
  entityId: string
  turnsLeft: number
}

export interface LocationCampaignState {
  locationId: string
  recruitmentQueue: RecruitmentQueueItem[]
  reserve: ArmySlot[]
  occupationTurnsLeft: number
}

export type ArmyIntelSize = 'small' | 'medium' | 'large' | 'huge'

export interface LastSeenArmyIntel {
  armyId: string
  hexId: string
  factionId: FactionId
  sizeCategory: ArmyIntelSize
  hasHero: boolean
  wasMoving: boolean
  lastSeenRound: number
}

export interface LastSeenLocationIntel {
  locationId: string
  lastKnownOwner: FactionId
  hasGarrison: boolean
  garrisonCategory: 'none' | 'weak' | 'medium' | 'strong'
  lastSeenRound: number
}

export interface FogOfWarState {
  /** Gameplay rule chosen when the campaign starts; cannot be changed mid-campaign. */
  enabled: boolean
  /** Cosmetic switch for the dark overlay; intelligence rules remain active. */
  overlayVisible: boolean
  lastSeenArmies: LastSeenArmyIntel[]
  lastSeenLocations: LastSeenLocationIntel[]
}

export interface HeroCampaignState {
  status: 'locked' | 'available' | 'active' | 'wounded' | 'dead'
  summoned: boolean
  availableSinceRound: number | null
  summonLocationId: string | null
  healTurnsLeft: number
  recoveryLocationId: string | null
  diedRound: number | null
  diedLocationId: string | null
}

export interface ReinforcementOption {
  armyId: string
  side: StrategicSide
  tier: 'immediate' | 'distant'
  pathCost: number
}

export interface CampaignConflict {
  id: string
  round: number
  hexId: string
  battleType: BattleType
  locationId: string | null
  attackerSide: StrategicSide
  defenderSide: StrategicSide
  attackerArmyIds: string[]
  defenderArmyIds: string[]
  attackerReinforcementArmyIds: string[]
  defenderReinforcementArmyIds: string[]
  attackerDistantReinforcementArmyIds: string[]
  defenderDistantReinforcementArmyIds: string[]
  optionalPlayerReinforcements: ReinforcementOption[]
  garrisonLocationId: string | null
  regionId: string | null
  /** The single domain/stronghold whose MapCache is used for this battle. */
  rtsLocationId: string | null
  rtsMapSource: 'location'
  rtsMapId: string
  rtsDefenderStartPosition: { x: number; y: number } | null
  rtsAttackerSlots: number
  rtsDefenderSlots: number
  rtsCompatible: boolean
  captorFactionId: FactionId
  defenseBonus: number
  status: 'pending' | 'resolved'
  resolution: 'auto_battle' | 'defender_retreat' | null
  winnerSide: StrategicSide | null
  attackerPower: number | null
  defenderPower: number | null
  attackerLosses: number
  defenderLosses: number
}

export interface FactionCampaignStatistics {
  battlesWon: number
  battlesLost: number
  locationsCaptured: number
  heroesLost: number
}

export interface FactionCampaignState {
  /** Inactive factions were excluded when this campaign was created. */
  status: 'active' | 'inactive' | 'eliminated'
  eliminatedOnRound: number | null
  statistics: FactionCampaignStatistics
}

export type GameStatus = 'active' | 'victory_good' | 'victory_evil' | 'player_defeated'

export interface PendingArmyOrder {
  armyId: string
  destinationHexId: string
  path: string[]
  cost: number
  locationId: string | null
}

/** Pre-computed march of an allied AI army, shown as a dashed preview arrow during planning. */
export interface AlliedMovementPlan {
  armyId: string
  factionId: FactionId
  path: string[]
  destinationHexId: string
  locationId: string | null
  cost: number
}

export type TurnMovementAction = 'moved' | 'stayed' | 'retreated' | 'besieged'

/** One line of the post-turn movement report, collected for every faction regardless of fog. */
export interface TurnMovementRecord {
  id: string
  round: number
  factionId: FactionId
  armyName: string
  commanderName: string | null
  action: TurnMovementAction
  targetLabel: string | null
  distance: number
}

export interface CampaignState {
  round: number
  /** UI/default-faction cursor; only playerFactionId accepts manual orders. */
  activeFactionId: FactionId
  turnOrder: FactionId[]
  phase: CampaignPhase
  firstMoverThisRound: StrategicSide
  playerFactionId: FactionId | null
  playerSide: StrategicSide
  aiEnabled: boolean
  aiDifficulty: { strategic: AiDifficulty; rts: AiDifficulty }
  gameStatus: GameStatus
  gameResultDismissed: boolean
  factionStates: Record<FactionId, FactionCampaignState>
  freeCaptains: Record<FactionId, CaptainInstance[]>
  fogOfWar: FogOfWarState
  treasuries: Record<FactionId, FactionTreasuryState>
  locationStates: Record<string, LocationCampaignState>
  heroStates: Record<string, HeroCampaignState>
  pendingOrders: PendingArmyOrder[]
  alliedPlans: AlliedMovementPlan[]
  turnMovements: TurnMovementRecord[]
  conflicts: CampaignConflict[]
  currentConflictId: string | null
  log: CampaignLogEntry[]
}

export interface BattleSlotResult {
  slotId: string
  objectId: string
  kind: ArmySlotKind | 'captain'
  destroyed: boolean
  /** Final strategic fate for named heroes, resolved during aftermath. */
  outcome?: 'survived' | 'wounded' | 'dead'
}

export interface AutoBattleReport {
  id: string
  conflictId: string | null
  round: number
  battleType: BattleType
  terrain: TerrainType
  locationId: string | null
  attackerArmyId: string
  defenderArmyId: string
  attackerArmyIds: string[]
  defenderArmyIds: string[]
  attackerReinforcementArmyIds: string[]
  defenderReinforcementArmyIds: string[]
  attackerFactionId: FactionId
  defenderFactionId: FactionId
  attackerPower: number
  defenderPower: number
  defenseBonus: number
  winnerArmyId: string
  loserArmyId: string
  winnerSide: StrategicSide
  attackerLosses: BattleSlotResult[]
  defenderLosses: BattleSlotResult[]
  garrisonLosses: BattleSlotResult[]
  attackerDestroyed: boolean
  defenderDestroyed: boolean
  capturedLocationId: string | null
  summary: string
  timestamp: string
}

/**
 * Map object: a domain (multi-hex holding) or a stronghold (single hex).
 * Stored in world.json under the key `locations` for file stability; the UI
 * term is «объект карты / владение / оплот».
 */
export interface MapLocation {
  id: string
  /** Canonical English display name. */
  name: string
  nameTranslations: LocalizedTranslations
  side: FactionId
  structuralType: StructuralType
  /** Stable axial hex ID of the anchor; the rendered position is derived from the grid. */
  hex: string
  /**
   * Region this object belongs to. Derived from the anchor hex; required for
   * every placed object once regions cover the land map.
   */
  regionId: string
  /**
   * Auto-generated hexes owned by a domain, always inside `regionId`.
   * Strongholds omit this field (they only own `hex`).
   */
  hexes?: string[]
  image: string
  economicType: SettlementType
  income: ResourceAmount
  recruitmentSlots: number
  reserveLimit: number
  /** Legacy manual list; derived recruitment rules and overrides are authoritative. */
  recruitment: string[]
  locationTags: string[]
  culture: FactionId | null
  extraRecruitables: string[]
  blockedRecruitables: string[]
  /** Parsed map path from the uploaded cache BIG. */
  rtsMapId: string
  rtsMapCache: RtsMapAsset | null
  rtsFortress: RtsFortressSettings | null
  /** Bonus to the faction-wide army cap while this major location is controlled. */
  armyLimitBonus?: number
}

export interface HexGridConfig {
  orientation: 'pointy'
  size: number
  originX: number
  originY: number
  movementBudget: number
}

export interface HexCellOverride {
  q: number
  r: number
  terrain?: TerrainType
  moveCost?: number
  owner?: FactionId | null
  zoneOfControl?: FactionId | null
  regionId?: string | null
  passable?: boolean
  road?: boolean
  river?: boolean
  ford?: boolean
  bridge?: boolean
}

export interface HexGridData {
  config: HexGridConfig
  cells: Record<string, HexCellOverride>
}

export interface RosterData {
  version: 14
  unitTypes: UnitType[]
  heroes: Hero[]
  captains: CaptainType[]
}

export interface WorldData {
  version: 33
  grid: HexGridData
  locations: MapLocation[]
  factions: FactionDefinition[]
  unitTypes: UnitType[]
  heroes: Hero[]
  captains: CaptainType[]
  armies: Army[]
  regions: Region[]
  campaign: CampaignState
  battles: AutoBattleReport[]
}

export interface SaveGameData {
  version: 32
  gameVersion: string
  modId: string
  name: string
  createdAt: string
  updatedAt: string
  locationOwners: Record<string, FactionId>
  regionOwners: Record<string, FactionId | null>
  heroAlive: Record<string, boolean>
  armies: Army[]
  campaign: CampaignState
  battles: AutoBattleReport[]
}

export interface LogicalHex {
  id: string
  q: number
  r: number
  x: number
  y: number
  terrain: TerrainType
  moveCost: number
  owner: FactionId | null
  zoneOfControl: FactionId | null
  regionId: string | null
  /** Domain that owns this hex inside its region, if any. */
  domainId: string | null
  passable: boolean
  road: boolean
  river: boolean
  ford: boolean
  bridge: boolean
  locationIds: string[]
  nearestLocationId: string | null
}
