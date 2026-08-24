import type { AppLanguage } from '../i18n'

interface LanguageSelectorProps {
  mapImageUrl?: string
  firstRun?: boolean
  onSelect: (language: AppLanguage) => void
  onClose?: () => void
}

export default function LanguageSelector({ mapImageUrl, firstRun = false, onSelect, onClose }: LanguageSelectorProps) {
  return <main className="language-selection-screen" style={mapImageUrl ? { backgroundImage: `url(${mapImageUrl})` } : undefined}>
    <div className="menu-vignette" />
    <section className="language-selection-card">
      {!firstRun && onClose && <button type="button" className="language-close" onClick={onClose} aria-label="Close">×</button>}
      <header><span className="menu-ring"><i /></span><small>WAR OF THE RING</small><h1>Choose your language</h1><p>Select the interface language. You can change it later from the main menu.</p></header>
      <div className="language-options">
        <button type="button" onClick={() => onSelect('en')}><span>EN</span><div><b>English</b><small>Continue in English</small></div><i>→</i></button>
        <button type="button" onClick={() => onSelect('ru')}><span>RU</span><div><b>Russian</b><small>Continue in Russian</small></div><i>→</i></button>
      </div>
      <footer>Interface language does not change BFME game files or mod identifiers.</footer>
    </section>
  </main>
}
