// Guard against unstyled native controls.
// Renders the real game-data editor inside jsdom with the real stylesheets and
// reports every button/input/select whose computed style is identical to a bare
// element outside any container — that means no CSS rule reached it and the
// browser default (a light face on a dark UI) shows through.
// Run: node verify/styles.mjs   (needs esbuild + jsdom; not part of npm run build)
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const outFile = path.join(here, '.build', 'styles.mjs')
fs.mkdirSync(path.dirname(outFile), { recursive: true })

// The same stylesheets main.tsx imports, in the same order.
const styleFiles = [
  'global.css', 'campaign-cycle.css', 'menu.css', 'language.css', 'captains.css', 'heroes.css',
  'wounded-heroes.css', 'buildings-ring.css', 'map-markers.css', 'pending-orders.css',
  'fog-of-war.css', 'recruitment.css', 'factions.css', 'mods.css', 'rts.css',
]
const styles = styleFiles
  .map((name) => `<style data-file="${name}">${fs.readFileSync(path.join(root, 'src', name), 'utf8')}</style>`)
  .join('\n')

const dom = new JSDOM(
  `<!doctype html><html><head>${styles}</head><body><div id="probe"></div></body></html>`,
  { url: 'http://localhost/', pretendToBeVisual: true },
)
const { window } = dom

class PointerEventPolyfill extends window.MouseEvent {
  constructor(type, params = {}) {
    super(type, params)
    this.pointerId = params.pointerId ?? 1
    this.pointerType = params.pointerType ?? 'mouse'
    this.isPrimary = true
  }
}
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const define = (key, value) => Object.defineProperty(globalThis, key, { value, writable: true, configurable: true })
define('window', window)
define('document', window.document)
define('location', window.location)
define('HTMLElement', window.HTMLElement)
define('Element', window.Element)
define('Node', window.Node)
define('Event', window.Event)
define('MouseEvent', window.MouseEvent)
define('PointerEvent', PointerEventPolyfill)
define('ResizeObserver', ResizeObserverStub)
define('MutationObserver', window.MutationObserver)
window.HTMLCanvasElement.prototype.getContext = () => null
define('getComputedStyle', window.getComputedStyle.bind(window))
define('requestAnimationFrame', window.requestAnimationFrame.bind(window))
define('cancelAnimationFrame', window.cancelAnimationFrame.bind(window))
define('Blob', window.Blob)
define('IS_REACT_ACT_ENVIRONMENT', true)
define('__MOD_PATH__', path.join(root, 'public', 'mods', 'default'))
define('fetch', async () => ({ ok: true, status: 200, json: async () => ({}) }))
window.ResizeObserver = ResizeObserverStub
window.PointerEvent = PointerEventPolyfill
window.fetch = globalThis.fetch
window.URL.createObjectURL = () => 'blob:harness'
window.URL.revokeObjectURL = () => {}

