import { useState } from 'react'
import type { AppLanguage } from '../i18n'

interface LocalizedNameFieldsProps {
  label: string
  canonical: string
  translations?: Record<string, string>
  language: AppLanguage
  supportedLocales: string[]
  disabled?: boolean
  onChange: (canonical: string, translations: Record<string, string>) => void
  onAddLocale: (locale: string) => void
}

const normalizeLocale = (value: string) => value.trim().toLowerCase().replace(/_/g, '-').replace(/[^a-z0-9-]/g, '')
function patchTranslation(translations: Record<string, string> | undefined, locale: string, value: string) {
  const next = { ...(translations ?? {}) }; const trimmed = value.trim()
  if (trimmed) next[locale] = value; else delete next[locale]
  delete next.en
  return next
}

/** Canonical English is always visible. Only the currently selected translation
 * is shown; the expandable control is solely for adding another locale. */
export default function LocalizedNameFields({ label, canonical, translations, language, supportedLocales, disabled = false, onChange, onAddLocale }: LocalizedNameFieldsProps) {
  const [customLocale, setCustomLocale] = useState('')
  const locales = [...new Set(['en', ...(supportedLocales?.length ? supportedLocales : [])].map(normalizeLocale).filter(Boolean))]
  const activeTranslation = language !== 'en' && locales.includes(language) ? language : null
  const addLocale = () => {
    const locale = normalizeLocale(customLocale)
    if (!locale || locale === 'en' || locales.includes(locale)) return
    onAddLocale(locale); setCustomLocale('')
  }
  return <div className="localized-name-fields">
    {activeTranslation && <label className="localized-name-primary"><span>{label} [{activeTranslation}]</span><input value={translations?.[activeTranslation] ?? ''} disabled={disabled} placeholder={canonical || label} onChange={(event) => onChange(canonical, patchTranslation(translations, activeTranslation, event.target.value))} /></label>}
    <label><span>{label} [en]</span><input value={canonical} disabled={disabled} onChange={(event) => onChange(event.target.value, { ...(translations ?? {}) })} /></label>
    {!disabled && <details className="translation-details">
      <summary>{language === 'en' ? 'Manage languages' : 'Add another language'}</summary>
      <p>{language === 'en' ? 'English is the canonical language. Translation fields are shown only after selecting that language.' : 'Only the selected interface language is shown alongside English.'}</p>
      <div className="translation-add-row"><input value={customLocale} placeholder="tr, es, it…" aria-label="Language code" onChange={(event) => setCustomLocale(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addLocale() } }} /><button type="button" onClick={addLocale}>+ Add language</button></div>
    </details>}
  </div>
}
