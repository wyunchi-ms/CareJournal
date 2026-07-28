import { ChevronDown, ChevronUp, Copy, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { getChemotherapyDayMedications, summarizeChemotherapyMedications } from '../../services/chemotherapy'
import { useApp } from '../../store/AppContext'
import {
  CHEMOTHERAPY_DOSE_UNITS,
  TREATMENT_PLAN_TYPES,
  newId,
  type ChemotherapyMedication,
  type ChemotherapyTemplate,
  type ChemotherapyTemplateDayPlan,
  type TreatmentPlanType,
} from '../../types'
import { ChoicePicker } from '../ChoicePicker'
import { HistoryCombobox } from '../HistoryCombobox'
import {
  blankDayPlan,
  blankMedication,
  chemotherapyDoseUnitOptions,
  editableDayPlans,
  getTreatmentPlanType,
  treatmentPlanTypeOptions,
} from './templateUtils'

interface ChemotherapyTemplateFormProps {
  template?: ChemotherapyTemplate
  onClose: () => void
}

export function ChemotherapyTemplateForm({ template, onClose }: ChemotherapyTemplateFormProps) {
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
                          historyKey="medication-unit"
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
      <button type="submit" className="button primary">保存模板</button>
    </div>
  </form>
}
