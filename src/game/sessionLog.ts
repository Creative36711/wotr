/**
 * Подробный журнал партии.
 *
 * Задача — воспроизводимость: по журналу должно быть понятно, что именно сделал
 * игрок и что сделала игра в ответ, а для RTS-боёв к журналу прилагаются
 * скриншоты комнаты перед стартом и экрана статистики (их пишет Rust-мост в ту
 * же папку `portable_data/diagnostics/<сессия>/`).
 *
 * Хранилище: в desktop-версии строки дописываются в файл `campaign.log` рядом со
 * скриншотами; в браузерном `npm run dev` файл недоступен, поэтому журнал
 * держится в памяти и скачивается кнопкой в верхней панели.
 */
import { beginDiagnosticsSession, openDiagnosticsFolder, writeDiagnosticsFile } from '../dataService'

export interface SessionLogEntry {
  /** ISO-время с миллисекундами. */
  t: string
  round: number
  phase: string
  kind: string
  message: string
}

const MAX_ENTRIES = 20000
const MAX_LINE = 4000

let sessionKey = ''
let sessionFolder = ''
const entries: SessionLogEntry[] = []
const pending: string[] = []
let flushTimer: number | null = null
let snapshotWritten = false

export function isDesktopRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** Короткое ASCII-имя сессии: оно же имя папки диагностики. */
function makeSessionKey(prefix: string, factionId: string) {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const faction = factionId.replace(/[^a-z0-9-]/gi, '').slice(0, 24) || 'campaign'
  return `${prefix}-${stamp}-${faction}`
}

function formatLine(entry: SessionLogEntry) {
  const body = `${entry.t} | раунд ${entry.round} | ${entry.phase} | ${entry.kind} | ${entry.message}`
  return body.length > MAX_LINE ? `${body.slice(0, MAX_LINE)}…` : body
}

function scheduleFlush() {
  if (flushTimer !== null || !isDesktopRuntime() || !sessionKey) return
  flushTimer = window.setTimeout(() => {
    flushTimer = null
    void flushNow()
  }, 700)
}

/** Дописывает накопленные строки в файл сессии (только desktop). */
export async function flushNow() {
  if (!isDesktopRuntime() || !sessionKey || pending.length === 0) return
  const chunk = pending.splice(0, pending.length).join('\n')
  try {
    await writeDiagnosticsFile(sessionKey, 'campaign.log', `${chunk}\n`, true)
  } catch (error) {
    // Журнал не должен ронять игру: возвращаем строки в очередь и ждём следующей попытки.
    pending.unshift(chunk)
    console.warn('Не удалось записать журнал партии', error)
  }
}

/**
 * Начало новой сессии журнала. Старые сессии чистит Rust-мост: он оставляет
 * три последние папки диагностики и удаляет всё старше двух недель.
 */
export async function startSessionLog(prefix: 'campaign' | 'continue', meta: Record<string, unknown>, snapshot?: unknown) {
  sessionKey = makeSessionKey(prefix, String(meta.playerFactionId ?? 'campaign'))
  snapshotWritten = false
  entries.length = 0
  pending.length = 0
  if (isDesktopRuntime()) {
    try {
      sessionFolder = await beginDiagnosticsSession(sessionKey)
    } catch (error) {
      sessionFolder = ''
      console.warn('Не удалось создать папку диагностики', error)
    }
  }
  logEvent('session', `новая сессия ${sessionKey}`, meta)
  if (snapshot !== undefined) await writeCampaignSnapshot(snapshot)
  await flushNow()
}

/** Стартовое состояние кампании — точка, из которой партию можно повторить. */
export async function writeCampaignSnapshot(snapshot: unknown) {
  if (!isDesktopRuntime() || !sessionKey || snapshotWritten) return
  snapshotWritten = true
  try {
    await writeDiagnosticsFile(sessionKey, 'campaign-start.json', `${JSON.stringify(snapshot, null, 1)}\n`, false)
  } catch (error) {
    console.warn('Не удалось сохранить стартовый снимок кампании', error)
  }
}

/** Одна запись журнала. `data` сериализуется компактно и обрезается. */
export function logEvent(kind: string, message: string, data?: unknown) {
  const state = readTurnContext()
  const suffix = data === undefined ? '' : ` ${describe(data)}`
  const entry: SessionLogEntry = { t: new Date().toISOString(), round: state.round, phase: state.phase, kind, message: `${message}${suffix}` }
  entries.push(entry)
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES)
  pending.push(formatLine(entry))
  scheduleFlush()
}

type TurnContextProvider = () => { round: number; phase: string }
let turnContext: TurnContextProvider | null = null

/** Стор регистрирует здесь чтение раунда/фазы, чтобы избежать циклического импорта. */
export function registerTurnContext(provider: TurnContextProvider) {
  turnContext = provider
}

function readTurnContext() {
  try {
    return turnContext?.() ?? { round: 0, phase: '-' }
  } catch {
    return { round: 0, phase: '-' }
  }
}

/** Компактное и безопасное представление аргумента экшена. */
export function describe(value: unknown, budget = 400): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  const type = typeof value
  if (type === 'string' || type === 'number' || type === 'boolean') return String(value)
  if (value instanceof File) return `File(${value.name}, ${value.size}B)`
  try {
    const text = JSON.stringify(value, (_key, item) => {
      if (typeof item === 'string' && item.length > 120) return `${item.slice(0, 117)}…`
      if (Array.isArray(item) && item.length > 12) return [...item.slice(0, 12), `…+${item.length - 12}`]
      return item
    })
    if (text === undefined) return String(value)
    return text.length > budget ? `${text.slice(0, budget)}…` : text
  } catch {
    return Object.prototype.toString.call(value)
  }
}

export function sessionLogEntries() {
  return [...entries]
}

export function sessionLogText() {
  return entries.map(formatLine).join('\n')
}

export function currentSessionKey() {
  return sessionKey
}

export function currentSessionFolder() {
  return sessionFolder
}

/** Desktop: открыть папку со скриншотами и журналом. Browser: скачать журнал. */
export async function revealSessionLog() {
  if (isDesktopRuntime()) {
    await flushNow()
    if (sessionKey) await openDiagnosticsFolder(sessionKey)
    return
  }
  const blob = new Blob([sessionLogText()], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${sessionKey || 'campaign'}.log`
  anchor.click()
  URL.revokeObjectURL(url)
}
