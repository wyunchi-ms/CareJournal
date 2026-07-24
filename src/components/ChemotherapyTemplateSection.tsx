import { Check, ChevronDown, ChevronUp, Copy, GripVertical, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { getChemotherapyDayMedications, getChemotherapyTemplateDayPlans, summarizeChemotherapyMedications } from '../services/chemotherapy'
import { useApp } from '../store/AppContext'
import { CHEMOTHERAPY_DOSE_UNITS, TREATMENT_PLAN_TYPES, newId, type ChemotherapyMedication, type ChemotherapyTemplate, type ChemotherapyTemplateDayPlan, type TreatmentPlanType } from '../types'
import { ChoicePicker, type ChoiceOption } from './ChoicePicker'
import { HistoryCombobox } from './HistoryCombobox'
import { Modal } from './Modal'

const chemotherapyDoseUnitOptions: ChoiceOption[] = CHEMOTHERAPY_DOSE_UNITS.map((unit) => ({
  value: unit.value,
  label: unit.value,
  description: unit.label.replace(unit.value, '').replace(/^（|）$/g, ''),
}))

const treatmentPlanTypeOptions: ChoiceOption[] = Object.entries(TREATMENT_PLAN_TYPES).map(([value, type]) => ({
  value,
  label: type.label,
  description: type.description,
  color: type.color,
}))

const getTreatmentPlanType = (template?: ChemotherapyTemplate): TreatmentPlanType => template?.templateType ?? 'chemotherapy'

const blankMedication = (): ChemotherapyMedication => ({
  id: newId(),
  name: '',
  dose: '',
  unit: '',
  administration: '',
  notes: '',
})

const blankDayPlan = (day: number): ChemotherapyTemplateDayPlan => ({
  id: newId(),
  day,
  medicationItems: [blankMedication()],
  notes: '',
})

function editableDayPlans(template?: ChemotherapyTemplate) {
  if (!template) return [blankDayPlan(1)]
  return getChemotherapyTemplateDayPlans(template).map((plan) => ({
    ...plan,
    medicationItems: getChemotherapyDayMedications(plan).length
      ? getChemotherapyDayMedications(plan)
      : [blankMedication()],
  }))
}

function moveTemplate(items: ChemotherapyTemplate[], sourceId: string, targetId: string) {
  const sourceIndex = items.findIndex((item) => item.id === sourceId)
  const targetIndex = items.findIndex((item) => item.id === targetId)
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return items
  const next = [...items]
  const [source] = next.splice(sourceIndex, 1)
  next.splice(targetIndex, 0, source)
  return next
}

function TemplateForm({ template, onClose }: { template?: ChemotherapyTemplate; onClose: () => void }) {
  const { saveChemotherapyTemplate, vocabulary } = useApp()
  const initialDayPlans = editableDayPlans(template)
  const [form, setForm] = useState(() => ({
    templateType: getTreatmentPlanType(template),
    name: template?.name ?? '',
    regimen: template?.regimen ?? '',
    cycleLengthDays: String(template?.cycleLengthDays ?? 21),
    dayCount: String(initialDayPlans.length),
    defaultCycleCount: String(template?.defaultCycleCount ?? 6),
    hospital: template?.hospital ?? '',
    department: template?.department ?? '',
    notes: template?.notes ?? '',
  }))
  const [dayPlans, setDayPlans] = useState<ChemotherapyTemplateDayPlan[]>(initialDayPlans)
  const [expandedDayIds, setExpandedDayIds] = useState<Set<string>>(() => new Set(initialDayPlans[0] ? [initialDayPlans[0].id] : []))
  const [expandedMedicationIds, setExpandedMedicationIds] = useState<Set<string>>(new Set())
  const [copyMessage, setCopyMessage] = useState('')
  const [error, setError] = useState('')
  const set = <Key extends keyof typeof form>(key: Key, value: (typeof form)[Key]) => setForm((current) => ({ ...current, [key]: value }))
  const planType = TREATMENT_PLAN_TYPES[form.templateType]

  function setDayCount(value: string) {
    set('dayCount', value)
    const count = Number(value)
    if (!Number.isInteger(count) || count < 1 || count > 60) return
    setDayPlans((current) => {
      if (count <= current.length) return current.slice(0, count)
      const next = [...current]
      while (next.length < count) next.push(blankDayPlan((next.at(-1)?.day ?? 0) + 1))
      return next
    })
  }

  function updateDayPlan(id: string, changes: Partial<ChemotherapyTemplateDayPlan>) {
    setDayPlans((current) => current.map((plan) => plan.id === id ? { ...plan, ...changes } : plan))
  }

  function updateMedication(planId: string, medicationId: string, changes: Partial<ChemotherapyMedication>) {
    setDayPlans((current) => current.map((plan) => plan.id === planId ? {
      ...plan,
      medicationItems: getChemotherapyDayMedications(plan).map((item) => item.id === medicationId ? { ...item, ...changes } : item),
    } : plan))
  }

  function addMedication(planId: string) {
    const medication = blankMedication()
    setDayPlans((current) => current.map((plan) => plan.id === planId ? {
      ...plan,
      medicationItems: [...getChemotherapyDayMedications(plan), medication],
    } : plan))
    setExpandedMedicationIds((current) => new Set(current).add(medication.id))
  }

  function removeMedication(planId: string, medicationId: string) {
    setDayPlans((current) => current.map((plan) => {
      if (plan.id !== planId) return plan
      const remaining = getChemotherapyDayMedications(plan).filter((item) => item.id !== medicationId)
      return { ...plan, medicationItems: remaining.length ? remaining : [blankMedication()] }
    }))
    setExpandedMedicationIds((current) => {
      const next = new Set(current)
      next.delete(medicationId)
      return next
    })
  }

  function toggleMedicationDetails(medicationId: string) {
    setExpandedMedicationIds((current) => {
      const next = new Set(current)
      if (next.has(medicationId)) next.delete(medicationId)
      else next.add(medicationId)
      return next
    })
  }

  function toggleDay(planId: string) {
    setExpandedDayIds((current) => {
      const next = new Set(current)
      if (next.has(planId)) next.delete(planId)
      else next.add(planId)
      return next
    })
  }

  function copyPreviousDay(index: number) {
    const previous = dayPlans[index - 1]
    const current = dayPlans[index]
    if (!previous || !current) return
    updateDayPlan(current.id, {
      radiotherapySite: previous.radiotherapySite,
      radiotherapyDoseGy: previous.radiotherapyDoseGy,
      medicationItems: getChemotherapyDayMedications(previous).map((item) => ({ ...item, id: newId() })),
      medications: previous.medications,
      dosage: previous.dosage,
      notes: previous.notes,
    })
    setExpandedDayIds((expanded) => new Set(expanded).add(current.id))
    setCopyMessage(`已将 D${previous.day} 的${form.templateType === 'radiotherapy' ? '放疗安排' : planType.usesMedication ? '用药表' : '治疗安排'}复制到 D${current.day}`)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const cycleLengthDays = Number(form.cycleLengthDays)
    const defaultCycleCount = Number(form.defaultCycleCount)
    const dayCount = Number(form.dayCount)
    const administrationDays = dayPlans.map((plan) => plan.day)
    if (!form.name.trim()) return setError('请输入方案名称')
    if (!Number.isInteger(cycleLengthDays) || cycleLengthDays < 1) return setError('周期天数必须是大于 0 的整数')
    if (!Number.isInteger(dayCount) || dayCount < 1 || dayCount > 60 || dayPlans.length !== dayCount) return setError('给药天数必须是 1 到 60 之间的整数')
    if (administrationDays.some((day) => !Number.isInteger(day) || day < 1 || day > cycleLengthDays)) return setError(`周期日必须位于 D1 到 D${cycleLengthDays} 之间`)
    if (new Set(administrationDays).size !== administrationDays.length) return setError('同一个周期日不能重复')
    const emptyMedicationDay = planType.usesMedication
      ? dayPlans.find((plan) => !getChemotherapyDayMedications(plan).some((item) => item.name.trim()))
      : undefined
    if (emptyMedicationDay) return setError(`请至少填写一种 D${emptyMedicationDay.day} 用药`)
    const missingRadiotherapySite = form.templateType === 'radiotherapy' ? dayPlans.find((plan) => !plan.radiotherapySite?.trim()) : undefined
    if (missingRadiotherapySite) return setError(`请填写 D${missingRadiotherapySite.day} 的放疗部位`)
    const invalidRadiotherapyDose = form.templateType === 'radiotherapy'
      ? dayPlans.find((plan) => !plan.radiotherapyDoseGy?.trim() || !Number.isFinite(Number(plan.radiotherapyDoseGy)) || Number(plan.radiotherapyDoseGy) <= 0)
      : undefined
    if (invalidRadiotherapyDose) return setError(`请填写 D${invalidRadiotherapyDose.day} 的有效放疗剂量（Gy）`)
    if (!Number.isInteger(defaultCycleCount) || defaultCycleCount < 1) return setError('默认周期数必须是大于 0 的整数')
    const now = new Date().toISOString()
    const normalizedDayPlans = [...dayPlans]
      .map((plan) => {
        const medicationItems = planType.usesMedication
          ? getChemotherapyDayMedications(plan)
            .filter((item) => item.name.trim())
            .map((item) => ({
              ...item,
              name: item.name.trim(),
              dose: item.dose?.trim() || undefined,
              unit: item.unit?.trim() || undefined,
              administration: item.administration?.trim() || undefined,
              notes: item.notes?.trim() || undefined,
            }))
          : []
        const summary = summarizeChemotherapyMedications(medicationItems)
        return {
          ...plan,
          radiotherapySite: form.templateType === 'radiotherapy' ? plan.radiotherapySite?.trim() || undefined : undefined,
          radiotherapyDoseGy: form.templateType === 'radiotherapy' ? plan.radiotherapyDoseGy?.trim() || undefined : undefined,
          medicationItems,
          medications: summary.medications,
          dosage: summary.dosage || undefined,
          notes: plan.notes?.trim() || undefined,
        }
      })
      .sort((first, second) => first.day - second.day)
    await saveChemotherapyTemplate({
      id: template?.id ?? newId(),
      templateType: form.templateType,
      sortOrder: template?.sortOrder,
      name: form.name.trim(),
      regimen: form.regimen.trim() || undefined,
      medications: undefined,
      dosage: undefined,
      cycleLengthDays,
      administrationDays: normalizedDayPlans.map((plan) => plan.day),
      dayPlans: normalizedDayPlans,
      defaultCycleCount,
      hospital: form.hospital.trim() || undefined,
      department: form.department.trim() || undefined,
      notes: form.notes.trim() || undefined,
      createdAt: template?.createdAt ?? now,
      updatedAt: now,
    })
    onClose()
  }

  return <form className="form-grid chemotherapy-template-form" onSubmit={submit}>
    <div className="full-width"><ChoicePicker label="方案类型" options={treatmentPlanTypeOptions} value={form.templateType} onChange={(value) => set('templateType', value as TreatmentPlanType)} /></div>
    <label className="full-width">方案名称<input value={form.name} onChange={(event) => set('name', event.target.value)} placeholder={`例如：${planType.label}方案`} /></label>
    <label>周期天数<input type="number" min="1" value={form.cycleLengthDays} onChange={(event) => set('cycleLengthDays', event.target.value)} /></label>
    <label>默认{form.templateType === 'radiotherapy' ? '疗程' : '周期'}数<input type="number" min="1" value={form.defaultCycleCount} onChange={(event) => set('defaultCycleCount', event.target.value)} /></label>
    <label>本周期{planType.usesMedication ? '给药' : '治疗'}天数<input type="number" min="1" max="60" aria-label={`本周期${planType.usesMedication ? '给药' : '治疗'}天数`} value={form.dayCount} onChange={(event) => setDayCount(event.target.value)} /><small className="field-hint">连续 3 天会创建 D1、D2、D3，也可以在下方修改周期日。</small></label>
    <label className="full-width">病历方案名称（可选）<input value={form.regimen} onChange={(event) => set('regimen', event.target.value)} placeholder="病历中的正式方案名称" /></label>
    <div className="template-day-plan-section full-width">
      <div className="template-day-plan-heading"><div><strong>{planType.usesMedication ? '每日用药' : '每日安排'}</strong><small>{planType.usesMedication ? '每行一种药；相同日期可复制前一天后再调整。' : '逐日记录治疗内容；相同安排可复制前一天。'}</small></div><span>{dayPlans.length} 天</span></div>
      <div className="template-day-plan-list">
        {dayPlans.map((plan, dayIndex) => {
          const medicationItems = getChemotherapyDayMedications(plan)
          const isExpanded = expandedDayIds.has(plan.id)
          const isRadiotherapy = form.templateType === 'radiotherapy'
          const completedMedicationCount = medicationItems.filter((item) => item.name.trim()).length
          const dayContentId = `template-day-${plan.id}`
          return <section className={`template-day-accordion${isExpanded ? ' expanded' : ''}`} key={plan.id}>
            <div className="template-day-header">
              <button type="button" className="template-day-toggle" aria-expanded={isExpanded} aria-controls={dayContentId} aria-label={`${isExpanded ? '收起' : '展开'} D${plan.day} ${planType.usesMedication ? '每日用药' : '每日安排'}`} onClick={() => toggleDay(plan.id)}>
                <span className="template-day-index">D{plan.day}</span>
                <span className="template-day-summary">{isRadiotherapy
                  ? plan.radiotherapySite?.trim() && plan.radiotherapyDoseGy?.trim()
                    ? `${plan.radiotherapySite.trim()} · ${plan.radiotherapyDoseGy.trim()} Gy`
                    : '尚未填写部位和剂量'
                  : planType.usesMedication
                    ? completedMedicationCount ? `${completedMedicationCount} 种药物` : '尚未填写药物'
                    : plan.notes?.trim() ? plan.notes : '尚未填写安排'}</span>
                {isExpanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
              </button>
              {dayIndex > 0 && <button type="button" className="text-button copy-day-button" aria-label={`从 D${dayPlans[dayIndex - 1].day} 复制安排到 D${plan.day}`} onClick={() => copyPreviousDay(dayIndex)}><Copy />复制前一天</button>}
            </div>
            {isExpanded && <div className="template-day-content" id={dayContentId}>
              <label className="cycle-day-field">周期日<input type="number" min="1" max={form.cycleLengthDays || undefined} aria-label={`D${plan.day} 周期日`} value={plan.day} onChange={(event) => updateDayPlan(plan.id, { day: Number(event.target.value) })} /></label>
              {isRadiotherapy && <div className="radiotherapy-day-fields">
                <label>放疗部位<input aria-label={`D${plan.day} 放疗部位`} value={plan.radiotherapySite ?? ''} onChange={(event) => updateDayPlan(plan.id, { radiotherapySite: event.target.value })} placeholder="例如：左肺原发灶" /></label>
                <label>单次剂量<span className="dose-with-fixed-unit"><input aria-label={`D${plan.day} 放疗剂量`} value={plan.radiotherapyDoseGy ?? ''} onChange={(event) => updateDayPlan(plan.id, { radiotherapyDoseGy: event.target.value })} inputMode="decimal" placeholder="例如 2" /><span aria-hidden="true">Gy</span></span></label>
              </div>}
              {planType.usesMedication && <div className="medication-table" role="table" aria-label={`D${plan.day} 用药表`}>
                <div className="medication-table-header" role="row">
                  <span role="columnheader">药物名称</span><span role="columnheader">剂量 / 单位</span><span role="columnheader">用法/途径</span><span role="columnheader">备注</span><span aria-hidden="true" />
                </div>
                <div className="medication-table-body" role="rowgroup">
                  {medicationItems.map((item, medicationIndex) => <div className={`medication-row${expandedMedicationIds.has(item.id) ? ' expanded' : ''}`} role="row" key={item.id}>
                    <label role="cell"><span className="medication-field-label">药物名称</span><input aria-label={`D${plan.day} 第${medicationIndex + 1}种药物名称`} value={item.name} onChange={(event) => updateMedication(plan.id, item.id, { name: event.target.value })} placeholder="例如：卡铂" /></label>
                    <div className="medication-dose-field" role="cell">
                      <span className="medication-field-label">剂量</span>
                      <input aria-label={`D${plan.day} 第${medicationIndex + 1}种药物剂量`} value={item.dose ?? ''} onChange={(event) => updateMedication(plan.id, item.id, { dose: event.target.value })} inputMode="decimal" placeholder="如 100" />
                      <div className="medication-unit-picker">
                        <ChoicePicker
                          compact
                          label={`D${plan.day} 第${medicationIndex + 1}种药物单位`}
                          value={item.unit ?? ''}
                          onChange={(value) => updateMedication(plan.id, item.id, { unit: String(value) })}
                          options={item.unit && !CHEMOTHERAPY_DOSE_UNITS.some((unit) => unit.value === item.unit)
                            ? [{ value: item.unit, label: item.unit, description: '原记录单位' }, ...chemotherapyDoseUnitOptions]
                            : chemotherapyDoseUnitOptions}
                          placeholder="选择单位"
                          allLabel="清除单位"
                        />
                      </div>
                    </div>
                    <label className="medication-optional-field" role="cell"><span className="medication-field-label">用法/途径</span><input aria-label={`D${plan.day} 第${medicationIndex + 1}种药物用法或给药途径`} value={item.administration ?? ''} onChange={(event) => updateMedication(plan.id, item.id, { administration: event.target.value })} placeholder="静滴、口服等" /></label>
                    <label className="medication-optional-field" role="cell"><span className="medication-field-label">备注</span><input aria-label={`D${plan.day} 第${medicationIndex + 1}种药物备注`} value={item.notes ?? ''} onChange={(event) => updateMedication(plan.id, item.id, { notes: event.target.value })} /></label>
                    <button type="button" className="text-button medication-expand-button" aria-expanded={expandedMedicationIds.has(item.id)} aria-label={`${expandedMedicationIds.has(item.id) ? '收起' : '展开'} D${plan.day} 第${medicationIndex + 1}种药物的用法和备注`} onClick={() => toggleMedicationDetails(item.id)}>{expandedMedicationIds.has(item.id) ? <ChevronUp /> : <ChevronDown />}用法/备注</button>
                    <button type="button" className="icon-button danger medication-remove-button" aria-label={`删除 D${plan.day} 第${medicationIndex + 1}种药物`} title="删除药物" onClick={() => removeMedication(plan.id, item.id)}><Trash2 /></button>
                  </div>)}
                </div>
                <button type="button" className="button secondary medication-add-button" onClick={() => addMedication(plan.id)}><Plus />添加药物</button>
              </div>}
              <label className={`day-notes-field${planType.usesMedication || isRadiotherapy ? '' : ' generic-plan-day-notes'}`}>{planType.usesMedication || isRadiotherapy ? '当日备注' : '当日安排'}<input aria-label={`D${plan.day} ${planType.usesMedication || isRadiotherapy ? '当日备注' : '当日安排'}`} value={plan.notes ?? ''} onChange={(event) => updateDayPlan(plan.id, { notes: event.target.value })} placeholder={planType.usesMedication ? '如预处理、补液或特殊安排' : isRadiotherapy ? '例如：分次、摆位或其他注意事项' : '例如：治疗内容或其他安排'} /></label>
            </div>}
          </section>
        })}
      </div>
      {copyMessage && <p className="copy-day-status" role="status" aria-live="polite">{copyMessage}</p>}
    </div>
    <HistoryCombobox label="医院" value={form.hospital} onChange={(value) => set('hospital', value)} options={vocabulary.hospitals} placeholder="输入或选择历史医院" />
    <HistoryCombobox label="科室" value={form.department} onChange={(value) => set('department', value)} options={vocabulary.departments} placeholder="输入或选择历史科室" />
    <label className="full-width">备注<textarea rows={3} value={form.notes} onChange={(event) => set('notes', event.target.value)} /></label>
    {error && <p className="form-error full-width" role="alert">{error}</p>}
    <div className="form-actions full-width">
      <span className="spacer" />
      <button type="button" className="button secondary" onClick={onClose}>取消</button>
      <button type="submit" className="button primary">保存模板</button>
    </div>
  </form>
}

export function ChemotherapyTemplateSection() {
  const { chemotherapyTemplates = [], saveChemotherapyTemplate, reorderChemotherapyTemplates, deleteChemotherapyTemplate } = useApp()
  const [editing, setEditing] = useState<ChemotherapyTemplate | 'new' | null>(null)
  const [deleting, setDeleting] = useState<ChemotherapyTemplate | null>(null)
  const [reorderMode, setReorderMode] = useState(false)
  const [draftTemplates, setDraftTemplates] = useState<ChemotherapyTemplate[]>([])
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragPreview, setDragPreview] = useState<{
    templateId: string
    top: number
    left: number
    width: number
  } | null>(null)
  const [reorderError, setReorderError] = useState('')
  const longPressRef = useRef<{ timer: number; x: number; y: number } | null>(null)
  const suppressClickRef = useRef(false)
  const draggingIdRef = useRef<string | null>(null)
  const templateListRef = useRef<HTMLDivElement>(null)
  const rowPositionsRef = useRef<Map<string, number>>(new Map())
  const rowAnimationsRef = useRef<Map<string, Animation>>(new Map())
  const dragPreviewElementRef = useRef<HTMLDivElement>(null)
  const dragPointerIdRef = useRef<number | null>(null)
  const dragPointerOffsetYRef = useRef(0)
  const dragPreviewOriginTopRef = useRef(0)
  const dragPreviewHeightRef = useRef(0)
  const dragPreviewOffsetRef = useRef(0)
  const dragPreviewFrameRef = useRef<number | null>(null)
  const displayedTemplates = reorderMode ? draftTemplates : chemotherapyTemplates
  const dragPreviewTemplate = dragPreview
    ? draftTemplates.find((template) => template.id === dragPreview.templateId)
    : undefined
  const dragPreviewDayPlans = dragPreviewTemplate ? getChemotherapyTemplateDayPlans(dragPreviewTemplate) : []
  const dragPreviewType = dragPreviewTemplate ? TREATMENT_PLAN_TYPES[getTreatmentPlanType(dragPreviewTemplate)] : undefined
  const dragPreviewMedicationCount = dragPreviewDayPlans.reduce(
    (count, plan) => count + getChemotherapyDayMedications(plan).filter((item) => item.name.trim()).length,
    0,
  )

  function clearLongPress() {
    if (longPressRef.current) window.clearTimeout(longPressRef.current.timer)
    longPressRef.current = null
  }

  useEffect(() => () => {
    if (longPressRef.current) window.clearTimeout(longPressRef.current.timer)
  }, [])

  const finishTemplateDrag = useCallback(() => {
    if (dragPreviewFrameRef.current !== null) {
      window.cancelAnimationFrame(dragPreviewFrameRef.current)
      dragPreviewFrameRef.current = null
    }
    if (dragPreviewElementRef.current) dragPreviewElementRef.current.style.display = 'none'
    draggingIdRef.current = null
    dragPointerIdRef.current = null
    dragPreviewOffsetRef.current = 0
    setDraggingId(null)
    setDragPreview(null)
  }, [])

  const updateTemplateDrag = useCallback((clientY: number) => {
    const sourceId = draggingIdRef.current
    const templateList = templateListRef.current
    if (!sourceId || !templateList) return
    const listBounds = templateList.getBoundingClientRect()
    const minimumTop = listBounds.top + 2
    const maximumTop = Math.max(minimumTop, listBounds.bottom - dragPreviewHeightRef.current - 2)
    const requestedTop = clientY - dragPointerOffsetYRef.current
    const boundedTop = Math.min(maximumTop, Math.max(minimumTop, requestedTop))
    dragPreviewOffsetRef.current = boundedTop - dragPreviewOriginTopRef.current
    if (dragPreviewFrameRef.current === null) {
      dragPreviewFrameRef.current = window.requestAnimationFrame(() => {
        dragPreviewFrameRef.current = null
        if (dragPreviewElementRef.current) {
          dragPreviewElementRef.current.style.transform = `translate3d(0, ${dragPreviewOffsetRef.current}px, 0)`
        }
      })
    }
    const boundedPointerY = Math.min(listBounds.bottom, Math.max(listBounds.top, clientY))
    const targetIndex = Array.from(templateList.querySelectorAll<HTMLElement>('[data-template-id]'))
      .filter((row) => row.dataset.templateId !== sourceId)
      .reduce((index, row) => {
        const bounds = row.getBoundingClientRect()
        return boundedPointerY > bounds.top + bounds.height / 2 ? index + 1 : index
      }, 0)
    setDraftTemplates((current) => {
      const sourceIndex = current.findIndex((template) => template.id === sourceId)
      if (sourceIndex < 0 || sourceIndex === targetIndex) return current
      const next = [...current]
      const [source] = next.splice(sourceIndex, 1)
      next.splice(Math.min(targetIndex, next.length), 0, source)
      return next
    })
  }, [])

  useEffect(() => {
    const moveFromWindow = (event: PointerEvent) => {
      if (dragPointerIdRef.current === null || event.pointerId !== dragPointerIdRef.current) return
      event.preventDefault()
      updateTemplateDrag(event.clientY)
    }
    const finishFromWindow = (event: PointerEvent) => {
      if (dragPointerIdRef.current === null || event.pointerId !== dragPointerIdRef.current) return
      finishTemplateDrag()
    }
    window.addEventListener('pointermove', moveFromWindow, { capture: true, passive: false })
    window.addEventListener('pointerup', finishFromWindow, true)
    window.addEventListener('pointercancel', finishFromWindow, true)
    return () => {
      window.removeEventListener('pointermove', moveFromWindow, true)
      window.removeEventListener('pointerup', finishFromWindow, true)
      window.removeEventListener('pointercancel', finishFromWindow, true)
    }
  }, [finishTemplateDrag, updateTemplateDrag])

  useLayoutEffect(() => {
    if (!reorderMode || !templateListRef.current) {
      rowAnimationsRef.current.forEach((animation) => animation.cancel())
      rowAnimationsRef.current.clear()
      rowPositionsRef.current.clear()
      return
    }
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const nextPositions = new Map<string, number>()
    templateListRef.current.querySelectorAll<HTMLElement>('[data-template-id]').forEach((row) => {
      const templateId = row.dataset.templateId
      if (!templateId) return
      const activeAnimation = rowAnimationsRef.current.get(templateId)
      const visualTop = row.getBoundingClientRect().top
      activeAnimation?.cancel()
      const layoutTop = row.getBoundingClientRect().top
      const previousTop = rowPositionsRef.current.get(templateId)
      const offset = activeAnimation
        ? visualTop - layoutTop
        : previousTop === undefined ? 0 : previousTop - layoutTop
      if (!reduceMotion && templateId !== draggingId && Math.abs(offset) > 1 && typeof row.animate === 'function') {
        const animation = row.animate(
          [{ transform: `translate3d(0, ${offset}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
          { duration: 190, easing: 'cubic-bezier(.2, .8, .2, 1)' },
        )
        rowAnimationsRef.current.set(templateId, animation)
        const removeCompletedAnimation = () => {
          if (rowAnimationsRef.current.get(templateId) === animation) rowAnimationsRef.current.delete(templateId)
        }
        animation.onfinish = removeCompletedAnimation
        animation.oncancel = removeCompletedAnimation
      }
      nextPositions.set(templateId, layoutTop)
    })
    rowPositionsRef.current = nextPositions
  }, [draftTemplates, draggingId, reorderMode])

  function beginLongPress(event: ReactPointerEvent<HTMLButtonElement>) {
    if (reorderMode || event.button !== 0) return
    clearLongPress()
    longPressRef.current = {
      x: event.clientX,
      y: event.clientY,
      timer: window.setTimeout(() => {
        longPressRef.current = null
        suppressClickRef.current = true
        setDraftTemplates([...chemotherapyTemplates])
        setReorderError('')
        setReorderMode(true)
        navigator.vibrate?.(25)
      }, 500),
    }
  }

  function trackLongPress(event: ReactPointerEvent<HTMLButtonElement>) {
    const pending = longPressRef.current
    if (pending && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 8) clearLongPress()
  }

  function moveDraftTemplate(sourceId: string, targetId: string) {
    setDraftTemplates((current) => moveTemplate(current, sourceId, targetId))
  }

  function beginTemplateDrag(event: ReactPointerEvent<HTMLButtonElement>, templateId: string) {
    event.preventDefault()
    const row = event.currentTarget.closest<HTMLElement>('[data-template-id]')
    if (!row) return
    const bounds = row.getBoundingClientRect()
    draggingIdRef.current = templateId
    dragPointerIdRef.current = event.pointerId
    dragPointerOffsetYRef.current = event.clientY - bounds.top
    dragPreviewOriginTopRef.current = bounds.top
    dragPreviewHeightRef.current = bounds.height
    dragPreviewOffsetRef.current = 0
    setDraggingId(templateId)
    setDragPreview({
      templateId,
      top: bounds.top,
      left: bounds.left,
      width: bounds.width,
    })
    navigator.vibrate?.(12)
  }

  function moveDraftTemplateByOffset(templateId: string, offset: number) {
    const index = draftTemplates.findIndex((template) => template.id === templateId)
    const target = draftTemplates[index + offset]
    if (index >= 0 && target) moveDraftTemplate(templateId, target.id)
  }

  async function finishReorder() {
    try {
      await reorderChemotherapyTemplates(draftTemplates.map((template) => template.id))
      setReorderMode(false)
      finishTemplateDrag()
      setReorderError('')
    } catch (error) {
      setReorderError(error instanceof Error ? error.message : '保存顺序失败，请重试')
    }
  }

  async function duplicate(template: ChemotherapyTemplate) {
    const now = new Date().toISOString()
    const dayPlans = getChemotherapyTemplateDayPlans(template).map((plan) => ({
      ...plan,
      id: newId(),
      medicationItems: getChemotherapyDayMedications(plan).map((item) => ({ ...item, id: newId() })),
    }))
    await saveChemotherapyTemplate({
      ...template,
      id: newId(),
      name: `${template.name} 副本`,
      sortOrder: undefined,
      administrationDays: dayPlans.map((plan) => plan.day),
      dayPlans,
      createdAt: now,
      updatedAt: now,
    })
  }

  return <>
    <section className="chemotherapy-template-section treatment-template-page">
      <div className="template-page-toolbar">
        <div><h2>{reorderMode ? '调整方案顺序' : '治疗方案'}</h2><p>{reorderMode ? '拖动左侧把手调整；也可用方向键移动。' : '长按任一方案可进入排序模式。'}</p></div>
        {reorderMode
          ? <button type="button" className="button template-reorder-done" onClick={() => void finishReorder()}><Check />完成</button>
          : <button type="button" className="icon-button template-add-button" aria-label="新建治疗方案" title="新建治疗方案" onClick={() => setEditing('new')}><Plus /></button>}
      </div>
      {reorderError && <p className="form-error" role="alert">{reorderError}</p>}
      <div ref={templateListRef} className={`template-list${reorderMode ? ' reorder-mode' : ''}`}>
        {displayedTemplates.map((template) => {
          const dayPlans = getChemotherapyTemplateDayPlans(template)
          const templateType = TREATMENT_PLAN_TYPES[getTreatmentPlanType(template)]
          const medicationCount = dayPlans.reduce((count, plan) => count + getChemotherapyDayMedications(plan).filter((item) => item.name.trim()).length, 0)
          return <article className={`template-row${draggingId === template.id ? ' dragging' : ''}`} data-template-id={template.id} key={template.id}>
            <button
              type="button"
              className="template-row-main"
              aria-disabled={reorderMode}
              onPointerDown={beginLongPress}
              onPointerMove={trackLongPress}
              onPointerUp={clearLongPress}
              onPointerCancel={clearLongPress}
              onContextMenu={(event) => { if (!reorderMode) event.preventDefault() }}
              onClick={() => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false
                  return
                }
                if (!reorderMode) setEditing(template)
              }}
            >
              <span className="template-row-heading"><strong>{template.name}</strong><span className="plan-type-tag">{templateType.label}</span></span>
              <small>{template.cycleLengthDays} 天一周期 · {dayPlans.map((plan) => `D${plan.day}`).join('、')} · {templateType.usesMedication ? `共 ${medicationCount} 条用药` : template.templateType === 'radiotherapy' ? `共 ${dayPlans.length} 次放疗` : `共 ${dayPlans.length} 项安排`}</small>
              {template.regimen && <span className="template-row-regimen">{template.regimen}</span>}
            </button>
            <div className="template-row-actions">
              {reorderMode
                ? <button
                    type="button"
                    className="icon-button template-reorder-handle"
                    aria-label={`拖动排序 ${template.name}`}
                    aria-pressed={draggingId === template.id}
                    title="拖动排序"
                    onPointerDown={(event) => beginTemplateDrag(event, template.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowUp') {
                        event.preventDefault()
                        moveDraftTemplateByOffset(template.id, -1)
                      } else if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        moveDraftTemplateByOffset(template.id, 1)
                      }
                    }}
                  ><GripVertical /></button>
                : <>
                  <button type="button" className="icon-button" aria-label={`复制方案 ${template.name}`} title="复制方案" onClick={() => void duplicate(template)}><Copy /></button>
                  <button type="button" className="icon-button danger" aria-label={`删除方案 ${template.name}`} title="删除方案" onClick={() => setDeleting(template)}><Trash2 /></button>
                </>}
            </div>
          </article>
        })}
        {chemotherapyTemplates.length === 0 && <button type="button" className="template-empty" onClick={() => setEditing('new')}><Plus /><span><strong>创建第一个治疗方案</strong><small>选择方案类型，再设置周期和每日安排。</small></span></button>}
      </div>
    </section>
    {dragPreview && dragPreviewTemplate && dragPreviewType && createPortal(
      <div
        ref={dragPreviewElementRef}
        className="template-drag-preview-positioner"
        style={{ top: dragPreview.top, left: dragPreview.left, width: dragPreview.width }}
        aria-hidden="true"
      >
        <div className="template-drag-preview">
          <span className="template-drag-preview-handle"><GripVertical /></span>
          <span className="template-drag-preview-content">
            <span className="template-row-heading"><strong>{dragPreviewTemplate.name}</strong><span className="plan-type-tag">{dragPreviewType.label}</span></span>
            <small>{dragPreviewTemplate.cycleLengthDays} 天一周期 · {dragPreviewDayPlans.map((plan) => `D${plan.day}`).join('、')} · {dragPreviewType.usesMedication ? `共 ${dragPreviewMedicationCount} 条用药` : dragPreviewTemplate.templateType === 'radiotherapy' ? `共 ${dragPreviewDayPlans.length} 次放疗` : `共 ${dragPreviewDayPlans.length} 项安排`}</small>
            {dragPreviewTemplate.regimen && <span className="template-row-regimen">{dragPreviewTemplate.regimen}</span>}
          </span>
        </div>
      </div>,
      document.body,
    )}
    {editing && <Modal title={editing === 'new' ? '新建治疗方案' : '编辑治疗方案'} onClose={() => setEditing(null)} wide><TemplateForm template={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} /></Modal>}
    {deleting && <Modal title="确认删除治疗方案" onClose={() => setDeleting(null)}>
      <div className="delete-dialog-warning"><span className="delete-dialog-icon"><TriangleAlert /></span><div><h3>确定删除“{deleting.name}”？</h3><p>此操作不可撤销。已用方案生成的病程事件会保留，但之后不能再用这个方案创建新计划。</p></div></div>
      <div className="form-actions"><span className="spacer" /><button type="button" className="button secondary" onClick={() => setDeleting(null)}>取消</button><button type="button" className="button confirm-delete" onClick={async () => { await deleteChemotherapyTemplate(deleting.id); setDeleting(null) }}>确认删除</button></div>
    </Modal>}
  </>
}
