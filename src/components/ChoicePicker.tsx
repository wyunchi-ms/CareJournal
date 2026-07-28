import { Check, ChevronDown, RotateCcw } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { sortByRecentChoices, useRecentChoices } from '../services/recentChoices'
import { Modal } from './Modal'

export interface ChoiceOption {
  value: string
  label: string
  description?: string
  color?: string
  count?: number
}

interface ChoicePickerProps {
  label: string
  options: ChoiceOption[]
  value: string | string[]
  onChange: (value: string | string[]) => void
  multiple?: boolean
  placeholder?: string
  allLabel?: string
  emptyText?: string
  icon?: ReactNode
  compact?: boolean
  disabled?: boolean
  selectionNoun?: string
  iconOnly?: boolean
  historyKey?: string
  orderByRecent?: boolean
}

export function ChoicePicker({ label, options, value, onChange, multiple = false, placeholder = '请选择', allLabel, emptyText = '暂无可选项', icon, compact = false, disabled = false, selectionNoun = '项', iconOnly = false, historyKey, orderByRecent = true }: ChoicePickerProps) {
  const [open, setOpen] = useState(false)
  const { recentChoices, remember } = useRecentChoices(label, historyKey)
  const selectedValues = useMemo(() => Array.isArray(value) ? value : value ? [value] : [], [value])
  const selectedOptions = options.filter((option) => selectedValues.includes(option.value))
  const sortedOptions = useMemo(() => orderByRecent ? sortByRecentChoices(options, recentChoices, (option) => option.value) : options, [options, orderByRecent, recentChoices])
  const summary = multiple
    ? selectedOptions.length === 0 && allLabel ? allLabel : selectedOptions.length === 1 ? selectedOptions[0].label : selectedOptions.length > 1 ? `已选 ${selectedOptions.length} ${selectionNoun}` : placeholder
    : selectedOptions[0]?.label ?? placeholder

  function choose(optionValue: string) {
    if (!multiple) {
      remember(optionValue)
      onChange(optionValue)
      setOpen(false)
      return
    }
    const alreadySelected = selectedValues.includes(optionValue)
    const next = alreadySelected
      ? selectedValues.filter((item) => item !== optionValue)
      : [...selectedValues, optionValue]
    if (!alreadySelected) remember(optionValue)
    onChange(next)
  }

  return <div className={`choice-picker${compact ? ' compact' : ''}${iconOnly ? ' icon-only' : ''}`}>
    {!compact && !iconOnly && <span className="choice-picker-label">{label}</span>}
    <button type="button" className={`choice-picker-trigger${selectedValues.length ? ' has-value' : ''}`} onClick={() => setOpen(true)} disabled={disabled || options.length === 0} aria-haspopup="dialog" aria-label={`${label}：${summary}`}>
      {icon && <span className="choice-picker-icon" aria-hidden="true">{icon}</span>}
      {!iconOnly && <span className="choice-picker-summary">{compact && <small>{label}</small>}<strong>{options.length ? summary : emptyText}</strong></span>}
      {!iconOnly && multiple && selectedOptions.length > 0 && <span className="choice-picker-count">{selectedOptions.length}</span>}
      {!iconOnly && <ChevronDown aria-hidden="true" />}
    </button>
    {open && <Modal title={multiple ? `${label}（可多选）` : label} onClose={() => setOpen(false)}>
      {allLabel && <div className="choice-picker-toolbar"><p>{selectedValues.length ? `已选 ${selectedValues.length} ${selectionNoun}` : allLabel}</p><button type="button" className="text-button" onClick={() => onChange(multiple ? [] : '')}><RotateCcw />{allLabel}</button></div>}
      <div className="choice-option-list" role="group" aria-label={label}>
        {options.length === 0 && <p className="choice-empty">{emptyText}</p>}
        {sortedOptions.map((option) => {
          const checked = selectedValues.includes(option.value)
          return <button key={option.value} type="button" role={multiple ? 'checkbox' : 'radio'} aria-checked={checked} className={`choice-option${checked ? ' selected' : ''}`} onClick={() => choose(option.value)}>
            <span className={`choice-check${multiple ? '' : ' radio'}`} aria-hidden="true">{checked && <Check />}</span>
            {option.color && <i className="choice-color" style={{ background: option.color }} aria-hidden="true" />}
            <span className="choice-option-copy"><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
            {option.count !== undefined && <span className="choice-option-count" aria-label={`${option.count} 个事件`}>{option.count}</span>}
          </button>
        })}
      </div>
      {multiple && <div className="choice-picker-footer"><span>{selectedValues.length ? `已选 ${selectedValues.length} ${selectionNoun}` : allLabel ?? '尚未选择'}</span><button className="button primary" type="button" onClick={() => setOpen(false)}>完成</button></div>}
    </Modal>}
  </div>
}
