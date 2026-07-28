import { Check, ChevronDown, GripVertical, Pin, PinOff, Search } from 'lucide-react'
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ChartIndicatorOption } from '../services/chartIndicators'
import { moveChartIndicator } from '../services/chartIndicators'
import { Modal } from './Modal'
import { SwipeableListItem } from './SwipeableListItem'

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
  const [query, setQuery] = useState('')
  const [editingOrder, setEditingOrder] = useState(false)
  const [draftOrder, setDraftOrder] = useState<string[]>([])
  const [draggingCode, setDraggingCode] = useState<string | null>(null)
  const draftOrderRef = useRef(draftOrder)
  const pinnedSet = useMemo(() => new Set(pinnedCodes), [pinnedCodes])
  const optionByCode = useMemo(() => new Map(options.map((option) => [option.code, option])), [options])
  const selected = optionByCode.get(value)

  const baseOrder = options.map((option) => option.code)
  const visibleOrder = editingOrder && draftOrder.length ? draftOrder : baseOrder
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')
  const visibleOptions = visibleOrder
    .map((code) => optionByCode.get(code))
    .filter((option): option is ChartIndicatorOption => Boolean(option))
    .filter((option) => !normalizedQuery || `${option.name} ${option.code} ${option.unit}`.toLocaleLowerCase('zh-CN').includes(normalizedQuery))

  function setOrder(next: string[]) {
    draftOrderRef.current = next
    setDraftOrder(next)
  }

  function persistOrder(next: string[]) {
    setOrder(next)
    onOrderChange(next, next.filter((code) => pinnedSet.has(code)))
  }

  function enterOrderEditing() {
    setOrder(baseOrder)
    setEditingOrder(true)
    navigator.vibrate?.(20)
  }

  function closePicker() {
    setOpen(false)
    setQuery('')
    setEditingOrder(false)
    setDraggingCode(null)
  }

  function finishOrderEditing() {
    setEditingOrder(false)
    setDraggingCode(null)
  }

  function selectOption(code: string) {
    if (editingOrder) return
    onChange(code)
    closePicker()
  }

  function moveWithinPriority(sourceCode: string, targetCode: string) {
    if (pinnedSet.has(sourceCode) !== pinnedSet.has(targetCode)) return draftOrderRef.current
    return moveChartIndicator(draftOrderRef.current, sourceCode, targetCode)
  }

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, code: string) {
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
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
    const currentOrder = draftOrderRef.current.length ? draftOrderRef.current : baseOrder
    draftOrderRef.current = currentOrder
    const group = currentOrder.filter((candidate) => pinnedSet.has(candidate) === pinnedSet.has(code))
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
    <button type="button" className={`choice-picker-trigger${selected ? ' has-value' : ''}`} disabled={!options.length} onClick={() => { setQuery(''); setEditingOrder(false); setOpen(true) }} aria-haspopup="dialog" aria-label={`检查指标：${selected?.name ?? '暂无可用指标'}`}>
      <span className="choice-picker-summary"><strong>{selected?.name ?? '暂无可用指标'}</strong>{selected && <small>{selected.unit || '未记录单位'} · 出现 {selected.count} 次</small>}</span>
      {selected && pinnedSet.has(selected.code) && <Pin className="indicator-trigger-pin" aria-label="已置顶" />}
      <ChevronDown aria-hidden="true" />
    </button>

    {open && <Modal title={editingOrder ? '检查指标（排序）' : '检查指标（单选）'} onClose={closePicker}>
      <div className={`indicator-picker-tools${editingOrder ? ' editing' : ''}`}>
        <label className="search-box">
          <Search aria-hidden="true" />
          <span className="sr-only">搜索检查指标</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索指标，长按条目排序" />
        </label>
        {editingOrder && <button type="button" className="button secondary indicator-order-done" onClick={finishOrderEditing}>完成</button>}
      </div>
      <div className="indicator-priority-list" role="radiogroup" aria-label="检查指标">
        {visibleOptions.map((option, index) => {
          const pinned = pinnedSet.has(option.code)
          const previous = visibleOptions[index - 1]
          const showHeading = index === 0 || pinned !== pinnedSet.has(previous.code)
          return <div key={option.code} className="indicator-priority-entry">
            {showHeading && <div className="indicator-priority-heading">{pinned ? '已置顶' : '其他指标'}</div>}
            <SwipeableListItem
              itemId={option.code}
              itemDataAttribute="data-indicator-code"
              label={option.name}
              className={`indicator-priority-row${editingOrder ? ' editing' : ''}${value === option.code ? ' selected' : ''}${draggingCode === option.code ? ' dragging' : ''}`}
              surfaceClassName="indicator-priority-surface"
              editMode={editingOrder}
              onLongPress={enterOrderEditing}
              actions={[{
                id: 'pin',
                label: pinned ? '取消置顶' : '置顶',
                accessibilityLabel: `${pinned ? '取消置顶' : '置顶'}：${option.name}`,
                icon: pinned ? <PinOff /> : <Pin />,
                tone: 'primary',
                onSelect: () => togglePinned(option.code),
              }]}
            >
              {editingOrder && <button
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
              ><GripVertical /></button>}
              <button
                type="button"
                role="radio"
                aria-checked={value === option.code}
                aria-disabled={editingOrder || undefined}
                className="indicator-select-button"
                onClick={() => selectOption(option.code)}
              >
                <span className="choice-check radio" aria-hidden="true">{value === option.code && <Check />}</span>
                <span className="indicator-priority-copy"><strong>{option.name}</strong><small>{option.unit || '未记录单位'} · 出现 {option.count} 次</small></span>
              </button>
            </SwipeableListItem>
          </div>
        })}
        {visibleOptions.length === 0 && <div className="empty-inline"><Search /><strong>没有匹配的指标</strong><p>换个名称、代码或单位试试。</p></div>}
      </div>
    </Modal>}
  </div>
}
