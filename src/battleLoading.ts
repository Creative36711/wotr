// Загрузочный экран перед RTS-боем («маска»).
//
// Пока мост в BFME настраивает бой (запуск игры, навигация по меню, комната,
// позиции), окно игры перекрыто кинематографичной заставкой места боя. Экран
// чисто информационный: он не ловит клики (сквозной для ввода) и не создаёт
// нагрузки — обновляется только по вызовам из ConflictModal и по событиям
// `battle-loading-progress` из Rust-моста (см. BattleLoadingScreen.tsx).
//
// Модуль сознательно без React: состояние — простой снимок, подписка —
// useSyncExternalStore в компоненте. Так маску можно дёргать из любого места
// интерфейса, включая колбэки, пережившие размонтирование модалки конфликта.

/** Шаг прогресса, приходящий событием из Rust-бэкенда (bfme_automation.rs). */
export interface BattleLoadingProgress {
  /** Техническое имя шага, например `room_setup`. */
  step: string
  /** Текст для отображения; используется, если шаг неизвестен интерфейсу. */
  label: string
  /** 0–100. */
  percent: number
}

/** Что маска показывает о месте боя. Картинка — data URL локации или '' (заглушка). */
export interface BattleLoadingRequest {
  /** Каноническое (английское) название локации. */
  title: string
  /** Переводы названия, `nameTranslations` объекта карты. */
  nameTranslations?: Record<string, string>
  /** Картинка локации; пустая строка → встроенная заглушка. */
  image?: string
}

export interface BattleLoadingState {
  visible: boolean
  /** `setup` — настройка боя, `result` — обработка экрана статистики. */
  mode: 'setup' | 'result'
  title: string
  nameTranslations: Record<string, string>
  image: string
  step: string
  label: string
  percent: number
  /** Полоса неопределённости (бегущая полоска) вместо процента. */
  indeterminate: boolean
  /** Язык интерфейса; заполняется только в состоянии для окна-маски. */
  language?: string
}

/**
 * Таблица шагов запуска боя. Проценты и русские тексты — единственный источник;
 * английские подписи берёт словарь UI_EN в `src/i18n.tsx`. Rust-мост шлёт шаги
 * с этими же техническими именами (`battle-loading-progress`).
 */
export const BATTLE_LOADING_STEPS: ReadonlyArray<{ step: string; percent: number; label: string }> = [
  { step: 'spawn_generation', percent: 5, label: 'Генерация армий…' },
  { step: 'network_prefs', percent: 10, label: 'Запись настроек…' },
  { step: 'game_launch', percent: 15, label: 'Запуск игры…' },
  { step: 'waiting_window', percent: 25, label: 'Ожидание окна игры…' },
  { step: 'waiting_menu', percent: 40, label: 'Ожидание главного меню…' },
  { step: 'menu_navigation', percent: 55, label: 'Навигация по меню…' },
  { step: 'room_setup', percent: 70, label: 'Настройка комнаты…' },
  { step: 'positions', percent: 85, label: 'Назначение позиций…' },
  { step: 'starting', percent: 95, label: 'Запуск боя…' },
  { step: 'ready', percent: 100, label: 'Бой начинается!' },
]

/** Подпись до первого шага (маска только что показана). */
export const BATTLE_LOADING_PREPARE_LABEL = 'Подготовка сражения…'
/** Подпись режима результата (экран статистики найден, исход применяется). */
export const BATTLE_LOADING_RESULT_LABEL = 'Обработка результата…'

const INITIAL_STATE: BattleLoadingState = {
  visible: false,
  mode: 'setup',
  title: '',
  nameTranslations: {},
  image: '',
  step: '',
  label: BATTLE_LOADING_PREPARE_LABEL,
  percent: 0,
  indeterminate: false,
}

// «Бой начинается!» и режим результата короткие: маска уходит сама, когда бой
// уже пошёл (игроку нужно окно игры) или отчёт уже виден в основном окне.
const READY_HIDE_MS = 1600
const RESULT_HIDE_MS = 3200

let state: BattleLoadingState = INITIAL_STATE
let hideTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function publish(next: BattleLoadingState) {
  state = next
  for (const listener of listeners) listener()
}

