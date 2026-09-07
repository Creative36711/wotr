import { useEffect, useSyncExternalStore } from 'react'
import {
  applyBattleLoadingProgress,
  applyExternalBattleLoadingState,
  battleLoadingStore,
} from '../battleLoading'
import type { BattleLoadingProgress } from '../battleLoading'
import { getCurrentLanguage, getDisplayName, translateText, useI18n } from '../i18n'

// Заглушка места боя — та же, что и в карточках локаций интерфейса.
const PLACEHOLDER_IMAGE = '/assets/ui/location-placeholder.jpg'

// Имя события Tauri, которым Rust-мост (bfme_automation.rs) публикует шаги
// автоматизации. Пока мост их не шлёт, крупный прогресс ведёт ConflictModal.
const PROGRESS_EVENT = 'battle-loading-progress'
// Состояние загрузочного экрана, которое основное окно рассылает окну-маске.
const STATE_EVENT = 'battle-loading-state'

/**
 * Загрузочный экран перед RTS-боем (маска).
 *
 * Рендерится дважды:
 * - в основном окне — как обычный оверлей (и в браузерном режиме);
 * - в отдельном topmost-окне Tauri («battle-mask»), которое Rust показывает на
 *   время автоматизации с Win32-стилями сквозного окна: клики проходят к игре,
 *   фокус не крадётся, окно лежит поверх игры (см. set_battle_mask_window).
 *
 * Полноэкранная заставка места боя: фоновая картинка (или заглушка), название
 * локации, текущий шаг и полоса прогресса. Экран не интерактивный и прячет
 * курсор, который иначе бегал бы по заставке от авто-кликов SendInput.
 * Обновляется только по событиям — без анимационных циклов.
 */
export default function BattleLoadingScreen({ maskWindow = false }: { maskWindow?: boolean }) {
  const state = useSyncExternalStore(battleLoadingStore.subscribe, battleLoadingStore.getSnapshot)
  const i18n = useI18n()
  const desktop = '__TAURI_INTERNALS__' in window
  // Окно-маска не имеет общего стора с основным окном: язык приходит в снимке.
  const language = maskWindow ? state.language ?? 'en' : i18n.language

  // Язык окна-маски синхронизируется с языком основного окна, иначе DOM-
  // локализатор провайдера переведёт заставку на язык по умолчанию (en).
  useEffect(() => {
    if (maskWindow && state.language && state.language !== i18n.language) i18n.setLanguage(state.language)
  }, [maskWindow, state.language, i18n])

  // Окно-маска: зеркалим состояние, которое публикует основное окно.
  useEffect(() => {
    if (!maskWindow || !desktop) return
    let disposed = false
    let unlisten: (() => void) | null = null
    void import('@tauri-apps/api/event')
      .then(({ listen }) => listen(STATE_EVENT, (event) => applyExternalBattleLoadingState(event.payload)))
      .then((dispose) => {
        if (disposed) dispose()
        else unlisten = dispose
      })
      .catch(() => { /* API событий недоступен — маску ведёт её собственный стор. */ })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [maskWindow, desktop])

  // Основное окно: каждый снимок состояния уходит окну-маске, а само окно
  // показывается ровно на время видимости загрузочного экрана.
  useEffect(() => {
    if (maskWindow || !desktop) return
    return battleLoadingStore.subscribe(() => {
      const snapshot = battleLoadingStore.getSnapshot()
      void import('../dataService')
        .then(({ emitBattleLoadingState, setBattleMaskWindow }) => {
          if (snapshot.visible) void emitBattleLoadingState({ ...snapshot, language: getCurrentLanguage() })
          // Отказ окна-маски (не создано и т.п.) не роняет интерфейс:
          // остаётся оверлей основного окна.
          setBattleMaskWindow(snapshot.visible).catch(() => {})
        })
        .catch(() => { /* Без моста маской остаётся оверлей основного окна. */ })
    })
  }, [maskWindow, desktop])

  // Точные фазы автоматизации: мост пишет temp/rts_progress.json на каждом
  // шаге, основное окно опрашивает его и обновляет общий снимок (окно-маска
  // получает те же значения вместе с состоянием).
  useEffect(() => {
    if (maskWindow || !desktop) return
    const timer = setInterval(() => {
      if (!battleLoadingStore.getSnapshot().visible) return
      void import('../dataService')
        .then(({ readRtsBattleProgress }) => readRtsBattleProgress())
        .then((progress) => { if (progress) applyBattleLoadingProgress(progress) })
        .catch(() => { /* Файла ещё нет — остаётся текущий шаг. */ })
    }, 800)
    return () => clearInterval(timer)
  }, [maskWindow, desktop])

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
      .catch(() => { /* API событий недоступен — остаётся фронтовый прогресс. */ })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [desktop])

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
