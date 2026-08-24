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
import './map-markers.css'
import './pending-orders.css'
import './fog-of-war.css'
import './recruitment.css'
import './factions.css'
import './mods.css'
import './rts.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider><App /></I18nProvider>
  </React.StrictMode>,
)
