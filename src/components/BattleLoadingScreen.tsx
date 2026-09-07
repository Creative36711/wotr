import { useEffect, useSyncExternalStore } from 'react'
import {
  applyBattleLoadingProgress,
  battleLoadingStore,
} from '../battleLoading'
import type { BattleLoadingProgress } from '../battleLoading'
// dataService и так статически входит в бандл — динамический импорт здесь
// только плодил предупреждение INEFFECTIVE_DYNAMIC_IMPORT без выгоды.
import { readRtsBattleProgress } from '../dataService'
import { getDisplayName, translateText, useI18n } from '../i18n'

// Заглушка места боя — та же, что и в карточках локаций интерфейса.
const PLACEHOLDER_IMAGE = '/assets/ui/location-placeholder.jpg'

// Имя события Tauri, которым Rust-мост (bfme_automation.rs) может публиковать
// шаги автоматизации напрямую; пока мост пишет их в файл, крупный прогресс
// ведёт ConflictModal, а точные фазы приходят из temp/rts_progress.json.
const PROGRESS_EVENT = 'battle-loading-progress'

/**
 * Загрузочный экран перед RTS-боем.
 *
 * Живёт ТОЛЬКО в окне приложения и никогда не рисуется поверх игры: любые
 * окна и оверлеи над полноэкранным BFME ломают его работу с мышью, поэтому
 * игра, когда появляется, перекрывает заставку естественно. Экран виден от
 * нажатия «BFME» до появления окна игры (подготовка файлов, UAC, запуск,
 * ожидание окна) — с реальным прогрессом из файла моста, — а после старта боя
 * прогресс продолжает жить в заголовке окна приложения (панель задач).
 *
 * Заставка не интерактивна (pointer-events: none) и обновляется только по
 * событиям и опросу файла — без анимационных циклов.
 */
export default function BattleLoadingScreen() {
  const state = useSyncExternalStore(battleLoadingStore.subscribe, battleLoadingStore.getSnapshot)
  const { language } = useI18n()
  const desktop = '__TAURI_INTERNALS__' in window

  // Точные фазы автоматизации: мост пишет temp/rts_progress.json на каждом
  // шаге, интерфейс опрашивает его и обновляет общий снимок.
  useEffect(() => {
    if (!desktop) return
    const timer = setInterval(() => {
      if (!battleLoadingStore.getSnapshot().visible) return
      readRtsBattleProgress()
        .then((progress) => { if (progress) applyBattleLoadingProgress(progress) })
        .catch(() => { /* Файла ещё нет — остаётся текущий шаг. */ })
    }, 800)
    return () => clearInterval(timer)
  }, [desktop])

  // Прогресс событием из Rust-бэкенда (emit со стороны моста). Подписка живёт
  // только в desktop-runtime; в браузере событий не бывает.
  useEffect(() => {
    if (!desktop) return
    let disposed = false
    let unlisten: (() => void) | null = null
    void import('@tauri-apps/api/event')
      .then(({ listen }) => listen<BattleLoadingProgress>(PROGRESS_EVENT, (event) => applyBattleLoadingProgress(event.payload)))
      .then((dispose) => {
        if (disposed) dispose()
        else unlisten = dispose
      })
      .catch(() => { /* API событий недоступен — остаётся файловый прогресс. */ })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [desktop])

  // Пока бой готовится, прогресс виден и в панели задач: заголовок окна
  // приложения показывает шаг и процент, даже когда игру развернуло поверх
  // заставки. После скрытия заголовок возвращается к названию игры.
  useEffect(() => {
    if (!state.visible) return
    const percent = state.indeterminate ? '' : ` ${Math.max(0, Math.min(100, Math.round(state.percent)))}%`
    const title = `⚔ ${translateText(state.label)}${percent}`
    document.title = title
    if (desktop) {
      void import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(title))
        .catch(() => { /* Заголовок остаётся прежним, если API недоступен. */ })
    }
    return () => {
      const restored = translateText('Война за Кольцо')
      document.title = restored
      if (desktop) {
        void import('@tauri-apps/api/window')
          .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(restored))
          .catch(() => { /* Заголовок остаётся прежним, если API недоступен. */ })
      }
    }
  }, [desktop, state.visible, state.label, state.percent, state.indeterminate])

  if (!state.visible) return null
  const title = getDisplayName({ name: state.title, nameTranslations: state.nameTranslations }, language)
  const percent = Math.max(0, Math.min(100, Math.round(state.percent)))
  return (
    <div className={`battle-loading${state.mode === 'result' ? ' result' : ''}`} role="status">
      <img
        className="battle-loading-backdrop"
        src={state.image || PLACEHOLDER_IMAGE}
        alt=""
        aria-hidden
        draggable={false}
        onError={(event) => { const image = event.currentTarget; if (image.dataset.fallback) return; image.dataset.fallback = '1'; image.src = PLACEHOLDER_IMAGE }}
      />
      <div className="battle-loading-shade" />
      <footer className="battle-loading-panel">
        <div className="battle-loading-heading">
          <span className="battle-loading-glyph">⚔</span>
          <div className="battle-loading-titles">
            {title && <h2>{title}</h2>}
            <p>{translateText(state.label, language)}</p>
          </div>
          {!state.indeterminate && <b className="battle-loading-percent">{percent}%</b>}
        </div>
        <div className="battle-loading-track">
          <div
            className={state.indeterminate ? 'battle-loading-fill indeterminate' : 'battle-loading-fill'}
            style={state.indeterminate ? undefined : { width: `${percent}%` }}
          />
        </div>
      </footer>
    </div>
  )
}
