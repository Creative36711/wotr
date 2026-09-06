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
