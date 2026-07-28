import { Pencil } from 'lucide-react'
import { getChemotherapyDayMedications, getChemotherapyTemplateDayPlans } from '../../services/chemotherapy'
import { TREATMENT_PLAN_TYPES, type ChemotherapyTemplate } from '../../types'
import { getTreatmentPlanType } from './templateUtils'

interface ChemotherapyTemplatePreviewProps {
  template: ChemotherapyTemplate
  onEdit: () => void
}

const medicationDose = (dose?: string, unit?: string) =>
  [dose?.trim(), unit?.trim()].filter(Boolean).join(' ') || '—'

const medicationInstructions = (administration?: string, notes?: string) =>
  [administration?.trim(), notes?.trim()].filter(Boolean).join(' · ') || '—'

export function ChemotherapyTemplatePreview({ template, onEdit }: ChemotherapyTemplatePreviewProps) {
  const planType = TREATMENT_PLAN_TYPES[getTreatmentPlanType(template)]
  const dayPlans = getChemotherapyTemplateDayPlans(template)

  return <div className="template-preview">
    <header className="template-preview-header">
      <div>
        <span className="plan-type-tag" data-plan-type={getTreatmentPlanType(template)}>{planType.label}</span>
        <h3>{template.name}</h3>
        {template.regimen && <p>{template.regimen}</p>}
      </div>
      <dl className="template-preview-facts">
        <div><dt>周期</dt><dd>{template.cycleLengthDays} 天</dd></div>
        <div><dt>{template.templateType === 'radiotherapy' ? '默认疗程' : '默认周期'}</dt><dd>{template.defaultCycleCount} 个</dd></div>
        <div><dt>{planType.usesMedication ? '给药日' : '治疗日'}</dt><dd>{dayPlans.length} 天</dd></div>
      </dl>
    </header>

    {(template.hospital || template.department) && <div className="template-preview-location">
      {template.hospital && <span><small>医院</small><strong>{template.hospital}</strong></span>}
      {template.department && <span><small>科室</small><strong>{template.department}</strong></span>}
    </div>}

    <div className="template-preview-days">
      {dayPlans.map((plan) => {
        const medications = getChemotherapyDayMedications(plan).filter((item) => item.name.trim())
        return <section className="template-preview-day" key={plan.id}>
          <div className="template-preview-day-heading">
            <span>D{plan.day}</span>
            {planType.usesMedication && plan.notes && <p>{plan.notes}</p>}
          </div>

          {planType.usesMedication && <div className="template-preview-table-wrap">
            <table className="template-preview-table" aria-label={`D${plan.day} 用药表`}>
              <thead><tr><th>药物</th><th>剂量</th><th>用法 / 备注</th></tr></thead>
              <tbody>
                {medications.length > 0
                  ? medications.map((item) => <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>{medicationDose(item.dose, item.unit)}</td>
                    <td>{medicationInstructions(item.administration, item.notes)}</td>
                  </tr>)
                  : <tr><td colSpan={3} className="template-preview-empty-cell">未记录用药</td></tr>}
              </tbody>
            </table>
          </div>}

          {template.templateType === 'radiotherapy' && <div className="template-preview-table-wrap">
            <table className="template-preview-table radiotherapy" aria-label={`D${plan.day} 放疗安排表`}>
              <thead><tr><th>放疗部位</th><th>单次剂量</th><th>当日备注</th></tr></thead>
              <tbody><tr>
                <td>{plan.radiotherapySite || '—'}</td>
                <td>{plan.radiotherapyDoseGy ? `${plan.radiotherapyDoseGy} Gy` : '—'}</td>
                <td>{plan.notes || '—'}</td>
              </tr></tbody>
            </table>
          </div>}

          {!planType.usesMedication && template.templateType !== 'radiotherapy' && <div className="template-preview-table-wrap">
            <table className="template-preview-table generic" aria-label={`D${plan.day} 治疗安排表`}>
              <thead><tr><th>当日安排</th></tr></thead>
              <tbody><tr><td>{plan.notes || '未记录安排'}</td></tr></tbody>
            </table>
          </div>}
        </section>
      })}
    </div>

    {template.notes && <section className="template-preview-notes"><h4>方案备注</h4><p>{template.notes}</p></section>}

    <div className="template-preview-actions">
      <button type="button" className="button primary" onClick={onEdit}><Pencil />编辑方案</button>
    </div>
  </div>
}
