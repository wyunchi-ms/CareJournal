import { ChevronDown, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { INDICATORS } from '../data/indicatorAliases'
import { editedIndicator, type IndicatorDraft } from '../services/indicatorEditing'
import { flagLabel } from '../services/recordDisplay'
import type { LabIndicator } from '../types'
import { ChoicePicker } from './ChoicePicker'

export function RecordIndicatorEditor({ draft, original, onChange, onRemove }: {
  draft: IndicatorDraft
  original?: LabIndicator
  onChange: (changes: Partial<IndicatorDraft>) => void
  onRemove: () => void
}) {
  const [expanded, setExpanded] = useState(!original)
  const name = draft.normalizedName || '未命名指标'
  let status = ''
  try {
    const flag = editedIndicator(draft, original).abnormalFlag
    status = flagLabel(flag) || '无法判断'
  } catch (error) {
    status = error instanceof Error ? error.message : '请检查指标内容'
  }
  return <article className={`indicator-editor${expanded ? ' expanded' : ''}`}>
    <header className="indicator-editor-heading">
      {expanded
        ? <label className="indicator-title-editor"><span className="sr-only">指标名称</span><input aria-label="指标名称" value={draft.normalizedName} onChange={(event) => onChange({ normalizedName: event.target.value })} placeholder="填写指标名称" /></label>
        : <button type="button" className="indicator-editor-summary" aria-label={`编辑指标：${name}`} onClick={() => setExpanded(true)}><strong>{name}</strong><small>{draft.result || '未填写结果'} {draft.unit}</small></button>}
      <button type="button" className="icon-button indicator-editor-toggle" aria-label={`${expanded ? '收起' : '展开'}指标：${name}`} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><ChevronDown /></button>
    </header>
    {expanded && <div className="indicator-editor-body">
      <div className="form-grid indicator-fields">
        <label>结果（数值或文字）<input value={draft.result} onChange={(event) => onChange({ result: event.target.value })} inputMode="decimal" placeholder="4.2 或 阴性" /></label>
        <label>单位<input value={draft.unit} onChange={(event) => onChange({ unit: event.target.value })} placeholder="10^9/L" /></label>
        <label className="full-width">参考范围<input value={draft.referenceText} onChange={(event) => onChange({ referenceText: event.target.value })} placeholder="3.5–9.5、≤5 或 阴性" /></label>
      </div>
      <p className="indicator-derived-status" role="status">范围判断：{status}</p>
      <details className="indicator-editor-advanced">
        <summary>调整图表归类</summary>
        <ChoicePicker label="图表归类" historyKey="standard-indicator" options={[...INDICATORS.map((definition) => ({ value: definition.code, label: definition.name, description: definition.code })), { value: 'OTHER', label: '其他指标' }]} value={INDICATORS.some((definition) => definition.code === draft.normalizedCode) ? draft.normalizedCode : 'OTHER'} onChange={(value) => {
          const definition = INDICATORS.find((candidate) => candidate.code === value)
          onChange(definition
            ? { normalizedCode: definition.code, normalizedName: definition.name, unit: draft.unit || definition.standardUnit || '' }
            : { normalizedCode: 'OTHER' })
        }} />
      </details>
      <button type="button" className="text-button danger" onClick={onRemove} aria-label={`移除指标：${name}`}><Trash2 />移除指标</button>
    </div>}
  </article>
}
