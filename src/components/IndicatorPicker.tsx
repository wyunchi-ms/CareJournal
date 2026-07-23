import { Check, ChevronDown, GripVertical, Pin, PinOff } from 'lucide-react'
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ChartIndicatorOption } from '../services/chartIndicators'
import { moveChartIndicator } from '../services/chartIndicators'
import { Modal } from './Modal'

interface IndicatorPickerProps {
  options: ChartIndicatorOption[]
  value: string
  pinnedCodes: string[]
  onChange: (code: string) => void
  onPinnedChange: (codes: string[]) => void
  onOrderChange: (order: string[], pinnedOrder: string[]) => void
}

export function IndicatorPicker({ options, value, pinnedCodes, onChange, onPinnedChange, onOrderChange }: IndicatorPickerProps) {
  const [open, setOpen] = useState(false)
  const [draftOrder, setDraftOrder] = useState<string[]>([])
  const [draggingCode, setDraggingCode] = useState<string | null>(null)
  const draftOrderRef = useRef(draftOrder)
  const pinnedSet = useMemo(() => new Set(pinnedCodes), [pinnedCodes])
  const optionByCode = useMemo(() => new Map(options.map((option) => [option.code, option])), [options])
  const selected = optionByCode.get(value)

  const baseOrder = options.map((option) => option.code)
  const visibleOrder = draggingCode ? draftOrder : baseOrder
  const visibleOptions = visibleOrder.map((code) => optionByCode.get(code)).filter((option): option is ChartIndicatorOption => Boolean(option))

  function setOrder(next: string[]) {
    draftOrderRef.current = next
    setDraftOrder(next)
  }

  function persistOrder(next: string[]) {
    setOrder(next)
    onOrderChange(next, next.filter((code) => pinnedSet.has(code)))
  }

  function moveWithinPriority(sourceCode: string, targetCode: string) {
    if (pinnedSet.has(sourceCode) !== pinnedSet.has(targetCode)) return draftOrderRef.current
    return moveChartIndicator(draftOrderRef.current, sourceCode, targetCode)
  }

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, code: string) {
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setOrder(baseOrder)
    setDraggingCode(code)
  }

  function drag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!draggingCode || typeof document.elementFromPoint !== 'function') return
    event.preventDefault()
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-indicator-code]')
    const targetCode = target?.dataset.indicatorCode
    if (!targetCode || targetCode === draggingCode) return
    const next = moveWithinPriority(draggingCode, targetCode)
    if (next !== draftOrderRef.current) setOrder(next)
  }

  function finishDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!draggingCode) return
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId)
    setDraggingCode(null)
    onOrderChange(draftOrderRef.current, draftOrderRef.current.filter((code) => pinnedSet.has(code)))
  }

  function moveByKeyboard(code: string, direction: -1 | 1) {
    draftOrderRef.current = baseOrder
    const group = draftOrderRef.current.filter((candidate) => pinnedSet.has(candidate) === pinnedSet.has(code))
    const index = group.indexOf(code)
    const targetCode = group[index + direction]
    if (!targetCode) return
    persistOrder(moveWithinPriority(code, targetCode))
  }

  function togglePinned(code: string) {
    onPinnedChange(pinnedSet.has(code) ? pinnedCodes.filter((candidate) => candidate !== code) : [...pinnedCodes, code])
  }

  return <div className="indicator-picker">
    <span className="choice-picker-label">检查指标</span>
    <button type="button" className={`choice-picker-trigger${selected ? ' has-value' : ''}`} disabled={!options.length} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={`检查指标：${selected?.name ?? '暂无可用指标'}`}>
      <span className="choice-picker-summary"><strong>{selected?.name ?? '暂无可用指标'}</strong>{selected && <small>{selected.unit || '未记录单位'} · 出现 {selected.count} 次</small>}</span>
      {selected && pinnedSet.has(selected.code) && <Pin className="indicator-trigger-pin" aria-label="已置顶" />}
      <ChevronDown aria-hidden="true" />
    </button>

    {open && <Modal title="检查指标（单选）" onClose={() => setOpen(false)}>
      <p className="indicator-picker-help">常用指标优先，其余按出现次数排列。可拖动手柄调整顺序；置顶指标始终排在最前面。</p>
      <div className="indicator-priority-list" role="radiogroup" aria-label="检查指标">
        {visibleOptions.map((option, index) => {
          const pinned = pinnedSet.has(option.code)
          const previous = visibleOptions[index - 1]
          const showHeading = index === 0 || pinned !== pinnedSet.has(previous.code)
          return <div key={option.code} className="indicator-priority-entry">
            {showHeading && <div className="indicator-priority-heading">{pinned ? '已置顶' : '其他指标'}</div>}
            <div className={`indicator-priority-row${value === option.code ? ' selected' : ''}${draggingCode === option.code ? ' dragging' : ''}`} data-indicator-code={option.code}>
              <button
                type="button"
                className="indicator-drag-handle"
                aria-label={`拖动排序：${option.name}`}
                title="拖动排序；键盘可用上下方向键"
                onPointerDown={(event) => startDrag(event, option.code)}
                onPointerMove={drag}
                onPointerUp={finishDrag}
                onPointerCancel={finishDrag}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                  event.preventDefault()
                  moveByKeyboard(option.code, event.key === 'ArrowUp' ? -1 : 1)
                }}
              ><GripVertical /></button>
              <button type="button" role="radio" aria-checked={value === option.code} className="indicator-select-button" onClick={() => { onChange(option.code); setOpen(false) }}>
                <span className="choice-check radio" aria-hidden="true">{value === option.code && <Check />}</span>
                <span className="indicator-priority-copy"><strong>{option.name}</strong><small>{option.unit || '未记录单位'} · 出现 {option.count} 次</small></span>
              </button>
              <button type="button" className={`indicator-pin-toggle${pinned ? ' active' : ''}`} aria-label={`${pinned ? '取消置顶' : '置顶'}：${option.name}`} title={pinned ? '取消置顶' : '置顶指标'} onClick={() => togglePinned(option.code)}>{pinned ? <PinOff /> : <Pin />}</button>
            </div>
          </div>
        })}
      </div>
    </Modal>}
  </div>
}
