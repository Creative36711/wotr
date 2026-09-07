/* Cases executed by verify/run.mjs inside jsdom against the real sources. */
import { readFileSync } from 'node:fs'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import MapCanvas from '../src/components/MapCanvas'
import { useMapStore } from '../src/store/useMapStore'
import { createNewSaveGame } from '../src/game/saveGame'
import { translateText } from '../src/i18n'
import {
  attackerSupplyModifiers,
  createSupplyPool,
  currentSupplyAmount,
  DEFAULT_SUPPLY_SETTINGS,
  mergeSupplyPools,
  supplyAutoBattleWeight,
  supplyDecayFactor,
  travelAlongPath,
} from '../src/game/supply'
import type { SupplyPool, SupplyWorld } from '../src/types'
import {
  currentSessionFolder,
  currentSessionKey,
  describe,
  sessionLogEntries,
  sessionLogText,
  startSessionLog,
} from '../src/game/sessionLog'
import { normalizeWorld } from '../src/dataService'
import { I18nProvider } from '../src/i18n'
import { areFactionsHostile } from '../src/constants'
import { calculateVisibleHexes } from '../src/game/fogOfWar'
import { findReachable, hexDistance, resolveGrid } from '../src/hex/hexGrid'
import { cellEntryCostKind, classifyEntryCost, computeMovementTerrainOverlay } from '../src/hex/movementOverlay'
import type { LogicalHex } from '../src/types'

