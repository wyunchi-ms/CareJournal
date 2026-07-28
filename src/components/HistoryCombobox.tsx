import { ChevronDown, Clock3, ListChecks } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { sortByRecentChoices, useRecentChoices } from '../services/recentChoices'

interface HistoryComboboxProps {
  label: string
  value: string
  onChange: (value: string) => void
  options: string[]
  placeholder?: string
  suggestionsHeading?: string
  suggestionsLabel?: string
  optionDescriptions?: Record<string, string>
  historyKey?: string
  restrictToOptions?: boolean
}

export function HistoryCombobox({ label, value, onChange, options, placeholder, suggestionsHeading, suggestionsLabel, optionDescriptions, historyKey, restrictToOptions = false }: HistoryComboboxProps) {
  const id = useId()
  const listId = `${id}-history`
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const { recentChoices, remember } = useRecentChoices(label, historyKey)
  const normalizedOptions = useMemo(() => {
    const seen = new Set<string>()
    const sourceOptions = restrictToOptions ? options : [...recentChoices, ...options]
    const uniqueOptions = sourceOptions.map((item) => item.trim()).filter((item) => {
      const key = item.toLocaleLowerCase('zh-CN')
      if (!item || seen.has(key)) return false
      seen.add(key)
      return true
    })
    return sortByRecentChoices(uniqueOptions, recentChoices, (item) => item)
  }, [options, recentChoices, restrictToOptions])
  const suggestions = useMemo(() => {
    const query = value.trim().toLocaleLowerCase('zh-CN')
    return query ? normalizedOptions.filter((item) => item.toLocaleLowerCase('zh-CN').includes(query)) : normalizedOptions
  }, [normalizedOptions, value])

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])

  function select(item: string) {
    remember(item)
    onChange(item)
    setOpen(false)
    setActiveIndex(-1)
  }

  return <div className="history-combobox-field" ref={rootRef}>
    <label htmlFor={id}>{label}</label>
    <div className="history-combobox">
      <input
        id={id}
        value={value}
        onChange={(event) => { onChange(event.target.value); setOpen(true); setActiveIndex(-1) }}
        onFocus={() => setOpen(true)}
        onBlur={() => remember(value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && suggestions.length) { event.preventDefault(); setOpen(true); setActiveIndex((current) => Math.min(current + 1, suggestions.length - 1)) }
          if (event.key === 'ArrowUp' && suggestions.length) { event.preventDefault(); setActiveIndex((current) => Math.max(current - 1, 0)) }
          if (event.key === 'Enter' && open && activeIndex >= 0) { event.preventDefault(); select(suggestions[activeIndex]) }
          if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); setActiveIndex(-1) }
        }}
        placeholder={placeholder}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={listId}
        aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        autoComplete="off"
      />
      <button type="button" className="history-toggle" aria-label={suggestionsHeading ? `显示${label}选项` : `显示${label}历史`} onClick={() => setOpen((current) => !current)}><ChevronDown /></button>
      {open && suggestions.length > 0 && <div id={listId} className="history-suggestions" role="listbox" aria-label={suggestionsLabel ?? `${label}历史记录`}>
        <div className="history-suggestions-heading">{suggestionsHeading ? <ListChecks /> : <Clock3 />}<span>{suggestionsHeading ?? '最近使用'}</span></div>
        {suggestions.map((item, index) => <button id={`${listId}-${index}`} key={item} type="button" role="option" aria-selected={item === value} className={index === activeIndex ? 'active' : ''} onPointerDown={(event) => event.preventDefault()} onClick={() => select(item)}>
          <span className="history-suggestion-copy"><strong>{item}</strong>{optionDescriptions?.[item] && <small>{optionDescriptions[item]}</small>}</span>
        </button>)}
      </div>}
    </div>
  </div>
}
