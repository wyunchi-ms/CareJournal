import { describe, expect, it } from 'vitest'
import { CALENDAR_EVENT_LABEL_LIMIT, formatBodyMeasurements, selectCalendarEventLabels } from '../services/calendarEvents'
import type { TreatmentEvent } from '../types'

const event = (id: string, type: TreatmentEvent['type']): TreatmentEvent => ({
  id,
  type,
  title: id,
  startDate: '2026-07-22',
  endDate: '2026-07-22',
  allDay: true,
  tags: [],
  linkedRecordIds: [],
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
})

describe('calendar event labels', () => {
  it('keeps distinct types ahead of duplicate events', () => {
    const events = [
      event('chemo-1', 'chemotherapy'),
      event('chemo-2', 'chemotherapy'),
      event('surgery', 'surgery'),
      event('diary', 'treatmentDiary'),
      event('body', 'bodyMeasurement'),
      event('exam', 'examination'),
      event('medication', 'medication'),
    ]

    expect(selectCalendarEventLabels(events).map((item) => item.id)).toEqual([
      'chemo-1',
      'surgery',
      'diary',
      'body',
    ])
    expect(selectCalendarEventLabels(events)).toHaveLength(CALENDAR_EVENT_LABEL_LIMIT)
  })

  it('formats available body measurements without empty placeholders', () => {
    expect(formatBodyMeasurements({
      ...event('body', 'bodyMeasurement'),
      bodyMeasurements: { heightCm: 171.5, weightKg: 63.2, systolicBp: 118, diastolicBp: 76 },
    })).toBe('身高 171.5 cm · 体重 63.2 kg · 血压 118/76 mmHg')
  })
})
