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
  const next = { ...(translations ?? {}) }
  const trimmed = value.trim()
  if (trimmed) next[locale] = value
  else delete next[locale]
  delete next.en
  return next
}

export default function LocalizedNameFields({ label, canonical, translations, language, supportedLocales, disabled = false, onChange, onAddLocale }: LocalizedNameFieldsProps) {
  const [customLocale, setCustomLocale] = useState('')
  const locales = [...new Set(['en', ...(supportedLocales?.length ? supportedLocales : [])].map(normalizeLocale).filter(Boolean))]
  const translationLocales = locales.filter((locale) => locale !== 'en')
  const currentLocale = language !== 'en' && translationLocales.includes(language) ? language : null
  const addLocale = () => {
    const locale = normalizeLocale(customLocale)
    if (!locale || locale === 'en' || locales.includes(locale)) return
    onAddLocale(locale)
    setCustomLocale('')
  }

  return (
    <div className="localized-name-fields">
      {currentLocale && (
        <label className="localized-name-primary">
          <span>{label} [{currentLocale}]</span>
          <input value={translations?.[currentLocale] ?? ''} disabled={disabled} placeholder={canonical || label} onChange={(event) => onChange(canonical, patchTranslation(translations, currentLocale, event.target.value))} />
        </label>
      )}
      <label>
        <span>{label} [en]</span>
        <input value={canonical} disabled={disabled} onChange={(event) => onChange(event.target.value, { ...(translations ?? {}) })} />
      </label>
      <details className="translation-details">
        <summary>Translations</summary>
        {translationLocales.length === 0 && <p>Дополнительные языки не добавлены.</p>}
        {translationLocales.map((locale) => (
          <label key={locale}>
            <span>{locale}</span>
            <input value={translations?.[locale] ?? ''} disabled={disabled} placeholder={canonical} onChange={(event) => onChange(canonical, patchTranslation(translations, locale, event.target.value))} />
          </label>
        ))}
        {!disabled && <div className="translation-add-row"><input value={customLocale} placeholder="fr, de, es…" onChange={(event) => setCustomLocale(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addLocale() } }} /><button type="button" onClick={addLocale}>+ Add language</button></div>}
      </details>
    </div>
  )
}