function cancelHideTimer() {
  if (hideTimer !== null) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

function scheduleHide(delay: number) {
  cancelHideTimer()
  hideTimer = setTimeout(() => {
    hideTimer = null
    hideBattleLoading()
  }, delay)
}

/** Снимок для useSyncExternalStore: одна ссылка на одно изменение. */
export const battleLoadingStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  getSnapshot(): BattleLoadingState {
    return state
  },
}

/**
 * Игрок нажал «Начать бой»: показать маску с картинкой локации и прогрессом 0 %.
 * Контекст (название, картинка) сохраняется и после скрытия — режим результата
 * переиспользует его без повторной передачи.
 */
export function showBattleLoading(request: BattleLoadingRequest) {
  cancelHideTimer()
  publish({
    ...INITIAL_STATE,
    visible: true,
    mode: 'setup',
    title: request.title ?? '',
    nameTranslations: request.nameTranslations ?? {},
    image: request.image ?? '',
  })
}

/** Фронтовый шаг по таблице (крупные фазы, видимые интерфейсу). */
export function setBattleLoadingStep(step: string) {
  const entry = BATTLE_LOADING_STEPS.find((item) => item.step === step)
  // Неизвестный шаг и шаги поверх скрытой маски игнорируются: подписи ведёт
  // тот, кто маску показал.
  if (!entry || !state.visible) return
  cancelHideTimer()
  publish({ ...state, step: entry.step, label: entry.label, percent: entry.percent, indeterminate: false })
  if (entry.step === 'ready') scheduleHide(READY_HIDE_MS)
}

/**
 * Шаг от Rust-моста (`battle-loading-progress`). Перекрывает фронтовый прогресс
 * точными фазами автоматизации. Событие может прийти уже после скрытия маски —
 * тогда оно ни на что не влияет.
 */
export function applyBattleLoadingProgress(progress: BattleLoadingProgress | null | undefined) {
  if (!progress || !state.visible) return
  const percent = Math.max(0, Math.min(100, Math.round(Number(progress.percent) || 0)))
  const entry = BATTLE_LOADING_STEPS.find((item) => item.step === progress.step)
  cancelHideTimer()
  publish({
    ...state,
    step: entry?.step ?? progress.step,
    // Известный шаг берёт каноническую русскую подпись из таблицы (её переводит
    // UI_EN); подпись события показывается только для незнакомых шагов.
    label: entry?.label ?? String(progress.label ?? state.label),
    percent,
    indeterminate: false,
  })
  if (entry?.step === 'ready' || percent >= 100) scheduleHide(READY_HIDE_MS)
}

/**
 * Состояние, пришедшее событием `battle-loading-state` из основного окна:
 * окно-маска не имеет общего стора, поэтому зеркалит этот снимок.
 */
export function applyExternalBattleLoadingState(payload: unknown) {
  const value = (payload ?? {}) as Partial<BattleLoadingState>
  publish({
    visible: Boolean(value.visible),
    mode: value.mode === 'result' ? 'result' : 'setup',
    title: String(value.title ?? ''),
    nameTranslations: value.nameTranslations && typeof value.nameTranslations === 'object' ? { ...value.nameTranslations } : {},
    image: String(value.image ?? ''),
    step: String(value.step ?? ''),
    label: String(value.label ?? BATTLE_LOADING_PREPARE_LABEL),
    percent: Number(value.percent) || 0,
    indeterminate: Boolean(value.indeterminate),
    language: typeof value.language === 'string' && value.language ? value.language : undefined,
  })
}

/**
 * Детектор нашёл экран статистики: маска возвращается поверх игры на время
 * применения результата и уходит сама, когда отчёт виден в основном окне.
 * Без аргументов переиспользует название и картинку последнего боя.
 */
export function showBattleLoadingResult(request?: Partial<BattleLoadingRequest>) {
  cancelHideTimer()
  publish({
    ...state,
    visible: true,
    mode: 'result',
    title: request?.title ?? state.title,
    nameTranslations: request?.nameTranslations ?? state.nameTranslations,
    image: request?.image || state.image,
    step: 'result',
    label: BATTLE_LOADING_RESULT_LABEL,
    percent: 0,
    indeterminate: true,
  })
  scheduleHide(RESULT_HIDE_MS)
}

/** Спрятать маску (ошибка запуска, аварийный выход, ручная уборка). */
export function hideBattleLoading() {
  cancelHideTimer()
  // Контекст последнего боя остаётся в снимке — режиму результата он ещё
  // пригодится; сам снимок невидим.
  if (!state.visible) return
  publish({ ...state, visible: false })
}
