import type { TreatmentEvent } from '../types'

/** 日历格最多展示的事件标签数；修改这里即可统一调整。 */
export const CALENDAR_EVENT_LABEL_LIMIT = 4

/**
 * 优先保留不同事件类型，再按原始顺序补充同类型事件。
 * 这样在日历空间有限时，用户仍能先看到当天事件的类型全貌。
 */
export function selectCalendarEventLabels(
  events: TreatmentEvent[],
  limit = CALENDAR_EVENT_LABEL_LIMIT,
) {
  if (limit <= 0) return []
  const selected: TreatmentEvent[] = []
  const selectedIds = new Set<string>()
  const representedTypes = new Set<TreatmentEvent['type']>()

  for (const event of events) {
    if (selected.length >= limit) break
    if (representedTypes.has(event.type)) continue
    selected.push(event)
    selectedIds.add(event.id)
    representedTypes.add(event.type)
  }

  for (const event of events) {
    if (selected.length >= limit) break
    if (selectedIds.has(event.id)) continue
    selected.push(event)
  }

  return selected
}

export function formatBodyMeasurements(event: TreatmentEvent) {
  const values = event.bodyMeasurements
  if (!values) return ''
  return [
    values.heightCm !== undefined ? `身高 ${values.heightCm} cm` : '',
    values.weightKg !== undefined ? `体重 ${values.weightKg} kg` : '',
    values.temperatureC !== undefined ? `体温 ${values.temperatureC} ℃` : '',
    values.systolicBp !== undefined || values.diastolicBp !== undefined
      ? `血压 ${values.systolicBp ?? '—'}/${values.diastolicBp ?? '—'} mmHg`
      : '',
    values.heartRateBpm !== undefined ? `心率 ${values.heartRateBpm} 次/分` : '',
    values.oxygenSaturationPercent !== undefined ? `血氧 ${values.oxygenSaturationPercent}%` : '',
  ].filter(Boolean).join(' · ')
}
