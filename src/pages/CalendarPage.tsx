import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, parseISO, startOfMonth, startOfWeek, subMonths } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { CalendarDays, ChevronLeft, ChevronRight, Filter, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Modal } from '../components/Modal'
import { PageHeader } from '../components/PageHeader'
import { useApp } from '../store/AppContext'
import { EVENT_TYPES, newId, type EventType, type TreatmentEvent } from '../types'

const todayString = () => format(new Date(), 'yyyy-MM-dd')

function EventForm({ initialDate, event, onClose }: { initialDate: string; event?: TreatmentEvent; onClose: () => void }) {
  const { saveEvent, deleteEvent } = useApp()
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

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) return setError('请输入事件标题')
    if (form.endDate < form.startDate) return setError('结束日期不能早于开始日期')
    const now = new Date().toISOString()
    await saveEvent({
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
      notes: form.notes.trim() || undefined,
      tags: event?.tags ?? [],
      linkedRecordIds: event?.linkedRecordIds ?? [],
      createdAt: event?.createdAt ?? now,
      updatedAt: now,
    })
    onClose()
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      <label>事件类型<select value={form.type} onChange={(e) => set('type', e.target.value as EventType)}>{Object.entries(EVENT_TYPES).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
      <label>标题<input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="例如：第 3 周期化疗" autoFocus /></label>
      <label>开始日期<input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} /></label>
      <label>结束日期<input type="date" value={form.endDate} min={form.startDate} onChange={(e) => set('endDate', e.target.value)} /></label>
      <label>医院<input value={form.hospital} onChange={(e) => set('hospital', e.target.value)} /></label>
      <label>科室<input value={form.department} onChange={(e) => set('department', e.target.value)} /></label>
      {(form.type === 'chemotherapy' || form.type === 'radiotherapy' || form.type === 'targeted' || form.type === 'immunotherapy') && <>
        <label>治疗方案<input value={form.regimen} onChange={(e) => set('regimen', e.target.value)} placeholder="方案名称" /></label>
        <label>药物与剂量<input value={form.medications} onChange={(e) => set('medications', e.target.value)} placeholder="药物名称" /></label>
        <label>剂量备注<input value={form.dosage} onChange={(e) => set('dosage', e.target.value)} placeholder="如 100 mg/m²" /></label>
      </>}
      {form.type === 'chemotherapy' && <>
        <label>周期编号<input type="number" min="1" value={form.cycleNumber} onChange={(e) => set('cycleNumber', e.target.value)} /></label>
        <label>Day 1<input type="date" value={form.cycleDayOne} onChange={(e) => set('cycleDayOne', e.target.value)} /></label>
      </>}
      <label className="full-width">备注<textarea rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></label>
      {error && <p className="form-error full-width" role="alert">{error}</p>}
      <div className="form-actions full-width">
        {event && <button type="button" className="button danger ghost" onClick={async () => { if (confirm('确定删除这个事件？')) { await deleteEvent(event.id); onClose() } }}><Trash2 />删除</button>}
        <span className="spacer" />
        <button type="button" className="button secondary" onClick={onClose}>取消</button>
        <button className="button primary" type="submit">保存事件</button>
      </div>
    </form>
  )
}

export function CalendarPage() {
  const { events } = useApp()
  const [month, setMonth] = useState(startOfMonth(new Date()))
  const [selectedDate, setSelectedDate] = useState(todayString())
  const [filter, setFilter] = useState<EventType | 'all'>('all')
  const [editing, setEditing] = useState<TreatmentEvent | null | 'new'>(null)
  const days = useMemo(() => eachDayOfInterval({ start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }) }), [month])
  const visibleEvents = filter === 'all' ? events : events.filter((event) => event.type === filter)
  const eventsForDay = (day: Date) => visibleEvents.filter((event) => day >= parseISO(event.startDate) && day <= parseISO(event.endDate))
  const selectedEvents = eventsForDay(parseISO(selectedDate))

  return (
    <>
      <PageHeader eyebrow="治疗时间轴" title="病程日历" description="按日期记录治疗、住院与检查，跨日事件会连续显示。" actions={<button className="button primary" onClick={() => setEditing('new')}><Plus />新建事件</button>} />
      <section className="toolbar card compact">
        <div className="month-switcher"><button className="icon-button" aria-label="上个月" onClick={() => setMonth(subMonths(month, 1))}><ChevronLeft /></button><strong>{format(month, 'yyyy年 M月', { locale: zhCN })}</strong><button className="icon-button" aria-label="下个月" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight /></button><button className="text-button" onClick={() => setMonth(startOfMonth(new Date()))}>今天</button></div>
        <label className="inline-control"><Filter /><span>筛选</span><select value={filter} onChange={(e) => setFilter(e.target.value as EventType | 'all')}><option value="all">全部事件</option>{Object.entries(EVENT_TYPES).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
      </section>
      <div className="calendar-layout">
        <section className="calendar-card card" aria-label="月历">
          <div className="weekday-row">{['一', '二', '三', '四', '五', '六', '日'].map((day) => <span key={day}>周{day}</span>)}</div>
          <div className="month-grid">
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
        <aside className="agenda card">
          <div className="section-heading"><div><p className="eyebrow">{format(parseISO(selectedDate), 'EEEE', { locale: zhCN })}</p><h2>{format(parseISO(selectedDate), 'M月d日')}</h2></div><button className="icon-button" aria-label="在当天添加事件" onClick={() => setEditing('new')}><Plus /></button></div>
          <div className="agenda-list">
            {selectedEvents.length === 0 && <div className="empty-inline"><CalendarDaysIcon />这一天还没有记录</div>}
            {selectedEvents.map((event) => <button className="agenda-item" key={event.id} onClick={() => setEditing(event)} style={{ '--event-color': EVENT_TYPES[event.type].color } as React.CSSProperties}><span className="agenda-marker" /><span><strong>{event.title}</strong><small>{EVENT_TYPES[event.type].label}{event.startDate !== event.endDate ? ` · ${event.startDate} 至 ${event.endDate}` : ''}</small>{event.regimen && <small>{event.regimen}</small>}</span></button>)}
          </div>
        </aside>
      </div>
      {editing && <Modal title={editing === 'new' ? '新建病程事件' : '编辑病程事件'} onClose={() => setEditing(null)} wide><EventForm initialDate={selectedDate} event={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} /></Modal>}
    </>
  )
}

function CalendarDaysIcon() { return <span className="empty-icon" aria-hidden="true"><CalendarDays /></span> }
