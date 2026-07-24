import { Check, Copy, GripVertical, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { getChemotherapyDayMedications, getChemotherapyTemplateDayPlans } from '../../services/chemotherapy'
import { TREATMENT_PLAN_TYPES, type ChemotherapyTemplate } from '../../types'
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
  const displayedTemplates = reorderMode ? draftTemplates : templates
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
        setDraftTemplates([...templates])
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
      await onReorder(draftTemplates.map((template) => template.id))
      setReorderMode(false)
      finishTemplateDrag()
      setReorderError('')
    } catch (error) {
      setReorderError(error instanceof Error ? error.message : '保存顺序失败，请重试')
    }
  }

  return <>
    <section className="chemotherapy-template-section treatment-template-page">
      <div className="template-page-toolbar">
        <div><h2>{reorderMode ? '调整方案顺序' : '治疗方案'}</h2><p>{reorderMode ? '拖动左侧把手调整；也可用方向键移动。' : '长按任一方案可进入排序模式。'}</p></div>
        {reorderMode
          ? <button type="button" className="button template-reorder-done" onClick={() => void finishReorder()}><Check />完成</button>
          : <button type="button" className="icon-button template-add-button" aria-label="新建治疗方案" title="新建治疗方案" onClick={onCreate}><Plus /></button>}
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
                if (!reorderMode) onOpen(template)
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
                  <button type="button" className="icon-button" aria-label={`复制方案 ${template.name}`} title="复制方案" onClick={() => onDuplicate(template)}><Copy /></button>
                  <button type="button" className="icon-button danger" aria-label={`删除方案 ${template.name}`} title="删除方案" onClick={() => onDelete(template)}><Trash2 /></button>
                </>}
            </div>
          </article>
        })}
        {templates.length === 0 && <button type="button" className="template-empty" onClick={onCreate}><Plus /><span><strong>创建第一个治疗方案</strong><small>选择方案类型，再设置周期和每日安排。</small></span></button>}
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
  </>
}
