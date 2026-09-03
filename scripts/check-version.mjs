// Fails the build when the app version drifts between the sources of truth.
// src/version.ts is canonical; package.json, tauri.conf.json, Cargo.toml and
// Cargo.lock must all agree, otherwise a compiled build reports a stale version.
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const canonical = read('src/version.ts').match(/GAME_VERSION\s*=\s*'([^']+)'/)?.[1]
if (!canonical) {
  console.error('check-version: cannot read GAME_VERSION from src/version.ts')
  process.exit(1)
}

const checks = [
  ['package.json', JSON.parse(read('package.json')).version],
  ['src-tauri/tauri.conf.json', JSON.parse(read('src-tauri/tauri.conf.json')).version],
  ['src-tauri/Cargo.toml', read('src-tauri/Cargo.toml').match(/^version\s*=\s*"([^"]+)"/m)?.[1]],
  ['src-tauri/Cargo.lock', read('src-tauri/Cargo.lock').match(/name = "war-of-the-ring"\nversion = "([^"]+)"/)?.[1]],
]

const bad = checks.filter(([, value]) => value !== canonical)
if (bad.length) {
  console.error(`check-version: expected ${canonical} (from src/version.ts), but found:`)
  for (const [file, value] of bad) console.error(`  ${file}: ${value ?? '<missing>'}`)
  process.exit(1)
}
console.log(`check-version: all version fields agree on ${canonical}`)
