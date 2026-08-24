import { Activity, Check, Globe2, Languages } from 'lucide-react'
import { useEffect, useState } from 'react'
import { APP_LANGUAGES, APP_REGIONS, localeText, regionLabel } from '../services/localization'
import type { AppRegion, LocalePreferences } from '../types'

interface LocaleFieldsProps {
  value: LocalePreferences
  onChange: (value: LocalePreferences) => void
}

export function LocaleFields({ value, onChange }: LocaleFieldsProps) {
  const text = localeText[value.language]
  return <div className="locale-fields">
    <fieldset>
      <legend><Languages aria-hidden="true" />{text.language}</legend>
      <div className="locale-choice-grid language-grid">
        {APP_LANGUAGES.map((language) => <button
          key={language.value}
          type="button"
          className={value.language === language.value ? 'selected' : ''}
          aria-pressed={value.language === language.value}
          onClick={() => onChange({ ...value, language: language.value })}
        ><span>{language.nativeLabel}</span>{value.language === language.value && <Check aria-hidden="true" />}</button>)}
      </div>
    </fieldset>
    <label className="locale-region-field"><span><Globe2 aria-hidden="true" />{text.region}</span>
      <select value={value.region} onChange={(event) => onChange({ ...value, region: event.target.value as AppRegion })}>
        {APP_REGIONS.map((region) => <option key={region.value} value={region.value}>{region.labels[value.language]}</option>)}
      </select>
    </label>
  </div>
}

export function LocaleSetup({ initialValue, onComplete }: { initialValue: LocalePreferences; onComplete: (value: LocalePreferences) => Promise<void> }) {
  const [value, setValue] = useState(initialValue)
  const [saving, setSaving] = useState(false)
  const text = localeText[value.language]

  useEffect(() => {
    document.documentElement.lang = value.language
  }, [value.language])

  return <main className="locale-setup-screen">
    <section className="locale-setup-card" aria-labelledby="locale-setup-title">
      <div className="locale-setup-brand"><span><Activity aria-hidden="true" /></span><strong>CareJournal</strong></div>
      <header><h1 id="locale-setup-title">{text.welcome}</h1><p>{text.intro}</p></header>
      <LocaleFields value={value} onChange={setValue} />
      <button className="button primary locale-continue" disabled={saving} onClick={async () => {
        setSaving(true)
        try { await onComplete({ ...value, setupCompleted: true }) } finally { setSaving(false) }
      }}>{saving ? '…' : text.continue}</button>
      <small>{regionLabel(value.region, value.language)} · {APP_LANGUAGES.find((item) => item.value === value.language)?.nativeLabel}</small>
    </section>
  </main>
}