const source = `
import { readFileSync } from 'node:fs'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import Inspector from '/home/user/wotr/src/components/Inspector.tsx'
import Sidebar from '/home/user/wotr/src/components/Sidebar.tsx'
import Topbar from '/home/user/wotr/src/components/Topbar.tsx'
import WorldDataEditor from '${path.join(root, 'src/components/WorldDataEditor.tsx').replaceAll('\\', '/')}'
import { I18nProvider } from '${path.join(root, 'src/i18n.tsx').replaceAll('\\', '/')}'
import { useMapStore } from '${path.join(root, 'src/store/useMapStore.ts').replaceAll('\\', '/')}'
import { normalizeWorld } from '${path.join(root, 'src/dataService.ts').replaceAll('\\', '/')}'
import { createNewSaveGame } from '${path.join(root, 'src/game/saveGame.ts').replaceAll('\\', '/')}'

const modPath = (globalThis as { __MOD_PATH__?: string }).__MOD_PATH__ ?? 'public/mods/default'
const world = normalizeWorld(
  JSON.parse(readFileSync(modPath + '/world.json', 'utf8')),
  JSON.parse(readFileSync(modPath + '/roster.json', 'utf8')),
)
useMapStore.getState().initialize(world, createNewSaveGame(world, 'default'))
const activeMod = JSON.parse(readFileSync(modPath + '/mod.json', 'utf8'))

const host = document.getElementById('probe')!
const root = createRoot(host)
await act(async () => {
  root.render(<I18nProvider><WorldDataEditor activeMod={activeMod} onModChange={() => {}} onClose={() => {}} /></I18nProvider>)
})

// Для input тип меняет браузерный вид, для остальных контролов — нет
// (у кнопок type="button" — это поведение, а не оформление).
const controlKey = (el: Element) => el.tagName === 'INPUT' ? 'INPUT:' + (el.getAttribute('type') ?? 'text') : el.tagName

// Baseline: bare controls outside every container. Anything matching these has
// no CSS rule behind it.
const baseline: Record<string, Record<string, string>> = {}
for (const html of ['<button>x</button>', '<input type="checkbox">', '<input type="number">', '<input type="text">', '<select><option>a</option></select>', '<textarea></textarea>']) {
  const el = document.createElement('div')
  el.innerHTML = html
  const node = el.firstElementChild as HTMLElement
  document.body.appendChild(node)
  const style = getComputedStyle(node)
  const key = controlKey(node)
  baseline[key] = { backgroundColor: style.backgroundColor, color: style.color, borderTopColor: style.borderTopColor }
  node.remove()
}

const describe = (el: Element) => {
  const chain: string[] = []
  for (let node: Element | null = el; node && chain.length < 4; node = node.parentElement) {
    const cls = (node.getAttribute('class') ?? '').split(' ').filter(Boolean).slice(0, 2).join('.')
    chain.push(cls || node.tagName.toLowerCase())
  }
  return chain.join(' < ')
}

const report: string[] = []
const seen = new Set<string>()

let scanned = 0
const perScreen: Record<string, number> = {}
const scan = (screen: string) => {
  const controls = [...host.querySelectorAll<HTMLElement>('button, input, select, textarea')]
  perScreen[screen] = controls.length
  scanned += controls.length
  for (const el of controls) {
    const base = baseline[controlKey(el)]
    if (!base) continue
    const style = getComputedStyle(el)
    // Чекбокс и радио красятся через accent-color; фон, цвет текста и рамка у
    // них браузерные всегда, поэтому для них критерий только один. jsdom отдаёт
    // rgba(0, 0, 0, 0) там, где accent-color не задан вовсе.
    const isToggle = el.tagName === 'INPUT' && (el.getAttribute('type') === 'checkbox' || el.getAttribute('type') === 'radio')
    // Галочка, растянутая правилом для текстовых полей (width:100%, height:30px),
    // выглядит пустым белым квадратом: браузерный чекбокс так не рисуется.
    const stretched = isToggle && (parseFloat(style.width) > 20 || parseFloat(style.height) > 20)
    const broken = isToggle
      ? style.accentColor === 'auto' || style.accentColor === 'rgba(0, 0, 0, 0)' || stretched
      : style.backgroundColor === base.backgroundColor
        && style.color === base.color
        && style.borderTopColor === base.borderTopColor
    if (!broken) continue
    const label = (el.textContent ?? el.getAttribute('aria-label') ?? el.getAttribute('placeholder') ?? '').trim().slice(0, 40)
    const id = screen + '|' + el.tagName + '|' + label + '|' + describe(el)
    if (seen.has(id)) continue
    seen.add(id)
    report.push(screen + ': ' + el.tagName.toLowerCase() + (label ? ' «' + label + '»' : '') + '  [' + describe(el) + ']')
  }
}

// 1) редактор игровых данных — по вкладке за проход
for (const tabButton of [...host.querySelectorAll<HTMLElement>('nav button')]) {
  await act(async () => { tabButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  scan('редактор, вкладка «' + (tabButton.textContent ?? '?').trim() + '»')
}

// 2) игровой экран: верхняя панель, боковая панель и инспектор
await act(async () => {
  root.render(
    <I18nProvider>
      <Topbar saveState="saved" activeModName="Vanilla 2.01" onSave={() => {}} onOpenData={() => {}} onMenu={() => {}} />
      <Sidebar onFocus={() => {}} />
      <Inspector activeModId="default" activeMod={activeMod} appSettings={null as never} onModChange={() => {}} />
    </I18nProvider>,
  )
})
// Фракцию берём из данных мира, а не из кампании: до newGame она ещё не выбрана.
const playerFaction = world.factions.find((item) => item.playable)?.id ?? ''
useMapStore.getState().newGame(playerFaction, false, 'default')
scan('игра, без выделения')
const own = useMapStore.getState().locations.filter((item) => item.side === playerFaction)
const army = useMapStore.getState().armies.find((item) => item.factionId === playerFaction)
for (const target of [own[0], own.find((item) => item.id !== own[0]?.id), army].filter(Boolean)) {
  await act(async () => {
    if (target === army) useMapStore.getState().selectArmy(army!.id)
    else useMapStore.getState().select((target as { id: string }).id)
  })
  scan('игра, ' + (target === army ? 'армия' : 'локация «' + (target as { name: string }).name + '»'))
}
;(globalThis as { __STYLE_REPORT__?: string[]; __STYLE_SCANNED__?: number; __STYLE_SCREENS__?: Record<string, number> }).__STYLE_SCANNED__ = scanned
;(globalThis as { __STYLE_SCREENS__?: Record<string, number> }).__STYLE_SCREENS__ = perScreen
;(globalThis as { __STYLE_REPORT__?: string[] }).__STYLE_REPORT__ = report
`

await build({
  stdin: { contents: source, resolveDir: root, loader: 'tsx' },
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  jsx: 'automatic',
  logLevel: 'warning',
  loader: { '.css': 'empty', '.png': 'dataurl', '.svg': 'dataurl' },
  external: ['@tauri-apps/api/core', 'node:fs'],
})

await import(outFile)

const report = globalThis.__STYLE_REPORT__ ?? []
const screens = globalThis.__STYLE_SCREENS__ ?? {}
console.log(`стили: экранов ${Object.keys(screens).length}, контролов проверено ${globalThis.__STYLE_SCANNED__ ?? 0}, без CSS-правила — ${report.length}`)
for (const [name, count] of Object.entries(screens)) console.log(`  ${String(count).padStart(4)} контролов — ${name}`)
for (const line of report) console.log('  ' + line)
if (report.length) {
  console.error('\nЭти контролы показывают браузерный стиль (светлый фон на тёмном интерфейсе).')
}
// jsdom держит event loop наблюдателями и таймерами — выходим явно.
window.close()
process.exit(report.length ? 1 : 0)
