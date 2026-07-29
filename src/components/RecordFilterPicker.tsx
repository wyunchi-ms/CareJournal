import { Building2, Check, ListFilter, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import type { ChoiceOption } from './ChoicePicker'
import { Modal } from './Modal'

interface RecordFilterPickerProps {
  typeOptions: ChoiceOption[]
  hospitalOptions: ChoiceOption[]
  selectedTypes: string[]
  selectedHospitals: string[]
  onTypesChange: (values: string[]) => void
  onHospitalsChange: (values: string[]) => void
}

export function RecordFilterPicker({
  typeOptions,
  hospitalOptions,
  selectedTypes,
  selectedHospitals,
  onTypesChange,
  onHospitalsChange,
}: RecordFilterPickerProps) {
  const [open, setOpen] = useState(false)
  const [activeGroup, setActiveGroup] = useState<'type' | 'hospital'>('type')
  const selectedCount = selectedTypes.length + selectedHospitals.length
  const options = activeGroup === 'type' ? typeOptions : hospitalOptions
  const selectedValues = activeGroup === 'type' ? selectedTypes : selectedHospitals
  const setSelectedValues = activeGroup === 'type' ? onTypesChange : onHospitalsChange
  const activeLabel = activeGroup === 'type' ? '检查类型' : '医院'

  function toggle(value: string) {
    setSelectedValues(selectedValues.includes(value)
      ? selectedValues.filter((item) => item !== value)
      : [...selectedValues, value])
  }

  function clearAll() {
    onTypesChange([])
    onHospitalsChange([])
  }

  return <div className="record-filter-picker">
    <button
      type="button"
      className={`choice-picker-trigger record-filter-trigger${selectedCount ? ' has-value' : ''}`}
      onClick={() => setOpen(true)}
      aria-haspopup="dialog"
      aria-label={`筛选检查记录：${selectedCount ? `已选 ${selectedCount} 个条件` : '全部记录'}`}
      title="筛选检查记录"
    >
      <ListFilter aria-hidden="true" />
      {selectedCount > 0 && <span className="record-filter-count" aria-hidden="true">{selectedCount}</span>}
    </button>
    {open && <Modal title="筛选检查记录" onClose={() => setOpen(false)} bodyClassName="record-filter-modal-body">
      <div className="record-filter-dialog">
        <div className="record-filter-tabs" role="tablist" aria-label="筛选维度">
          <button type="button" role="tab" aria-selected={activeGroup === 'type'} className={activeGroup === 'type' ? 'active' : ''} onClick={() => setActiveGroup('type')}>
            <ListFilter aria-hidden="true" /><span>检查类型</span>{selectedTypes.length > 0 && <small>{selectedTypes.length}</small>}
          </button>
          <button type="button" role="tab" aria-selected={activeGroup === 'hospital'} className={activeGroup === 'hospital' ? 'active' : ''} onClick={() => setActiveGroup('hospital')}>
            <Building2 aria-hidden="true" /><span>医院</span>{selectedHospitals.length > 0 && <small>{selectedHospitals.length}</small>}
          </button>
        </div>
        <div className="record-filter-scroll">
          <div className="choice-option-list" role="group" aria-label={activeLabel}>
            {options.length === 0 && <p className="choice-empty">{activeGroup === 'type' ? '暂无检查类型' : '暂无医院记录'}</p>}
            {options.map((option) => {
              const checked = selectedValues.includes(option.value)
              return <button key={option.value} type="button" role="checkbox" aria-checked={checked} className={`choice-option${checked ? ' selected' : ''}`} onClick={() => toggle(option.value)}>
                <span className="choice-check" aria-hidden="true">{checked && <Check />}</span>
                <span className="choice-option-copy"><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
              </button>
            })}
          </div>
        </div>
        <div className="record-filter-footer">
          <button type="button" className="text-button" disabled={selectedCount === 0} onClick={clearAll}><RotateCcw />清除全部</button>
          <span>{selectedCount ? `已选 ${selectedCount} 个条件` : '全部记录'}</span>
          <button type="button" className="button primary" onClick={() => setOpen(false)}>完成</button>
        </div>
      </div>
    </Modal>}
  </div>
}
