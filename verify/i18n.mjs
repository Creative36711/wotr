// Guard against untranslated interface strings.
// Collects every static (non-interpolated) Russian string rendered by the
// components and runs it through the real translateText(), exactly the way
// DocumentLocalizer does at runtime. Any string that still contains Cyrillic
// in the English UI is a missing dictionary entry in src/i18n.tsx.
// Run: node verify/i18n.mjs   (needs esbuild; not part of `npm run build`)
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const outFile = path.join(here, '.build', 'i18n.mjs')
fs.mkdirSync(path.dirname(outFile), { recursive: true })

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.MutationObserver = dom.window.MutationObserver
globalThis.Node = dom.window.Node
globalThis.localStorage = dom.window.localStorage

await build({
  stdin: {
    contents: `export { translateText } from '${path.join(root, 'src', 'i18n.tsx').replaceAll('\\', '/')}'`,
    resolveDir: root,
    loader: 'tsx',
  },
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

const { translateText } = await import(outFile)

// Only static strings can be keyed exactly; anything with a JSX expression is
// dynamic and is skipped on purpose.
const PATTERNS = [
  /<span>([^<>{}]+)<\/span>/g,
  /<b>([^<>{}]+)<\/b>/g,
  /<summary>([^<>{}]+)</g,
  /<h3>([^<>{}]+)<\/h3>/g,
  /<button[^>]*>([^<>{}]+)<\/button>/g,
  /inline-check"><input[^>]*\/?>([^<>{}]+)<\/label>/g,
  /database-subhead">([^<>{}]+)</g,
  /database-toolbar"><span>([^<>{}]+)</g,
  /database-help">([^<>{}]+)<\/p>/g,
  /<small>([^<>{}]+)<\/small>/g,
  /database-toggle">.*?<span>([^<>{}]+)<\/span>/g,
  /label: '([^']+)'/g,
]
const CYRILLIC = /[А-Яа-яЁё]/

const componentsDir = path.join(root, 'src', 'components')
const found = new Map()
for (const file of fs.readdirSync(componentsDir).filter((name) => name.endsWith('.tsx'))) {
  const source = fs.readFileSync(path.join(componentsDir, file), 'utf8')
  for (const line of source.split('\n')) {
    for (const pattern of PATTERNS) {
      pattern.lastIndex = 0
      for (const match of line.matchAll(pattern)) {
        const text = match[1].trim()
        if (CYRILLIC.test(text) && !found.has(text)) found.set(text, file)
      }
    }
  }
}

const broken = []
for (const [text, file] of found) {
  const english = translateText(text, 'en')
  if (CYRILLIC.test(english)) broken.push({ file, text, english })
}

console.log(`i18n: проверено строк ${found.size}, без перевода ${broken.length}`)
for (const item of broken) {
  console.log(`  ${item.file}: ${item.text}`)
  console.log(`      → ${item.english === item.text ? '(без изменений)' : item.english}`)
}
if (broken.length) {
  console.error('\nДобавьте эти строки в UI_EN в src/i18n.tsx.')
  process.exit(1)
}