let passed = 0
const failures: string[] = []
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    passed += 1
    console.log(`  ok    ${name}`)
  } else {
    failures.push(name)
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const modPath = (globalThis as { __MOD_PATH__?: string }).__MOD_PATH__ ?? 'public/mods/default'
// world.json держит мир, roster.json — юнитов/героев/капитанов; приложение
// собирает из них WorldData через normalizeWorld, и харнесс делает то же самое.
const world = normalizeWorld(
  JSON.parse(readFileSync(`${modPath}/world.json`, 'utf8')),
  JSON.parse(readFileSync(`${modPath}/roster.json`, 'utf8')),
)

console.log('\n— журнал партии —')
const CAMPAIGN_STARTED_AT = '2026-09-04T17:14:36.706Z'
const CAMPAIGN_META = { playerFactionId: 'gondor', appVersion: '0.49.0', modId: 'default' }
const CAMPAIGN_SESSION = 'campaign-20260904-171436-gondor'

await startSessionLog(CAMPAIGN_STARTED_AT, CAMPAIGN_META, undefined, true)
check('папка кампании строится от даты создания сохранения', currentSessionKey() === CAMPAIGN_SESSION, currentSessionKey())
check('в браузерном режиме папки диагностики нет', currentSessionFolder() === '')
check('первая запись — начало кампании', (sessionLogEntries()[0]?.message ?? '').startsWith('новая кампания campaign-'), sessionLogEntries()[0]?.message ?? '<нет>')
check('в журнале записано разрешение экрана', /"screen":"\d+x\d+@[\d.]+"/.test(sessionLogEntries()[0]?.message ?? ''), sessionLogEntries()[0]?.message ?? '<нет>')
// «Продолжить» открывает ту же папку: партия определяется кампанией, а не
// запуском, поэтому бои и журнал разных сессий не перетирают друг друга.
await startSessionLog(CAMPAIGN_STARTED_AT, CAMPAIGN_META)
check('продолжение кампании открывает ту же папку', currentSessionKey() === CAMPAIGN_SESSION, currentSessionKey())
// Заголовок окна не зависит от режима — во всех языках только название игры.
const titleRu = translateText('Война за Кольцо', 'ru')
const titleEn = translateText('Война за Кольцо', 'en')
check('заголовок окна — название игры без режима', titleRu === 'Война за Кольцо' && titleEn === 'War of the Ring', `${titleRu} / ${titleEn}`)

console.log('\n— инструментирование стора —')
useMapStore.getState().initialize(world, createNewSaveGame(world, 'default'))
const initializeEntry = sessionLogEntries().find((entry) => entry.kind === 'действие' && entry.message.startsWith('initialize'))
check('initialize попал в журнал', Boolean(initializeEntry), 'записи нет')
check('мир на 0.5 МБ не сериализуется в строку журнала', (initializeEntry?.message.length ?? 0) < 200, `длина ${initializeEntry?.message.length}`)

const playable = world.factions.filter((faction) => faction.playable && (faction.alignment === 'good' || faction.alignment === 'evil'))
const playerId = playable[0].id
useMapStore.getState().newGame(playerId, false, 'default')
const campaign = useMapStore.getState().campaign
check('кампания началась', campaign.playerFactionId === playerId && campaign.round >= 1, `${campaign.playerFactionId} / раунд ${campaign.round}`)
const newGameEntry = sessionLogEntries().filter((entry) => entry.message.startsWith('newGame')).at(-1)
check('newGame попал в журнал с фазой хода', newGameEntry?.round === campaign.round && newGameEntry?.phase === campaign.phase, `${newGameEntry?.round}/${newGameEntry?.phase} против ${campaign.round}/${campaign.phase}`)
check('текст журнала содержит номер раунда', sessionLogText().includes(`раунд ${campaign.round}`))

const playerArmies = useMapStore.getState().armies.filter((army) => army.factionId === playerId && army.unitSlots.length + army.heroSlots.length > 0)
check('у игрока есть армии', playerArmies.length > 0, `армий ${playerArmies.length}`)
useMapStore.getState().selectArmy(playerArmies[0].id)
const selectEntry = sessionLogEntries().filter((entry) => entry.message.startsWith('selectArmy')).at(-1)
// Аргументы пишутся списком — по журналу видно границу между ними.
check('selectArmy записан со списком аргументов', selectEntry?.kind === 'действие' && selectEntry?.message === `selectArmy ["${playerArmies[0].id}"]`, `${selectEntry?.kind} / ${selectEntry?.message}`)

useMapStore.getState().selectHexes(Array.from({ length: 5000 }, (_, index) => `hex-${index}`))
const bulkEntry = sessionLogEntries().at(-1)!
check('массив из 5000 элементов не разворачивается', bulkEntry.message.length < 200, `длина ${bulkEntry.message.length}`)
useMapStore.getState().selectHexes([])

const huge = { locations: Array.from({ length: 400 }, (_, index) => ({ id: `location-${index}`, note: 'x'.repeat(400) })) }
check('describe обрезает большой объект', describe(huge).length <= 401, `длина ${describe(huge).length}`)

console.log('\n— выбор и приказы на карте —')
const container = document.createElement('div')
document.body.appendChild(container)
const root = createRoot(container)
await act(async () => {
  root.render(
    <I18nProvider>
      <MapCanvas focusTarget={null} mapImageUrl="" />
    </I18nProvider>,
  )
})

const ownPins = [...container.querySelectorAll<HTMLButtonElement>('button.pin')].filter((pin) =>
  pin.className.includes(`side-${playerId}`),
)
check('пины своих владений отрисованы', ownPins.length > 0, `найдено ${ownPins.length}`)

// Выделение меняется вне обработчика, поэтому его тоже нужно провести через act,
// иначе React не успеет перерисовать MapCanvas до отправки события.
const selectArmyNow = (armyId: string) =>
  act(async () => {
    useMapStore.getState().selectArmy(armyId)
  })

const pointer = (target: Element, altKey: boolean) =>
  act(async () => {
    target.dispatchEvent(
      new (globalThis as unknown as { PointerEvent: typeof Event }).PointerEvent('pointerdown', {
        altKey,
        button: 0,
        buttons: 1,
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      } as EventInit),
    )
  })

console.log('\n— подсветка проходимости: классификация —')
// Синтетические гексы: только поля, которые читает стоимость входа
// (cellMovementCost), поэтому ожидания не зависят от карты конкретного мода.
const mkCell = (id: string, patch: Partial<LogicalHex> = {}): LogicalHex => {
  const [q, r] = id.split(':').map(Number)
  return {
    id, q, r, x: 0, y: 0, terrain: 'plains', moveCost: 1, owner: null, zoneOfControl: null,
    regionId: null, domainId: null, passable: true, road: false, river: false, ford: false,
    bridge: false, locationIds: [], nearestLocationId: null, ...patch,
  }
}
check('непроходимый гекс — категория «непроходимо»', cellEntryCostKind(mkCell('0:0', { passable: false }), null) === 'impassable')
check('запретительная стоимость — категория «непроходимо»', classifyEntryCost(99) === 'impassable' && classifyEntryCost(Number.POSITIVE_INFINITY) === 'impassable')
check('горы (3 ОД) — категория «замедление»', cellEntryCostKind(mkCell('0:0', { moveCost: 3 }), null) === 'slow')
check('лес (2 ОД) — категория «замедление»', cellEntryCostKind(mkCell('0:0', { moveCost: 2 }), null) === 'slow')
check('река без переправы — категория «замедление»', cellEntryCostKind(mkCell('0:0', { river: true }), null) === 'slow')
check('равнина — категория «обычный»', cellEntryCostKind(mkCell('0:0'), null) === 'standard')
check('дорога в лесу снижает стоимость до обычной', cellEntryCostKind(mkCell('0:0', { moveCost: 2, road: true }), null) === 'standard')

// Мини-карта в одну линию: 0:0 (равнина) — 1:0 (равнина) — 2:0/3:0 (лес,
// по 2 ОД) — 4:0 (вода) — 5:0/6:0 (равнина). Бюджет 4 ОД: до 3:0 нужно 5 ОД.
const miniCells = new Map<string, LogicalHex>([
  ['0:0', mkCell('0:0')],
  ['1:0', mkCell('1:0')],
  ['2:0', mkCell('2:0', { moveCost: 2 })],
  ['3:0', mkCell('3:0', { moveCost: 2 })],
  ['4:0', mkCell('4:0', { passable: false })],
  ['5:0', mkCell('5:0')],
  ['6:0', mkCell('6:0')],
])
const miniOverlay = computeMovementTerrainOverlay(miniCells, {
  originHexId: '0:0', movementBudget: 4, movingFaction: null, visibleHexIds: null,
})
check('непроходимые гексы собираются в красную группу', miniOverlay.impassableIds.join() === '4:0', miniOverlay.impassableIds.join())
check('замедляющие гексы собираются в жёлтую группу', miniOverlay.slowIds.join() === '2:0,3:0', miniOverlay.slowIds.join())
check('недостижимые затемняются, непроходимые пропускаются', miniOverlay.unreachableIds.join() === '3:0,5:0,6:0', miniOverlay.unreachableIds.join())
check('гекс самой армии ни в одну группу не попадает', !miniOverlay.impassableIds.includes('0:0') && !miniOverlay.slowIds.includes('0:0') && !miniOverlay.unreachableIds.includes('0:0'))
const stopMiniOverlay = computeMovementTerrainOverlay(miniCells, {
  originHexId: '0:0', movementBudget: 4, movingFaction: null, visibleHexIds: null, stopAt: new Set(['1:0']),
})
check('за вражеским гексом досягаемость не раскрывается', stopMiniOverlay.unreachableIds.includes('2:0') && stopMiniOverlay.unreachableIds.includes('3:0') && !stopMiniOverlay.unreachableIds.includes('1:0'), stopMiniOverlay.unreachableIds.join())
const fogMiniOverlay = computeMovementTerrainOverlay(miniCells, {
  originHexId: '0:0', movementBudget: 2, movingFaction: null, visibleHexIds: new Set(['1:0', '2:0']),
})
check('гексы в тумане не попадают в подсветку', fogMiniOverlay.impassableIds.length === 0 && fogMiniOverlay.slowIds.join() === '2:0' && fogMiniOverlay.unreachableIds.join() === '2:0', `${fogMiniOverlay.impassableIds.join()}/${fogMiniOverlay.slowIds.join()}/${fogMiniOverlay.unreachableIds.join()}`)
const zeroMiniOverlay = computeMovementTerrainOverlay(miniCells, {
  originHexId: '0:0', movementBudget: 0, movingFaction: null, visibleHexIds: null,
})
check('с нулём очков движения затемнение не рисуется', zeroMiniOverlay.unreachableIds.length === 0 && zeroMiniOverlay.slowIds.join() === '2:0,3:0', zeroMiniOverlay.unreachableIds.join())

console.log('\n— подсветка проходимости на карте —')
const currentState = useMapStore.getState()
const originalFog = { ...currentState.campaign.fogOfWar }
const originalArmies = currentState.armies
const ownArmy = currentState.armies.find((army) =>
  army.factionId === currentState.campaign.playerFactionId
  && Boolean(army.commander) && !army.engaged && army.movementRemaining > 0 && army.unitSlots.length > 0,
)
check('найдена своя армия с командиром', Boolean(ownArmy), 'армии нет')

if (ownArmy) {
  const setFogEnabled = (enabled: boolean) =>
    act(async () => {
      const state = useMapStore.getState()
      useMapStore.setState({ campaign: { ...state.campaign, fogOfWar: { ...state.campaign.fogOfWar, enabled } } })
    })
  const polysOf = (group: string) =>
    [...container.querySelectorAll(`g.${group} polygon`)].map((polygon) => polygon.getAttribute('data-hex') ?? '')

  // Без тумана категории видны по всей карте — проверяем состав групп и их
  // согласованность с функцией классификации.
  await setFogEnabled(false)
  await selectArmyNow(ownArmy.id)
  const overlaySvg = container.querySelector('svg.movement-terrain-layer')
  check('при выделении своей армии подсветка активна', Boolean(overlaySvg))
  const impassableIds = polysOf('mt-impassable')
  const slowIds = polysOf('mt-slow')
  const unreachableIds = polysOf('mt-unreachable')
  check('красных непроходимых гексов больше нуля', impassableIds.length > 0, `найдено ${impassableIds.length}`)
  check('жёлтых замедляющих гексов больше нуля', slowIds.length > 0, `найдено ${slowIds.length}`)
  check('затемнённых недостижимых гексов больше нуля', unreachableIds.length > 0, `найдено ${unreachableIds.length}`)
  check('легенда цветов видна вместе со слоем', Boolean(container.querySelector('.movement-legend')))

  const resolvedState = useMapStore.getState()
  const resolvedCells = resolveGrid(resolvedState.grid, resolvedState.locations, resolvedState.regions).byId
  const mismatchedImpassable = impassableIds.filter((id) => cellEntryCostKind(resolvedCells.get(id)!, ownArmy.factionId) !== 'impassable')
  const mismatchedSlow = slowIds.filter((id) => cellEntryCostKind(resolvedCells.get(id)!, ownArmy.factionId) !== 'slow')
  const mismatchedUnreachable = unreachableIds.filter((id) => cellEntryCostKind(resolvedCells.get(id)!, ownArmy.factionId) === 'impassable')
  check('каждый красный гекс действительно непроходим', mismatchedImpassable.length === 0, `не совпали: ${mismatchedImpassable.join(',')}`)
  check('каждый жёлтый гекс действительно замедляющий', mismatchedSlow.length === 0, `не совпали: ${mismatchedSlow.join(',')}`)
  check('затемнение не трогает непроходимые гексы', mismatchedUnreachable.length === 0, `не совпали: ${mismatchedUnreachable.join(',')}`)
  check('гекс выделенной армии не подсвечивается', !impassableIds.includes(ownArmy.hexId) && !slowIds.includes(ownArmy.hexId) && !unreachableIds.includes(ownArmy.hexId), ownArmy.hexId)

  const enemies = useMapStore.getState().armies.filter((army) => areFactionsHostile(useMapStore.getState().factions, army.factionId, ownArmy.factionId))
  const reachableNow = new Set(findReachable(resolvedCells, ownArmy.hexId, ownArmy.movementRemaining, ownArmy.factionId, new Set(enemies.map((army) => army.hexId))).keys())
  const wronglyDimmed = unreachableIds.filter((id) => reachableNow.has(id))
  check('затемнённые гексы недостижимы за оставшиеся ОД', wronglyDimmed.length === 0, `достижимы: ${wronglyDimmed.join(',')}`)

  // Туман: армию переносим на равнину, где в радиусе обзора есть и вода
  // (красная), и лес (жёлтый), и гекс на границе обзора (затемнение).
  const locationHexes = new Set(useMapStore.getState().locations.map((location) => location.hex))
  const armyHexes = new Set(useMapStore.getState().armies.map((army) => army.hexId))
  let spot: { origin: LogicalHex; waterHexId: string; forestHexId: string; farHexId: string } | null = null
  for (const candidate of resolvedCells.values()) {
    if (!candidate.passable || candidate.terrain !== 'plains' || candidate.moveCost !== 1 || candidate.river || candidate.road) continue
    if (locationHexes.has(candidate.id) || armyHexes.has(candidate.id)) continue
    let blockedByArmy = false
    let waterHexId = ''
    let forestHexId = ''
    let farHexId = ''
    for (const other of resolvedCells.values()) {
      const distance = hexDistance(candidate, other)
      if (distance === 0 || distance > 2) continue
      if (armyHexes.has(other.id)) { blockedByArmy = true; break }
      if (!waterHexId && !other.passable) waterHexId = other.id
      if (!forestHexId && other.passable && other.terrain === 'forest') forestHexId = other.id
      if (!farHexId && distance === 2 && other.passable && cellEntryCostKind(other, ownArmy.factionId) === 'standard') farHexId = other.id
    }
    if (!blockedByArmy && waterHexId && forestHexId && farHexId) {
      spot = { origin: candidate, waterHexId, forestHexId, farHexId }
      break
    }
  }
  check('найдена равнина с водой и лесом в радиусе обзора', Boolean(spot))
  if (spot) {
    await act(async () => {
      const state = useMapStore.getState()
      useMapStore.setState({
        armies: state.armies.map((army) => army.id === ownArmy.id
          ? { ...army, hexId: spot!.origin.id, movementRemaining: 1 }
          : army),
      })
    })
    await setFogEnabled(true)
    const foggedState = useMapStore.getState()
    const visibleNow = calculateVisibleHexes(foggedState.campaign, foggedState.armies, foggedState.locations, foggedState.factions, foggedState.grid, foggedState.regions)
    const fogImpassableIds = polysOf('mt-impassable')
    const fogSlowIds = polysOf('mt-slow')
    const fogUnreachableIds = polysOf('mt-unreachable')
    check('под туманом подсветка остаётся активной', Boolean(container.querySelector('svg.movement-terrain-layer')))
    check('вода в поле зрения подсвечена красным', fogImpassableIds.includes(spot.waterHexId), spot.waterHexId)
    check('лес в поле зрения подсвечен жёлтым', fogSlowIds.includes(spot.forestHexId), spot.forestHexId)
    check('гекс на границе обзора затемнён', fogUnreachableIds.includes(spot.farHexId), spot.farHexId)
    const allFogIds = [...fogImpassableIds, ...fogSlowIds, ...fogUnreachableIds]
    const hiddenHighlighted = allFogIds.filter((id) => !visibleNow.has(id))
    check('гексы в тумане войны не подсвечиваются', hiddenHighlighted.length === 0, `подсвечено скрытых: ${hiddenHighlighted.length}`)
    await act(async () => {
      const state = useMapStore.getState()
      useMapStore.setState({ armies: originalArmies, campaign: { ...state.campaign, fogOfWar: { ...originalFog } } })
    })
  }

  // Чужая армия и снятие выделения подсветку не показывают.
  const foreignArmy = useMapStore.getState().armies.find((army) => army.factionId !== useMapStore.getState().campaign.playerFactionId && army.unitSlots.length > 0)
  check('найдена чужая армия', Boolean(foreignArmy))
  if (foreignArmy) {
    await selectArmyNow(foreignArmy.id)
    check('при выделении чужой армии подсветки нет', !container.querySelector('svg.movement-terrain-layer'))
    check('легенда скрыта для чужой армии', !container.querySelector('.movement-legend'))
  }
  await selectArmyNow(null)
  check('после снятия выделения подсветка исчезает', !container.querySelector('svg.movement-terrain-layer'))
  check('легенда скрыта после снятия выделения', !container.querySelector('.movement-legend'))
}

console.log('\n— снабжение армии —')
// Синтетический мир: своя локация с бонусами экономического типа.
// Фракция берётся из запущенной кампании: в разных мирах идентификаторы свои.
const supplyFaction = useMapStore.getState().campaign.playerFactionId
const supplyLocation = world.locations.find((location) => location.side === supplyFaction) ?? world.locations[0]
const supplyWorld: SupplyWorld = {
  campaign: useMapStore.getState().campaign,
  buildingTypes: useMapStore.getState().buildingTypes ?? [],
  economicTypes: useMapStore.getState().economicTypes,
  locationsByHex: new Map([[supplyLocation.hex, supplyLocation]]),
  locationById: new Map([[supplyLocation.id, supplyLocation]]),
  settings: DEFAULT_SUPPLY_SETTINGS,
}
const pool = createSupplyPool(supplyLocation, supplyFaction, 1, supplyWorld)!
check('снабжение выдаётся при формировании', Boolean(pool) && (pool.initialAmount.startingResources ?? 0) > 0, JSON.stringify(pool?.initialAmount ?? null))
check('свежее снабжение не деградировано', supplyDecayFactor(pool, DEFAULT_SUPPLY_SETTINGS) === 1, String(supplyDecayFactor(pool, DEFAULT_SUPPLY_SETTINGS)))

// 4 гекса и 2 хода: 1 − 4×0.05 − 2×0.15 = 0.50, затем перевозка ×0.5.
const worn: SupplyPool = { ...pool, initialAmount: { ...pool.initialAmount }, hexesTravelled: 4, turnsElapsed: 2 }
check('деградация по гексам и ходам', Math.abs(supplyDecayFactor(worn, DEFAULT_SUPPLY_SETTINGS) - 0.5) < 1e-9, String(supplyDecayFactor(worn, DEFAULT_SUPPLY_SETTINGS)))
check('перевозка теряет половину', currentSupplyAmount(worn, DEFAULT_SUPPLY_SETTINGS).startingResources === Math.floor((pool.initialAmount.startingResources ?? 0) * 0.25), String(currentSupplyAmount(worn, DEFAULT_SUPPLY_SETTINGS).startingResources))

// Долгий поход исчерпывает припасы полностью — эксплойт закрыт.
const exhausted = travelAlongPath(pool, Array.from({ length: 21 }, (_, index) => `hex-${index}`), supplyFaction, 1, supplyWorld)
check('дальний поход обнуляет снабжение', exhausted.pool === null && exhausted.depleted, JSON.stringify({ pool: exhausted.pool, depleted: exhausted.depleted }))

// Пополнение на транзите через свою локацию обнуляет счётчики.
const refilled = travelAlongPath(worn, [supplyLocation.hex, 'x', 'y'], supplyFaction, 5, supplyWorld)
check('транзит через свою локацию пополняет', refilled.refilledAt === supplyLocation.id && refilled.pool?.hexesTravelled === 2 && refilled.pool?.sourceRound === 5, JSON.stringify({ at: refilled.refilledAt, hexes: refilled.pool?.hexesTravelled }))

// Бонус атакующего — остаток снабжения; локационных бонусов у него нет.
const attackerModifiers = attackerSupplyModifiers(worn, supplyLocation, supplyFaction, supplyWorld, useMapStore.getState().palantirSettings)
check('бонус атакующего считается от снабжения', (attackerModifiers.startingResources ?? 0) === Math.floor((pool.initialAmount.startingResources ?? 0) * 0.25), String(attackerModifiers.startingResources))
check('у атакующего нет сигнального огня и обороны', attackerModifiers.signalFire === undefined && attackerModifiers.defenseBonus === undefined, JSON.stringify(attackerModifiers))
const sampleWeight = supplyAutoBattleWeight({ startingResources: 100, commandPointBonus: 50, palantirStartingPoints: 5, palantirIncomePerInterval: 1 })
check('вес снабжения в автобое', Math.abs(sampleWeight - 0.1) < 1e-9, String(sampleWeight))

// Слияние: припасы у более свежей армии, счётчики — худшие из двух.
const merged = mergeSupplyPools(worn, pool, DEFAULT_SUPPLY_SETTINGS)!
check('слияние берёт свежие припасы и худший путь', merged.sourceRound === pool.sourceRound && merged.hexesTravelled === 4 && merged.turnsElapsed === 2, JSON.stringify(merged))

const ordersOf = (armyId: string) => useMapStore.getState().campaign.pendingOrders.filter((order) => order.armyId === armyId)

// Пока армия выделена, обычный клик по своему объекту — приказ движения, а не
// выбор локации: игрок ведёт армию дальше и не переключает инспектор на город.
let orderedPlain = false
for (const pin of ownPins) {
  await selectArmyNow(playerArmies[0].id)
  await pointer(pin, false)
  if (ordersOf(playerArmies[0].id).length > 0) {
    orderedPlain = true
    break
  }
}
check('клик по своему объекту при выделенной армии отдаёт приказ', orderedPlain, 'ни один свой объект не принял приказ')
check('после приказа выделение армии снято', useMapStore.getState().selectedArmyId === null, `selectedArmyId=${useMapStore.getState().selectedArmyId}`)
check('после приказа подсветка исчезает', !container.querySelector('svg.movement-terrain-layer'), 'слой остался на карте')
check('приказ записан в журнал', sessionLogEntries().some((entry) => entry.message.startsWith('moveArmy')), 'записи moveArmy нет')

// Alt продолжает работать так же — регрессионная проверка на случай, если
// условие выбора и приказа снова разъедется.
let orderedAlt = false
for (const pin of ownPins) {
  await selectArmyNow(playerArmies[0].id)
  await pointer(pin, true)
  if (ordersOf(playerArmies[0].id).length > 0) {
    orderedAlt = true
    break
  }
}
check('Alt+клик по своему объекту тоже отдаёт приказ', orderedAlt, 'ни один свой объект не принял приказ')

// Без выделенной армии тот же клик просто выделяет локацию.
await act(async () => {
  useMapStore.setState({ selectedArmyId: null, selectedId: null })
})
await pointer(ownPins[0], false)
check('без выделенной армии клик выделяет локацию', Boolean(useMapStore.getState().selectedId), 'selectedId пуст')
await act(async () => {
  root.unmount()
})

console.log(`\n${passed} проверок пройдено, ${failures.length} провалено`)
if (failures.length) {
  console.log(`Провалены: ${failures.join('; ')}`)
  process.exit(1)
}

// Пример первых строк журнала — формат виден сразу.
console.log('\n— пример журнала —')
console.log(sessionLogText().split('\n').slice(0, 4).join('\n'))
console.log('...')
console.log(sessionLogText().split('\n').filter((line) => line.includes('moveArmy')).slice(-1).join('\n'))
