import { Check, Copy, GripVertical, ListFilter, Pill, Plus, Search, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { getChemotherapyDayMedications, getChemotherapyTemplateDayPlans } from '../../services/chemotherapy'
import { TREATMENT_PLAN_TYPES, type ChemotherapyTemplate, type TreatmentPlanType } from '../../types'
import { ChoicePicker } from '../ChoicePicker'
import { useSortableDragLift } from '../SortableDragLift'
import { SortableDragOverlay } from '../SortableDragOverlay'
import { SwipeableListItem } from '../SwipeableListItem'
import { getTreatmentPlanType } from './templateUtils'

interface ChemotherapyTemplateListProps {
  templates: ChemotherapyTemplate[]
  onCreate: () => void
  onOpen: (template: ChemotherapyTemplate) => void
  onDuplicate: (template: ChemotherapyTemplate) => void
  onDelete: (template: ChemotherapyTemplate) => void
  onReorder: (orderedIds: string[]) => Promise<void>
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

export function ChemotherapyTemplateList({
  templates,
  onCreate,
  onOpen,
  onDuplicate,
  onDelete,
  onReorder,
}: ChemotherapyTemplateListProps) {
  const [reorderMode, setReorderMode] = useState(false)
  const [draftTemplates, setDraftTemplates] = useState<ChemotherapyTemplate[]>([])
  const [reorderError, setReorderError] = useState('')
  const [selectedTypes, setSelectedTypes] = useState<TreatmentPlanType[]>([])
  const [query, setQuery] = useState('')
  const typeOptions = (Object.keys(TREATMENT_PLAN_TYPES) as TreatmentPlanType[])
    .map((value) => {
      const type = TREATMENT_PLAN_TYPES[value]
      const count = templates.filter((template) => getTreatmentPlanType(template) === value).length
      return {
        value,
        label: type.label,
        description: `${count} 个方案 · ${type.description}`,
        color: type.color,
        count,
      }
    })
    .filter((option) => option.count > 0)
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')
  const filteredTemplates = templates.filter((template) => {
    const templateType = getTreatmentPlanType(template)
    if (selectedTypes.length && !selectedTypes.includes(templateType)) return false
    if (!normalizedQuery) return true
    const dayPlans = getChemotherapyTemplateDayPlans(template)
    const searchableText = [
      template.name,
      template.regimen,
      template.hospital,
      template.department,
      TREATMENT_PLAN_TYPES[templateType].label,
      ...dayPlans.flatMap((plan) => [
        plan.radiotherapySite,
        plan.notes,
        ...getChemotherapyDayMedications(plan).flatMap((medication) => [medication.name, medication.administration, medication.notes]),
      ]),
    ].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN')
    return searchableText.includes(normalizedQuery)
  })
  const displayedTemplates = reorderMode ? draftTemplates : filteredTemplates
  const { beginDrag, draggingId, finishDrag, listRef, positionerRef, preview } = useSortableDragLift({
    enabled: reorderMode,
    layoutKey: draftTemplates.map((template) => template.id).join('\u0000'),
    onDragMove: ({ clientY, sourceId, listElement }) => {
      const listBounds = listElement.getBoundingClientRect()
      const boundedPointerY = Math.min(listBounds.bottom, Math.max(listBounds.top, clientY))
      const targetIndex = Array.from(listElement.querySelectorAll<HTMLElement>('[data-list-item-id]'))
        .filter((row) => row.dataset.listItemId !== sourceId)
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
    },
  })
  const dragPreviewTemplate = preview
    ? draftTemplates.find((template) => template.id === preview.itemId)
    : undefined
  const dragPreviewDayPlans = dragPreviewTemplate ? getChemotherapyTemplateDayPlans(dragPreviewTemplate) : []
  const dragPreviewType = dragPreviewTemplate ? TREATMENT_PLAN_TYPES[getTreatmentPlanType(dragPreviewTemplate)] : undefined
  const dragPreviewMedicationCount = dragPreviewDayPlans.reduce(
    (count, plan) => count + getChemotherapyDayMedications(plan).filter((item) => item.name.trim()).length,
    0,
  )

  function enterReorderMode() {
    if (reorderMode) return
    setDraftTemplates([...templates])
    setReorderError('')
    setReorderMode(true)
  }

  function moveDraftTemplate(sourceId: string, targetId: string) {
    setDraftTemplates((current) => moveTemplate(current, sourceId, targetId))
  }

  function moveDraftTemplateByOffset(templateId: string, offset: number) {
    const index = draftTemplates.findIndex((template) => template.id === templateId)
    const target = draftTemplates[index + offset]
    if (index >= 0 && target) moveDraftTemplate(templateId, target.id)
  }

  async function finishReorder() {
    try {
      await onReorder(draftTemplates.map((template) => template.id))
      setReorderMode(false)
      finishDrag()
      setReorderError('')
    } catch (error) {
      setReorderError(error instanceof Error ? error.message : '保存顺序失败，请重试')
    }
  }

  return <>
    <section className="chemotherapy-template-section treatment-template-page">
      {templates.length > 0 && <div className={`toolbar card compact template-page-toolbar${reorderMode ? ' reorder-mode' : ''}`}>
        {reorderMode
          ? <>
            <div className="template-reorder-copy"><h2>调整方案顺序</h2><p>拖动左侧把手调整；也可用方向键移动。</p></div>
            <button type="button" className="button template-reorder-done" onClick={() => void finishReorder()}><Check />完成</button>
          </>
          : <>
            <label className="search-box">
              <Search />
              <span className="sr-only">搜索治疗方案</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索方案名称或用药" />
            </label>
            <ChoicePicker
              compact
              iconOnly
              label="方案类型"
              icon={<ListFilter />}
              multiple
              allLabel="全部类型"
              selectionNoun="类"
              options={typeOptions}
              value={selectedTypes}
              onChange={(value) => setSelectedTypes(value as TreatmentPlanType[])}
              emptyText="暂无方案类型"
            />
            <button type="button" className="icon-button template-add-button" aria-label="新建治疗方案" title="新建治疗方案" onClick={onCreate}><Plus /></button>
          </>}
      </div>}
      {!reorderMode && selectedTypes.length > 0 && <div className="active-filter-row template-active-filters" aria-label="已选方案类型">
        {selectedTypes.map((type) => <button
          key={type}
          type="button"
          className="filter-chip template-filter-chip"
          data-plan-type={type}
          onClick={() => setSelectedTypes((current) => current.filter((item) => item !== type))}
          aria-label={`移除筛选：${TREATMENT_PLAN_TYPES[type].label}`}
        >
          <span>{TREATMENT_PLAN_TYPES[type].label}</span><X />
        </button>)}
        <button type="button" className="text-button" onClick={() => setSelectedTypes([])}>清除全部</button>
      </div>}
      {reorderError && <p className="form-error" role="alert">{reorderError}</p>}
      <div ref={listRef} className={`template-list${reorderMode ? ' reorder-mode' : ''}`}>
        {displayedTemplates.map((template) => {
          const dayPlans = getChemotherapyTemplateDayPlans(template)
          const templateType = TREATMENT_PLAN_TYPES[getTreatmentPlanType(template)]
          const medicationCount = dayPlans.reduce((count, plan) => count + getChemotherapyDayMedications(plan).filter((item) => item.name.trim()).length, 0)
          return <SwipeableListItem
            itemId={template.id}
            itemDataAttribute="data-template-id"
            as="article"
            label={template.name}
            className={`template-row${draggingId === template.id ? ' sortable-drag-placeholder' : ''}`}
            surfaceClassName="template-row-surface"
            editMode={reorderMode}
            onLongPress={enterReorderMode}
            actions={[
              {
                id: 'copy',
                label: '复制',
                accessibilityLabel: `复制方案 ${template.name}`,
                icon: <Copy />,
                onSelect: () => onDuplicate(template),
              },
              {
                id: 'delete',
                label: '删除',
                accessibilityLabel: `删除方案 ${template.name}`,
                icon: <Trash2 />,
                tone: 'danger',
                onSelect: () => onDelete(template),
              },
            ]}
            key={template.id}
          >
            {reorderMode && <button
              type="button"
              className="icon-button template-reorder-handle"
              data-list-gesture-ignore
              aria-label={`拖动排序 ${template.name}`}
              aria-pressed={draggingId === template.id}
              title="拖动排序"
              onPointerDown={(event) => beginDrag(event, template.id)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  moveDraftTemplateByOffset(template.id, -1)
                } else if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  moveDraftTemplateByOffset(template.id, 1)
                }
              }}
            ><GripVertical /></button>}
            <button
              type="button"
              className="template-row-main"
              aria-disabled={reorderMode}
              onClick={() => { if (!reorderMode) onOpen(template) }}
            >
              <span className="template-row-heading"><strong>{template.name}</strong><span className="plan-type-tag" data-plan-type={getTreatmentPlanType(template)}>{templateType.label}</span></span>
              <small>{template.cycleLengthDays} 天一周期 · {dayPlans.map((plan) => `D${plan.day}`).join('、')} · {templateType.usesMedication ? `共 ${medicationCount} 条用药` : template.templateType === 'radiotherapy' ? `共 ${dayPlans.length} 次放疗` : `共 ${dayPlans.length} 项安排`}</small>
              {template.regimen && <span className="template-row-regimen">{template.regimen}</span>}
            </button>
          </SwipeableListItem>
        })}
        {templates.length === 0 && <div className="empty-state card collection-empty-state template-empty-state">
          <Pill />
          <h3>还没有治疗方案</h3>
          <p>先选择治疗类型，再设置周期和每日安排。</p>
          <button type="button" className="button primary" onClick={onCreate}><Plus />创建第一个治疗方案</button>
        </div>}
        {templates.length > 0 && displayedTemplates.length === 0 && <div className="empty-state card filtered-empty-state">
          <Search />
          <h3>没有符合条件的方案</h3>
          <p>调整搜索词或移除类型筛选后再试。</p>
        </div>}
      </div>
    </section>
    {dragPreviewTemplate && dragPreviewType && <SortableDragOverlay preview={preview} positionerRef={positionerRef}>
      <span className="sortable-drag-preview-handle"><GripVertical /></span>
      <span className="sortable-drag-preview-content">
        <span className="template-row-heading"><strong>{dragPreviewTemplate.name}</strong><span className="plan-type-tag" data-plan-type={getTreatmentPlanType(dragPreviewTemplate)}>{dragPreviewType.label}</span></span>
        <small>{dragPreviewTemplate.cycleLengthDays} 天一周期 · {dragPreviewDayPlans.map((plan) => `D${plan.day}`).join('、')} · {dragPreviewType.usesMedication ? `共 ${dragPreviewMedicationCount} 条用药` : dragPreviewTemplate.templateType === 'radiotherapy' ? `共 ${dragPreviewDayPlans.length} 次放疗` : `共 ${dragPreviewDayPlans.length} 项安排`}</small>
        {dragPreviewTemplate.regimen && <span className="template-row-regimen">{dragPreviewTemplate.regimen}</span>}
      </span>
    </SortableDragOverlay>}
  </>
}
