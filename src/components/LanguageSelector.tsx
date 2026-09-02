import type { AppLanguage } from '../i18n'

interface LanguageSelectorProps {
  mapImageUrl?: string
  firstRun?: boolean
  onSelect: (language: AppLanguage) => void
  onClose?: () => void
  supportedLocales?: string[]
}

const LANGUAGE_NAMES: Record<string, { label: string; native: string }> = {
  en: { label: 'English', native: 'English' },
  ru: { label: 'Russian', native: 'Русский' },
  tr: { label: 'Turkish', native: 'Türkçe' },
  es: { label: 'Spanish', native: 'Español' },
  it: { label: 'Italian', native: 'Italiano' },
  de: { label: 'German', native: 'Deutsch' },
  fr: { label: 'French', native: 'Français' },
}

function localeInfo(locale: string) {
  const normalized = locale.toLowerCase()
  return LANGUAGE_NAMES[normalized] ?? { label: normalized.toUpperCase(), native: normalized.toUpperCase() }
}

export default function LanguageSelector({ mapImageUrl, firstRun = false, onSelect, onClose, supportedLocales = ['en', 'ru'] }: LanguageSelectorProps) {
  const locales = [...new Set(['en', ...supportedLocales.map((locale) => locale.trim().toLowerCase()).filter(Boolean)])]
  return <main className="language-selection-screen" style={mapImageUrl ? { backgroundImage: `url(${mapImageUrl})` } : undefined}>
    <div className="menu-vignette" />
    <section className="language-selection-card">
      {!firstRun && onClose && <button type="button" className="language-close" onClick={onClose} aria-label="Close">×</button>}
      <header><span className="menu-ring"><i /></span><small>WAR OF THE RING</small><h1>Choose your language</h1><p>Select the interface language. You can change it later from the main menu.</p></header>
      <div className="language-options">
        {locales.map((locale) => { const info = localeInfo(locale); return <button type="button" key={locale} onClick={() => onSelect(locale)}><span>{locale.slice(0, 2).toUpperCase()}</span><div><b>{info.label}</b><small>{info.native} · interface language</small></div><i>→</i></button> })}
      </div>
      <footer>Interface language does not change BFME game files or mod identifiers.</footer>
    </section>
  </main>
}
