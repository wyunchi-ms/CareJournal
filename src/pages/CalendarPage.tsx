import { addDays, addMonths, differenceInCalendarDays, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, parseISO, startOfMonth, startOfWeek, subMonths } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { CalendarDays, ChevronLeft, ChevronRight, Filter, Plus, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState, type MouseEvent, type TouchEvent } from 'react'
import { ChoicePicker, type ChoiceOption } from '../components/ChoicePicker'
import { HistoryCombobox } from '../components/HistoryCombobox'
import { Modal } from '../components/Modal'
import { buildChemotherapyCourseEvents, getChemotherapyTemplateDayPlans, rescheduleChemotherapyEvents, type ChemotherapyRescheduleScope } from '../services/chemotherapy'
import { useApp } from '../store/AppContext'
import { EVENT_TYPES, TREATMENT_PLAN_TYPES, newId, type EventType, type TreatmentEvent, type TreatmentPlanType } from '../types'

const todayString = () => format(new Date(), 'yyyy-MM-dd')

const eventTypeOptions: ChoiceOption[] = Object.entries(EVENT_TYPES).map(([value, type]) => ({ value, label: type.label, color: type.color }))
const treatmentPlanTypesByEvent: Partial<Record<EventType, TreatmentPlanType[]>> = {
  chemotherapy: ['chemotherapy'],
  radiotherapy: ['radiotherapy'],
  targeted: ['targeted'],
  immunotherapy: ['immunotherapy'],
  medication: ['maintenance', 'supportive'],
}
type MonthTransition = 'next' | 'previous'

