import { addBusinessDays, addDays, formatISO, parseISO } from 'date-fns'
import type { EventType, TreatmentEvent } from '../types'

const treatmentTypes = new Set<EventType>([
  'chemotherapy', 'radiotherapy', 'surgery', 'maintenance', 'targeted', 'immunotherapy', 'medication',
])

export function buildTreatmentTimeline(events: TreatmentEvent[]) {
  const stages = new Map<string, TreatmentEvent[]>()
  const radiationRuns = new Map<string, { id: string; endDate: string }>()
  const byDate = (a: TreatmentEvent, b: TreatmentEvent) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id)
  for (const event of [...events].sort(byDate)) {
    if (!treatmentTypes.has(event.type) && !(event.type === 'other' && event.chemotherapyCycleId)) continue
    let id = event.chemotherapyCycleId
      ? `cycle:${event.type}:${event.chemotherapyCourseId ?? ''}:${event.chemotherapyCycleId}`
      : `event:${event.id}`
    if (event.type === 'radiotherapy' && !event.chemotherapyCycleId) {
      const signature = JSON.stringify([
        event.chemotherapyCourseId, event.cycleNumber,
        ...[event.regimen, event.radiotherapySite, event.hospital, event.department].map((value) => value?.trim().toLowerCase() || ''),
      ])
      const previous = radiationRuns.get(signature)
      const lastDay = previous && parseISO(previous.endDate)
      // Bridge weekends, but don't join separate courses across longer or weekday gaps.
      if (previous && lastDay && !Number.isNaN(lastDay.getTime())) {
        const nextDay = formatISO(addDays(lastDay, 1), { representation: 'date' })
        const nextWeekday = formatISO(addBusinessDays(lastDay, 1), { representation: 'date' })
        if (event.startDate <= nextDay || event.startDate <= nextWeekday) id = previous.id
      }
      const endDate = event.endDate > event.startDate ? event.endDate : event.startDate
      radiationRuns.set(signature, { id, endDate: previous?.id === id && previous.endDate > endDate ? previous.endDate : endDate })
    }
    const group = stages.get(id)
    if (group) group.push(event)
    else stages.set(id, [event])
  }

  return Array.from(stages, ([id, ordered]) => {
    const first = ordered[0]
    return {
      id,
      type: first.type,
      startDate: first.startDate,
      endDate: ordered.reduce((end, event) => event.endDate > end ? event.endDate : end, first.startDate),
      cycleNumber: first.chemotherapyCycleId ? ordered.find((event) => event.cycleNumber != null)?.cycleNumber : undefined,
      regimen: ordered.find((event) => event.regimen?.trim())?.regimen?.trim(),
      title: first.title,
      events: ordered,
    }
  })
}
