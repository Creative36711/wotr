// Fails the build when the app version drifts between the sources of truth.
// `src/version.ts` is canonical; package.json, tauri.conf.json, Cargo.toml and
// Cargo.lock must all agree, otherwise a compiled build reports a stale version.
//
// All parsing is line-ending agnostic: `.gitattributes` uses `text=auto`, so a
// Windows checkout gets CRLF files while CI and Linux get LF.
import { readFileSync } from 'node:fs'

const CRATE = 'war-of-the-ring'

/** Read a repo file and normalize CRLF/CR to LF so regexes stay portable. */
const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n?/g, '\n')

/** Version of the `[package]` table in a Cargo.toml (ignores dependency tables). */
function cargoTomlVersion(text) {
  const section = text.split(/^\[/m).find((part) => part.startsWith('package]'))
  return section?.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1]
}

/** Version of the `[[package]]` entry whose `name` is our crate. */
function cargoLockVersion(text, crate) {
  for (const block of text.split('[[package]]')) {
    const name = block.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1]
    if (name === crate) return block.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1]
  }
  return undefined
}

const versionSource = read('src/version.ts')
const canonical = versionSource.match(/GAME_VERSION\s*=\s*'([^']+)'/)?.[1]
if (!canonical) {
  console.error('check-version: cannot read GAME_VERSION from src/version.ts')
  process.exit(1)
}

// The Rust side keeps its own copy of the save format version. It only feeds
// `list_mods`, so a drift there silently hides every save as "incompatible"
// while the game itself keeps reading them — hence the guard.
const canonicalSave = Number(versionSource.match(/SAVEGAME_DATA_VERSION\s*=\s*(\d+)/)?.[1])
const rustSave = Number(read('src-tauri/src/lib.rs').match(/const SAVE_VERSION:\s*u64\s*=\s*(\d+)/)?.[1])
if (!Number.isFinite(canonicalSave) || canonicalSave !== rustSave) {
  console.error(
    `check-version: SAVEGAME_DATA_VERSION is ${canonicalSave || '<missing>'} (src/version.ts), ` +
      `but SAVE_VERSION in src-tauri/src/lib.rs is ${rustSave || '<missing>'}`,
  )
  process.exit(1)
}

const checks = [
  ['package.json', JSON.parse(read('package.json')).version],
  ['src-tauri/tauri.conf.json', JSON.parse(read('src-tauri/tauri.conf.json')).version],
  ['src-tauri/Cargo.toml', cargoTomlVersion(read('src-tauri/Cargo.toml'))],
  ['src-tauri/Cargo.lock', cargoLockVersion(read('src-tauri/Cargo.lock'), CRATE)],
]

const bad = checks.filter(([, value]) => value !== canonical)
if (bad.length) {
  console.error(`check-version: expected ${canonical} (from src/version.ts), but found:`)
  for (const [file, value] of bad) console.error(`  ${file}: ${value ?? '<missing>'}`)
  console.error('Update the version in every file above, then rebuild.')
  process.exit(1)
}
console.log(`check-version: all version fields agree on ${canonical}`)
