import { useEffect, useSyncExternalStore } from 'react'
import {
  applyBattleLoadingProgress,
  battleLoadingStore,
} from '../battleLoading'
import type { BattleLoadingProgress } from '../battleLoading'
import { getDisplayName, useI18n } from '../i18n'

// Заглушка места боя — та же, что и в карточках локаций интерфейса.
const PLACEHOLDER_IMAGE = '/assets/ui/location-placeholder.jpg'

// Имя события Tauri, которым Rust-мост (bfme_automation.rs) публикует шаги
// автоматизации. Пока мост их не шлёт, крупный прогресс ведёт ConflictModal.
const PROGRESS_EVENT = 'battle-loading-progress'

/**
 * Загрузочный экран перед RTS-боем (маска).
 *
 * Полноэкранная заставка места боя: фоновая картинка (или заглушка), название
 * локации, текущий шаг и полоса прогресса. Экран не интерактивный: он никогда
 * не перехватывает клики (pointer-events: none — сквозной даже до Win32-стилей
 * окна) и прячет курсор, который иначе бегал бы по заставке от авто-кликов
 * SendInput. Обновляется только по событиям — без анимационных циклов.
 */
export default function BattleLoadingScreen() {
  const state = useSyncExternalStore(battleLoadingStore.subscribe, battleLoadingStore.getSnapshot)
  const { language, t } = useI18n()

  // Прогресс из Rust-бэкенда. Подписка живёт, только пока работает desktop-
  // runtime; в браузере событий не бывает — маску ведёт сам ConflictModal.
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return
    let disposed = false
    let unlisten: (() => void) | null = null
    void import('@tauri-apps/api/event')
      .then(({ listen }) => listen<BattleLoadingProgress>(PROGRESS_EVENT, (event) => applyBattleLoadingProgress(event.payload)))
      .then((dispose) => {
        if (disposed) dispose()
        else unlisten = dispose
      })
      .catch(() => { /* API событий недоступен — остаётся фронтовый прогресс. */ })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

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
            <p>{t(state.label)}</p>
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
