// Harness for the 0.49.0 changes: play journal + selection/order mouse rules.
// Builds the TS/TSX sources with esbuild and runs them inside jsdom, so the
// real store, the real sessionLog and the real MapCanvas handler are executed.
// Not part of `npm run build` (verify/ is outside the tsconfig include).
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const outFile = path.join(here, '.build', 'cases.mjs')

await build({
  entryPoints: [path.join(here, 'cases.tsx')],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  jsx: 'automatic',
  logLevel: 'warning',
  loader: { '.css': 'empty', '.png': 'dataurl', '.svg': 'dataurl' },
  external: ['@tauri-apps/api/core'],
})

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
})
const { window } = dom

// jsdom has no PointerEvent; React reads altKey/button/clientX off the native
// event, so a MouseEvent subclass with a pointerId is enough.
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
define('navigator', window.navigator)
define('location', window.location)
define('HTMLElement', window.HTMLElement)
define('Element', window.Element)
define('Node', window.Node)
define('Event', window.Event)
define('MouseEvent', window.MouseEvent)
define('PointerEvent', PointerEventPolyfill)
define('ResizeObserver', ResizeObserverStub)
define('MutationObserver', window.MutationObserver)
// jsdom has no canvas backend; MapCanvas bails out on a null context, so the
// stub only keeps the virtual console quiet.
window.HTMLCanvasElement.prototype.getContext = () => null
define('getComputedStyle', window.getComputedStyle.bind(window))
define('requestAnimationFrame', window.requestAnimationFrame.bind(window))
define('cancelAnimationFrame', window.cancelAnimationFrame.bind(window))
define('Blob', window.Blob)
define('IS_REACT_ACT_ENVIRONMENT', true)
define('__MOD_PATH__', path.join(here, '..', 'public', 'mods', 'default'))
define('fetch', async () => ({ ok: true, status: 200, json: async () => ({}) }))
window.ResizeObserver = ResizeObserverStub
window.PointerEvent = PointerEventPolyfill
window.fetch = globalThis.fetch
window.URL.createObjectURL = () => 'blob:harness'
window.URL.revokeObjectURL = () => {}

await import(outFile)
