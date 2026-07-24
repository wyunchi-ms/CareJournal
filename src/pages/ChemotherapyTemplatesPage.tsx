import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { ChemotherapyTemplateForm } from '../components/chemotherapy-templates/ChemotherapyTemplateForm'
import { ChemotherapyTemplateList } from '../components/chemotherapy-templates/ChemotherapyTemplateList'
import { ChemotherapyTemplatePreview } from '../components/chemotherapy-templates/ChemotherapyTemplatePreview'
import { Modal } from '../components/Modal'
import { getChemotherapyDayMedications, getChemotherapyTemplateDayPlans } from '../services/chemotherapy'
import { useApp } from '../store/AppContext'
import { newId, type ChemotherapyTemplate } from '../types'

export function ChemotherapyTemplatesPage() {
  const {
    chemotherapyTemplates = [],
    saveChemotherapyTemplate,
    reorderChemotherapyTemplates,
    deleteChemotherapyTemplate,
  } = useApp()
  const [selected, setSelected] = useState<ChemotherapyTemplate | 'new' | null>(null)
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  const [deleting, setDeleting] = useState<ChemotherapyTemplate | null>(null)

  async function duplicateTemplate(template: ChemotherapyTemplate) {
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

  async function confirmDelete() {
    if (!deleting) return
    await deleteChemotherapyTemplate(deleting.id)
    setDeleting(null)
  }

  return <>
    <ChemotherapyTemplateList
      templates={chemotherapyTemplates}
      onCreate={() => { setSelected('new'); setMode('edit') }}
      onOpen={(template) => { setSelected(template); setMode('preview') }}
      onDuplicate={(template) => void duplicateTemplate(template)}
      onDelete={setDeleting}
      onReorder={reorderChemotherapyTemplates}
    />
    {selected && <Modal title={selected === 'new' ? '新建治疗方案' : mode === 'preview' ? '治疗方案预览' : '编辑治疗方案'} onClose={() => setSelected(null)} wide>
      {selected !== 'new' && mode === 'preview'
        ? <ChemotherapyTemplatePreview template={selected} onEdit={() => setMode('edit')} />
        : <ChemotherapyTemplateForm template={selected === 'new' ? undefined : selected} onClose={() => setSelected(null)} />}
    </Modal>}
    {deleting && <Modal title="确认删除治疗方案" onClose={() => setDeleting(null)}>
      <div className="delete-dialog-warning">
        <span className="delete-dialog-icon"><TriangleAlert /></span>
        <div>
          <h3>确定删除“{deleting.name}”？</h3>
          <p>此操作不可撤销。已用方案生成的病程事件会保留，但之后不能再用这个方案创建新计划。</p>
        </div>
      </div>
      <div className="form-actions">
        <span className="spacer" />
        <button type="button" className="button secondary" onClick={() => setDeleting(null)}>取消</button>
        <button type="button" className="button confirm-delete" onClick={() => void confirmDelete()}>确认删除</button>
      </div>
    </Modal>}
  </>
}