function EventForm({ initialDate, event, hospitalHistory, departmentHistory, onClose }: { initialDate: string; event?: TreatmentEvent; hospitalHistory: string[]; departmentHistory: string[]; onClose: () => void }) {
  const { events, chemotherapyTemplates: treatmentTemplates = [], saveEvent, saveEvents, deleteEvent } = useApp()
  const chemotherapyTemplates = treatmentTemplates.filter((template) => (template.templateType ?? 'chemotherapy') === 'chemotherapy')
  const [creationMode, setCreationMode] = useState<'single' | 'template'>(() => !event && chemotherapyTemplates.length ? 'template' : 'single')
  const [selectedTemplateId, setSelectedTemplateId] = useState(chemotherapyTemplates[0]?.id ?? '')
  const [templateSchedule, setTemplateSchedule] = useState(() => ({
    firstDayOne: initialDate,
    firstCycleNumber: '1',
    cycleCount: String(chemotherapyTemplates[0]?.defaultCycleCount ?? 6),
  }))
  const [rescheduleScope, setRescheduleScope] = useState<ChemotherapyRescheduleScope>('single')
  const [form, setForm] = useState(() => ({
    type: event?.type ?? 'chemotherapy' as EventType,
    title: event?.title ?? '',
    startDate: event?.startDate ?? initialDate,
    endDate: event?.endDate ?? initialDate,
    hospital: event?.hospital ?? '',
    department: event?.department ?? '',
    regimen: event?.regimen ?? '',
    medications: event?.medications ?? '',
    dosage: event?.dosage ?? '',
    cycleNumber: event?.cycleNumber?.toString() ?? '',
    cycleDayOne: event?.cycleDayOne ?? initialDate,
    notes: event?.notes ?? '',
  }))
  const [error, setError] = useState('')
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }))
  const selectedTemplate = chemotherapyTemplates.find((template) => template.id === selectedTemplateId)
  const selectedTemplateDayPlans = selectedTemplate ? getChemotherapyTemplateDayPlans(selectedTemplate) : []
  const isTemplateCreation = !event && form.type === 'chemotherapy' && creationMode === 'template'
  const dateDelta = event ? differenceInCalendarDays(parseISO(form.startDate), parseISO(event.startDate)) : 0
  const compatiblePlanTypes = treatmentPlanTypesByEvent[form.type] ?? []
  const compatibleTemplates = treatmentTemplates.filter((template) => compatiblePlanTypes.includes(template.templateType ?? 'chemotherapy'))
  const regimenOptions = compatibleTemplates.map((template) => template.regimen?.trim() || template.name)
  const regimenDescriptions = Object.fromEntries(compatibleTemplates.map((template) => {
    const templateType = TREATMENT_PLAN_TYPES[template.templateType ?? 'chemotherapy']
    const value = template.regimen?.trim() || template.name
    const templateName = template.regimen?.trim() && template.regimen.trim() !== template.name ? `${template.name} · ` : ''
    return [value, `${templateName}${templateType.label} · ${template.cycleLengthDays} 天一周期`]
  }))
  const isTreatmentEvent = compatiblePlanTypes.length > 0

  function selectTemplate(id: string) {
    setSelectedTemplateId(id)
    const template = chemotherapyTemplates.find((item) => item.id === id)
    if (template) setTemplateSchedule((current) => ({ ...current, cycleCount: String(template.defaultCycleCount) }))
  }

  function shiftEvent(days: number) {
    setForm((current) => ({
      ...current,
      startDate: format(addDays(parseISO(current.startDate), days), 'yyyy-MM-dd'),
      endDate: format(addDays(parseISO(current.endDate), days), 'yyyy-MM-dd'),
    }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (isTemplateCreation) {
      if (!selectedTemplate) return setError('请选择化疗模板')
      const cycleCount = Number(templateSchedule.cycleCount)
      const firstCycleNumber = Number(templateSchedule.firstCycleNumber)
      if (!Number.isInteger(cycleCount) || cycleCount < 1) return setError('周期数必须是大于 0 的整数')
      if (!Number.isInteger(firstCycleNumber) || firstCycleNumber < 1) return setError('起始周期编号必须是大于 0 的整数')
      await saveEvents(buildChemotherapyCourseEvents(selectedTemplate, {
        firstDayOne: templateSchedule.firstDayOne,
        cycleCount,
        firstCycleNumber,
      }))
      onClose()
      return
    }
    if (!form.title.trim()) return setError('请输入事件标题')
    if (form.endDate < form.startDate) return setError('结束日期不能早于开始日期')
    const now = new Date().toISOString()
    const updatedEvent: TreatmentEvent = {
      id: event?.id ?? newId(),
      type: form.type,
      title: form.title.trim(),
      startDate: form.startDate,
      endDate: form.endDate,
      allDay: true,
      hospital: form.hospital.trim() || undefined,
      department: form.department.trim() || undefined,
      regimen: form.regimen.trim() || undefined,
      medications: form.medications.trim() || undefined,
      dosage: form.dosage.trim() || undefined,
      cycleNumber: form.cycleNumber ? Number(form.cycleNumber) : undefined,
      cycleDayOne: form.type === 'chemotherapy' ? form.cycleDayOne : undefined,
      chemotherapyTemplateId: form.type === 'chemotherapy' ? event?.chemotherapyTemplateId : undefined,
      chemotherapyCourseId: form.type === 'chemotherapy' ? event?.chemotherapyCourseId : undefined,
      chemotherapyCycleId: form.type === 'chemotherapy' ? event?.chemotherapyCycleId : undefined,
      administrationDay: form.type === 'chemotherapy' ? event?.administrationDay : undefined,
      plannedStartDate: form.type === 'chemotherapy' ? event?.plannedStartDate : undefined,
      notes: form.notes.trim() || undefined,
      tags: event?.tags ?? [],
      linkedRecordIds: event?.linkedRecordIds ?? [],
      createdAt: event?.createdAt ?? now,
      updatedAt: now,
    }
    if (event?.chemotherapyCourseId && form.type === 'chemotherapy') {
      await saveEvents(rescheduleChemotherapyEvents(events, event, updatedEvent, rescheduleScope))
    } else {
      await saveEvent(updatedEvent)
    }
    onClose()
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      <ChoicePicker label="事件类型" options={eventTypeOptions} value={form.type} onChange={(value) => set('type', value as EventType)} />
      {!event && form.type === 'chemotherapy' && chemotherapyTemplates.length > 0 && <ChoicePicker label="创建方式" options={[{ value: 'template', label: '按模板创建', description: '一次生成多个周期和给药日' }, { value: 'single', label: '单次记录', description: '只创建一个事件' }]} value={creationMode} onChange={(value) => setCreationMode(value as 'single' | 'template')} />}
      {isTemplateCreation ? <>
        <div className="full-width template-course-builder">
          <ChoicePicker label="化疗模板" options={chemotherapyTemplates.map((template) => ({ value: template.id, label: template.name, description: `${template.cycleLengthDays} 天 · ${getChemotherapyTemplateDayPlans(template).map((plan) => `D${plan.day}`).join('、')}` }))} value={selectedTemplateId} onChange={(value) => selectTemplate(value as string)} />
        </div>
        <label>首周期 Day 1<input type="date" value={templateSchedule.firstDayOne} onChange={(e) => setTemplateSchedule((current) => ({ ...current, firstDayOne: e.target.value }))} /></label>
        <label>起始周期编号<input type="number" min="1" value={templateSchedule.firstCycleNumber} onChange={(e) => setTemplateSchedule((current) => ({ ...current, firstCycleNumber: e.target.value }))} /></label>
        <label>创建周期数<input type="number" min="1" value={templateSchedule.cycleCount} onChange={(e) => setTemplateSchedule((current) => ({ ...current, cycleCount: e.target.value }))} /></label>
        {selectedTemplate && <div className="schedule-preview full-width">
          <strong>将创建 {selectedTemplateDayPlans.length * Math.max(0, Number(templateSchedule.cycleCount) || 0)} 个给药事件</strong>
          <span>每 {selectedTemplate.cycleLengthDays} 天一周期 · {selectedTemplateDayPlans.map((plan) => `D${plan.day}`).join('、')}</span>
          <small>这是初始计划。生成后可把某次给药单独提前或推后，也可顺延同周期后续或后续所有周期。</small>
        </div>}
      </> : <>
        <label>标题<input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="例如：第 3 周期化疗" autoFocus /></label>
        <label>开始日期<input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} /></label>
        <label>结束日期<input type="date" value={form.endDate} min={form.startDate} onChange={(e) => set('endDate', e.target.value)} /></label>
        {event?.chemotherapyCourseId && <div className="schedule-adjustment full-width">
          <div className="schedule-adjustment-copy"><strong>{dateDelta === 0 ? '调整实际给药日期' : dateDelta > 0 ? `较原日期推后 ${dateDelta} 天` : `较原日期提前 ${Math.abs(dateDelta)} 天`}</strong><span>计划日期：{event.plannedStartDate || event.startDate}</span></div>
          <div className="schedule-delay-buttons" aria-label="快速调整日期">{[1, 3, 7].map((days) => <button type="button" className="button secondary" key={days} onClick={() => shiftEvent(days)}>+{days} 天</button>)}</div>
          <ChoicePicker label="日期变化范围" options={[
            { value: 'single', label: '仅本次给药', description: '不改变同周期其他给药日' },
            { value: 'cycle', label: '本周期从本次起', description: '同周期本次及之后的给药日一起移动' },
            { value: 'future', label: '本次及后续周期', description: '后续计划整体按相同天数顺延' },
          ]} value={rescheduleScope} onChange={(value) => setRescheduleScope(value as ChemotherapyRescheduleScope)} />
        </div>}
        <HistoryCombobox label="医院" value={form.hospital} onChange={(value) => set('hospital', value)} options={hospitalHistory} placeholder="输入或选择历史医院" />
        <HistoryCombobox label="科室" value={form.department} onChange={(value) => set('department', value)} options={departmentHistory} placeholder="输入或选择历史科室" />
        {isTreatmentEvent && <>
          <HistoryCombobox
            label="治疗方案"
            value={form.regimen}
            onChange={(value) => set('regimen', value)}
            options={regimenOptions}
            placeholder={regimenOptions.length ? '输入或选择方案模板' : '输入方案名称'}
            suggestionsHeading="方案模板"
            suggestionsLabel="治疗方案模板"
            optionDescriptions={regimenDescriptions}
          />
          <label>药物与剂量<input value={form.medications} onChange={(e) => set('medications', e.target.value)} placeholder="药物名称" /></label>
          <label>剂量备注<input value={form.dosage} onChange={(e) => set('dosage', e.target.value)} placeholder="如 100 mg/m²" /></label>
        </>}
        {form.type === 'chemotherapy' && <>
          <label>周期编号<input type="number" min="1" value={form.cycleNumber} onChange={(e) => set('cycleNumber', e.target.value)} /></label>
          <label>{event?.chemotherapyCourseId ? '周期 Day 1（自动）' : 'Day 1'}<input type="date" value={form.cycleDayOne} readOnly={Boolean(event?.chemotherapyCourseId)} onChange={(e) => set('cycleDayOne', e.target.value)} /></label>
        </>}
        <label className="full-width">备注<textarea rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></label>
      </>}
      {error && <p className="form-error full-width" role="alert">{error}</p>}
      <div className="form-actions full-width">
        {event && <button type="button" className="button danger ghost" onClick={async () => { if (confirm('确定删除这个事件？')) { await deleteEvent(event.id); onClose() } }}><Trash2 />删除</button>}
        <span className="spacer" />
        <button type="button" className="button secondary" onClick={onClose}>取消</button>
        <button className="button primary" type="submit">{isTemplateCreation ? '创建周期事件' : '保存事件'}</button>
      </div>
    </form>
  )
}

