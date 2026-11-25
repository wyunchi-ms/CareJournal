import { ChevronRight, ListTree } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { DetailEditButton, Modal } from '../components/Modal'
import { EventDetails, EventForm } from './CalendarPage'
import { buildTreatmentTimeline } from '../services/treatmentTimeline'
import { useApp } from '../store/AppContext'
import type { AppLanguage, EventType } from '../types'

const copy = {
  'zh-CN': {
    title: '治疗时间线', chemo: '化疗', radiation: '放疗', other: '其他治疗',
    empty: '还没有治疗记录', emptyHint: '在「病程」中添加或查看治疗事件。',
    journal: '查看病程',
    cycle: (n: number, radiation: boolean) => `第 ${n} ${radiation ? '疗程' : '周期'}`,
  },
  'zh-TW': {
    title: '治療時間線', chemo: '化療', radiation: '放療', other: '其他治療',
    empty: '還沒有治療紀錄', emptyHint: '在「病程」中新增或查看治療事件。',
    journal: '查看病程',
    cycle: (n: number, radiation: boolean) => `第 ${n} ${radiation ? '療程' : '週期'}`,
  },
  en: {
    title: 'Treatment timeline', chemo: 'Chemotherapy', radiation: 'Radiotherapy', other: 'Other treatments',
    empty: 'No treatment entries yet', emptyHint: 'Add or view treatment entries in your journal.',
    journal: 'Open journal',
    cycle: (n: number, radiation: boolean) => `${radiation ? 'Course' : 'Cycle'} ${n}`,
  },
}

const stageTypeLabels: Partial<Record<EventType, [string, string, string]>> = {
  surgery: ['手术', '手術', 'Surgery'],
  maintenance: ['维持治疗', '維持治療', 'Maintenance therapy'],
  targeted: ['靶向治疗', '標靶治療', 'Targeted therapy'],
  immunotherapy: ['免疫治疗', '免疫治療', 'Immunotherapy'],
  medication: ['用药', '用藥', 'Medication'],
}
const languageIndex: Record<AppLanguage, number> = { 'zh-CN': 0, 'zh-TW': 1, en: 2 }

export function TreatmentTimelinePage() {
  const { events, preferences, vocabulary } = useApp()
  const [eventId, setEventId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const selectedEvent = events.find((event) => event.id === eventId)
  const closeEvent = () => { setEventId(null); setEditing(false) }
  const language = preferences.locale.language
  const text = copy[language]
  const stages = useMemo(() => buildTreatmentTimeline(events), [events])
  const years = new Map<string, typeof stages>()
  for (const stage of stages) {
    const year = stage.startDate.slice(0, 4)
    const group = years.get(year)
    if (group) group.push(stage)
    else years.set(year, [stage])
  }
  const monthDay = new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const fullDate = new Intl.DateTimeFormat(language, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
  const date = (value: string, formatter: Intl.DateTimeFormat) => {
    const parsed = new Date(`${value}T00:00:00Z`)
    return Number.isNaN(parsed.getTime()) ? value : formatter.format(parsed)
  }
  const range = (start: string, end: string, year: string) => {
    const formatter = start.startsWith(`${year}-`) && (!end || end.startsWith(`${year}-`)) ? monthDay : fullDate
    return !end || start === end ? date(start, formatter) : `${date(start, formatter)} – ${date(end, formatter)}`
  }

  return <section className="treatment-timeline" aria-label={text.title}>
    {stages.length === 0 ? <div className="empty-state card">
      <ListTree aria-hidden="true" /><h2>{text.empty}</h2><p>{text.emptyHint}</p>
      <Link className="button secondary" to="/calendar">{text.journal}</Link>
    </div> : Array.from(years, ([year, group]) => <div className="timeline-year-group" key={year}>
      <h2 className="timeline-year" id={`timeline-year-${year}`}>{language === 'en' ? year : `${year} 年`}</h2>
      <ol className="timeline-list" role="list" aria-labelledby={`timeline-year-${year}`}>
        {group.map((stage) => {
          const type = stage.type === 'chemotherapy' ? text.chemo : stage.type === 'radiotherapy' ? text.radiation
            : stageTypeLabels[stage.type]?.[languageIndex[language]] ?? text.other
          const cycle = stage.cycleNumber == null ? null : text.cycle(stage.cycleNumber, stage.type === 'radiotherapy')
          const grouped = Boolean(stage.events[0].chemotherapyCycleId) || stage.events.length > 1
          const treatment = stage.regimen || (stage.type === 'radiotherapy' ? stage.events[0].radiotherapySite?.trim() : undefined)
          const title = grouped
            ? [cycle, type, treatment && treatment !== type ? treatment : undefined].filter(Boolean).join(' · ')
            : stage.title
          return <li key={stage.id}>
            <details className="timeline-stage" data-treatment-type={stage.type}>
              <summary>
                <span className="timeline-stage-copy">
                  <span className="timeline-date">{range(stage.startDate, stage.endDate, year)}</span>
                  <strong>{title}</strong>
                </span>
                <ChevronRight className="timeline-chevron" aria-hidden="true" />
              </summary>
              <ul className="timeline-events">
                {stage.events.map((event) => <li key={event.id}>
                  <Link to={`/calendar?${new URLSearchParams({
                    month: event.startDate.slice(0, 7), date: event.startDate, eventId: event.id,
                  })}`} onClick={(click) => { if (!click.metaKey && !click.ctrlKey && !click.shiftKey && !click.altKey && click.button === 0) { click.preventDefault(); setEventId(event.id) } }}>
                    <span><strong>{event.title}</strong><small>{range(event.startDate, event.endDate, year)}
                      {event.radiotherapySite && ` · ${event.radiotherapySite}`}
                    </small></span>
                    <ChevronRight aria-hidden="true" />
                  </Link>
                </li>)}
              </ul>
            </details>
          </li>
        })}
      </ol>
    </div>)}
    {selectedEvent && (editing
      ? <Modal key="timeline-event-edit" title="编辑病程事件" onClose={() => setEditing(false)} wide>
        <EventForm initialDate={selectedEvent.startDate} event={selectedEvent} hospitalHistory={vocabulary.hospitals} departmentHistory={vocabulary.departments} onSaved={() => setEditing(false)} onDeleted={closeEvent} />
      </Modal>
      : <Modal key="timeline-event-view" title={selectedEvent.title} onClose={closeEvent} wide hideClose headerAction={<DetailEditButton onClick={() => setEditing(true)} />}>
        <EventDetails event={selectedEvent} />
      </Modal>)}
  </section>
}
