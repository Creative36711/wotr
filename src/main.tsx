import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { I18nProvider } from './i18n'
import './global.css'
import './campaign-cycle.css'
import './menu.css'
import './language.css'
import './captains.css'
import './heroes.css'
import './wounded-heroes.css'
import './buildings-ring.css'
import './map-markers.css'
import './pending-orders.css'
import './fog-of-war.css'
import './recruitment.css'
import './factions.css'
import './mods.css'
import './rts.css'
import './battle-loading.css'
import BattleLoadingScreen from './components/BattleLoadingScreen'

// Окно-маска загрузочного экрана боя загружает тот же фронтенд, но рендерит
// только заставку (см. create_battle_mask_window в src-tauri/src/lib.rs).
const isBattleMaskWindow = window.location.hash.includes('battle-mask')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      {isBattleMaskWindow ? <BattleLoadingScreen maskWindow /> : <App />}
    </I18nProvider>
  </React.StrictMode>,
)
