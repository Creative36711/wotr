import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import packageJson from '../package.json' with { type: 'json' }

if (process.platform !== 'win32') {
  console.error('Portable Windows EXE must be built on Windows.')
  process.exit(1)
}

const architecture = process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? 'x86' : 'x64'
const source = path.resolve('src-tauri/target/release/war-of-the-ring.exe')
const outputDirectory = path.resolve('portable')
const destination = path.join(outputDirectory, `War-of-the-Ring_${packageJson.version}_windows_${architecture}.exe`)

if (!fs.existsSync(source)) {
  console.error(`Tauri executable was not found: ${source}`)
  process.exit(1)
}

fs.mkdirSync(outputDirectory, { recursive: true })
fs.copyFileSync(source, destination)
console.log(`Portable build created:\n${destination}`)