export function CalendarPage() {
  const { events, vocabulary } = useApp()
  const [month, setMonth] = useState(startOfMonth(new Date()))
  const [selectedDate, setSelectedDate] = useState(todayString())
  const [filters, setFilters] = useState<EventType[]>([])
  const [editing, setEditing] = useState<TreatmentEvent | null | 'new'>(null)
  const [monthTransition, setMonthTransition] = useState<MonthTransition | null>(null)
  const swipeStart = useRef<{ x: number; y: number } | null>(null)
  const lastSwipeAt = useRef(0)
  const days = useMemo(() => eachDayOfInterval({ start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }) }), [month])
  const eventFilterOptions = useMemo<ChoiceOption[]>(() => {
    const counts = events.reduce<Record<string, number>>((result, event) => {
      result[event.type] = (result[event.type] ?? 0) + 1
      return result
    }, {})
    return eventTypeOptions.map((option) => ({ ...option, count: counts[option.value] ?? 0 }))
  }, [events])
  const visibleEvents = filters.length === 0 ? events : events.filter((event) => filters.includes(event.type))
  const eventsForDay = (day: Date) => visibleEvents.filter((event) => day >= parseISO(event.startDate) && day <= parseISO(event.endDate))
  const selectedEvents = eventsForDay(parseISO(selectedDate))
  const monthKey = format(month, 'yyyy-MM')
  const transitionClass = monthTransition ? ` calendar-slide-${monthTransition}` : ''

  function changeMonth(direction: MonthTransition) {
    setMonthTransition(direction)
    setMonth((current) => direction === 'next' ? addMonths(current, 1) : subMonths(current, 1))
  }

  function goToToday() {
    const currentMonth = startOfMonth(new Date())
    if (currentMonth.getTime() === month.getTime()) return
    setMonthTransition(currentMonth > month ? 'next' : 'previous')
    setMonth(currentMonth)
  }

  function handleCalendarTouchStart(event: TouchEvent<HTMLElement>) {
    if (event.touches.length !== 1) {
      swipeStart.current = null
      return
    }
    swipeStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }
  }

  function handleCalendarTouchEnd(event: TouchEvent<HTMLElement>) {
    const start = swipeStart.current
    const touch = event.changedTouches[0]
    swipeStart.current = null
    if (!start || !touch) return

    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (Math.abs(deltaX) < 52 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.25) return

    lastSwipeAt.current = Date.now()
    changeMonth(deltaX < 0 ? 'next' : 'previous')
  }

  function suppressClickAfterSwipe(event: MouseEvent<HTMLElement>) {
    if (Date.now() - lastSwipeAt.current > 450) return
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <>
      <div className="calendar-layout">
        <section
          className="calendar-card card"
          aria-label="月历"
          onTouchStart={handleCalendarTouchStart}
          onTouchEnd={handleCalendarTouchEnd}
          onTouchCancel={() => { swipeStart.current = null }}
          onClickCapture={suppressClickAfterSwipe}
        >
          <div className="calendar-toolbar">
            <div className="month-switcher"><button className="icon-button" aria-label="上个月" onClick={() => changeMonth('previous')}><ChevronLeft /></button><strong key={monthKey} className={`calendar-month-label${transitionClass}`}>{format(month, 'yyyy年M月', { locale: zhCN })}</strong><button className="icon-button" aria-label="下个月" onClick={() => changeMonth('next')}><ChevronRight /></button><button className="text-button calendar-today" onClick={goToToday}>今天</button></div>
            <div className="calendar-toolbar-actions">
              <ChoicePicker compact iconOnly multiple allLabel="全部事件" selectionNoun="类" label="事件筛选" icon={<Filter />} options={eventFilterOptions} value={filters} onChange={(value) => setFilters(value as EventType[])} />
              <button className="icon-button calendar-create-button" aria-label="新建事件" title="新建事件" onClick={() => setEditing('new')}><Plus /></button>
            </div>
          </div>
          <div className="weekday-row">{['一', '二', '三', '四', '五', '六', '日'].map((day) => <span key={day}>周{day}</span>)}</div>
          <div key={monthKey} className={`month-grid${transitionClass}`}>
            {days.map((day) => {
              const dayKey = format(day, 'yyyy-MM-dd')
              const dayEvents = eventsForDay(day)
              return <button key={dayKey} className={`day-cell${!isSameMonth(day, month) ? ' muted' : ''}${isSameDay(day, new Date()) ? ' today' : ''}${dayKey === selectedDate ? ' selected' : ''}`} onClick={() => setSelectedDate(dayKey)}>
                <span className="day-number">{format(day, 'd')}</span>
                <span className="day-events">{dayEvents.slice(0, 3).map((event) => <span key={event.id} className="event-chip" style={{ '--event-color': EVENT_TYPES[event.type].color } as React.CSSProperties}><i />{event.title}</span>)}{dayEvents.length > 3 && <small>另有 {dayEvents.length - 3} 项</small>}</span>
              </button>
            })}
          </div>
        </section>
        <section className="agenda card" aria-label="选中日期的事件">
          <div className="section-heading"><div><p className="eyebrow">{format(parseISO(selectedDate), 'EEEE', { locale: zhCN })}</p><h2>{format(parseISO(selectedDate), 'M月d日')}</h2></div></div>
          <div className="agenda-list">
            {selectedEvents.length === 0 && <div className="empty-inline"><CalendarDaysIcon />这一天还没有记录</div>}
            {selectedEvents.map((event) => <button className="agenda-item" key={event.id} onClick={() => setEditing(event)} style={{ '--event-color': EVENT_TYPES[event.type].color } as React.CSSProperties}><span className="agenda-marker" /><span><strong>{event.title}</strong><small>{EVENT_TYPES[event.type].label}{event.startDate !== event.endDate ? ` · ${event.startDate} 至 ${event.endDate}` : ''}</small>{event.regimen && <small>{event.regimen}</small>}</span></button>)}
          </div>
        </section>
      </div>
      {editing && <Modal title={editing === 'new' ? '新建病程事件' : '编辑病程事件'} onClose={() => setEditing(null)} wide><EventForm initialDate={selectedDate} event={editing === 'new' ? undefined : editing} hospitalHistory={vocabulary.hospitals} departmentHistory={vocabulary.departments} onClose={() => setEditing(null)} /></Modal>}
    </>
  )
}

function CalendarDaysIcon() { return <span className="empty-icon" aria-hidden="true"><CalendarDays /></span> }
