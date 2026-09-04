/* Cases executed by verify/run.mjs inside jsdom against the real sources. */
import { readFileSync } from 'node:fs'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import MapCanvas from '../src/components/MapCanvas'
import { useMapStore } from '../src/store/useMapStore'
import { createNewSaveGame } from '../src/game/saveGame'
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
await startSessionLog('campaign', { playerFactionId: 'gondor', appVersion: '0.49.0', modId: 'default' })
check('ключ сессии = campaign-<дата>-<время>-<фракция>', /^campaign-\d{8}-\d{6}-gondor$/.test(currentSessionKey()), currentSessionKey())
check('в браузерном режиме папки диагностики нет', currentSessionFolder() === '')
check('первая запись — начало сессии', (sessionLogEntries()[0]?.message ?? '').startsWith('новая сессия campaign-'), sessionLogEntries()[0]?.message ?? '<нет>')

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

const ordersOf = (armyId: string) => useMapStore.getState().campaign.pendingOrders.filter((order) => order.armyId === armyId)

// Обычный клик по своему объекту всегда выделяет и никогда не отдаёт приказ.
for (const pin of ownPins) {
  await selectArmyNow(playerArmies[0].id)
  await pointer(pin, false)
}
check('клик по своему объекту без Alt не отдаёт приказ', ordersOf(playerArmies[0].id).length === 0, `приказов ${ordersOf(playerArmies[0].id).length}`)
check('клик по своему объекту выделяет его', Boolean(useMapStore.getState().selectedId), 'selectedId пуст')

// Alt+клик по своему гексу приказ отдаёт, и после приказа выделение снимается.
await selectArmyNow(playerArmies[0].id)
let ordered = false
for (const pin of ownPins) {
  await selectArmyNow(playerArmies[0].id)
  await pointer(pin, true)
  if (ordersOf(playerArmies[0].id).length > 0) {
    ordered = true
    break
  }
}
check('Alt+клик по своему объекту отдаёт приказ', ordered, 'ни один свой объект не принял приказ')
check('после приказа выделение армии снято', useMapStore.getState().selectedArmyId === null, `selectedArmyId=${useMapStore.getState().selectedArmyId}`)
check('приказ записан в журнал', sessionLogEntries().some((entry) => entry.message.startsWith('moveArmy')), 'записи moveArmy нет')

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
