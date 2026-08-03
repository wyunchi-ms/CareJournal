import { describe, expect, it } from 'vitest'
import { buildChemotherapyCourseEvents, buildTreatmentCourseEvents, getChemotherapyTemplateDayPlans, groupChemotherapyCycles, rescheduleChemotherapyEvents } from '../services/chemotherapy'
import type { ChemotherapyTemplate, TreatmentEvent } from '../types'

const template: ChemotherapyTemplate = {
  id: 'template-1',
  name: '21 天测试方案',
  regimen: '测试方案',
  cycleLengthDays: 21,
  administrationDays: [1, 8],
  defaultCycleCount: 6,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
}

describe('chemotherapy templates and flexible schedules', () => {
  it('stores different medications for each treatment day', () => {
    const dailyTemplate: ChemotherapyTemplate = {
      ...template,
      administrationDays: [1, 2, 3],
      dayPlans: [
        { id: 'day-1', day: 1, medicationItems: [
          { id: 'med-1', name: '卡铂', dose: '5', unit: 'AUC', administration: '静滴' },
          { id: 'med-2', name: '长春新碱', dose: '1.5', unit: 'mg/m²', administration: '静推' },
        ] },
        { id: 'day-2', day: 2, medicationItems: [
          { id: 'med-3', name: '依托泊苷', dose: '100', unit: 'mg/m²' },
          { id: 'med-4', name: '异环磷酰胺' },
        ] },
        { id: 'day-3', day: 3, medicationItems: [
          { id: 'med-5', name: '依托泊苷' },
          { id: 'med-6', name: '异环磷酰胺' },
        ] },
      ],
    }
    const events = buildChemotherapyCourseEvents(dailyTemplate, {
      firstDayOne: '2026-07-01',
      cycleCount: 1,
      now: '2026-07-01T00:00:00.000Z',
    })

    expect(events.map((event) => event.medications)).toEqual([
      '卡铂 + 长春新碱',
      '依托泊苷 + 异环磷酰胺',
      '依托泊苷 + 异环磷酰胺',
    ])
    expect(events[0].dosage).toBe('卡铂：AUC 5 · 静滴\n长春新碱：1.5 mg/m² · 静推')
    expect(events[1].dosage).toBe('依托泊苷：100 mg/m²')
    expect(events[2].dosage).toBeUndefined()
  })

  it('reads old templates as the same medication on every configured administration day', () => {
    const legacy = { ...template, medications: '旧模板共用药物', dosage: '旧模板共用剂量' }
    expect(getChemotherapyTemplateDayPlans(legacy)).toEqual([
      expect.objectContaining({ day: 1, medicationItems: [expect.objectContaining({ name: '旧模板共用药物', administration: '旧模板共用剂量' })] }),
      expect.objectContaining({ day: 8, medicationItems: [expect.objectContaining({ name: '旧模板共用药物', administration: '旧模板共用剂量' })] }),
    ])
  })

  it('creates maintenance events with an editable copy of the planned medicine and dose', () => {
    const maintenance: ChemotherapyTemplate = {
      ...template,
      id: 'maintenance-1',
      templateType: 'maintenance',
      name: '维持治疗方案',
      administrationDays: [1],
      dayPlans: [{ id: 'maintenance-day-1', day: 1, medicationItems: [{ id: 'planned-med', name: '维持药', dose: '10', unit: 'mg', administration: '口服' }] }],
    }
    const events = buildTreatmentCourseEvents(maintenance, { firstDayOne: '2026-08-01', cycleCount: 1, now: '2026-08-01T00:00:00.000Z' })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'maintenance',
      medications: '维持药',
      dosage: '维持药：10 mg · 口服',
      medicationItems: [expect.objectContaining({ name: '维持药', dose: '10', unit: 'mg', administration: '口服' })],
    })
    expect(events[0].medicationItems?.[0].id).not.toBe('planned-med')
  })

  it('creates radiotherapy events with site and Gy dose but no medicine fields', () => {
    const radiotherapy: ChemotherapyTemplate = {
      ...template,
      id: 'radiotherapy-1',
      templateType: 'radiotherapy',
      name: '胸部放疗',
      administrationDays: [1],
      dayPlans: [{ id: 'radiotherapy-day-1', day: 1, radiotherapySite: '左肺原发灶', radiotherapyDoseGy: '2' }],
    }
    const events = buildTreatmentCourseEvents(radiotherapy, { firstDayOne: '2026-08-01', cycleCount: 1, now: '2026-08-01T00:00:00.000Z' })

    expect(events[0]).toMatchObject({ type: 'radiotherapy', radiotherapySite: '左肺原发灶', radiotherapyDoseGy: '2' })
    expect(events[0].medicationItems).toBeUndefined()
    expect(events[0].medications).toBeUndefined()
    expect(events[0].dosage).toBeUndefined()
  })

  it('generates every administration day while grouping them into treatment cycles', () => {
    const events = buildChemotherapyCourseEvents(template, {
      firstDayOne: '2026-07-01',
      cycleCount: 3,
      firstCycleNumber: 2,
      now: '2026-07-01T00:00:00.000Z',
    })

    expect(events).toHaveLength(6)
    expect(events.map((event) => event.startDate)).toEqual([
      '2026-07-01', '2026-07-08',
      '2026-07-22', '2026-07-29',
      '2026-08-12', '2026-08-19',
    ])
    expect(events.map((event) => event.cycleNumber)).toEqual([2, 2, 3, 3, 4, 4])
    expect(groupChemotherapyCycles(events)).toHaveLength(3)
    expect(groupChemotherapyCycles(events)[0]).toMatchObject({
      dayOne: '2026-07-01',
      cycleNumber: 2,
      title: '第 2 周期',
    })
  })

  it('can delay a D1 event and every following cycle without changing the original plan date', () => {
    const events = buildChemotherapyCourseEvents(template, {
      firstDayOne: '2026-07-01',
      cycleCount: 2,
      now: '2026-07-01T00:00:00.000Z',
    })
    const original = events[0]
    const updated: TreatmentEvent = {
      ...original,
      startDate: '2026-07-04',
      endDate: '2026-07-04',
      updatedAt: '2026-07-02T00:00:00.000Z',
    }

    const changes = rescheduleChemotherapyEvents(events, original, updated, 'future')
    expect(changes.map((event) => event.startDate)).toEqual([
      '2026-07-04', '2026-07-11', '2026-07-25', '2026-08-01',
    ])
    expect(changes.map((event) => event.cycleDayOne)).toEqual([
      '2026-07-04', '2026-07-04', '2026-07-25', '2026-07-25',
    ])
    expect(changes[0].plannedStartDate).toBe('2026-07-01')
  })

  it('can move one administration day without moving its cycle Day 1 or later cycles', () => {
    const events = buildChemotherapyCourseEvents(template, {
      firstDayOne: '2026-07-01',
      cycleCount: 2,
      now: '2026-07-01T00:00:00.000Z',
    })
    const original = events[1]
    const updated = { ...original, startDate: '2026-07-10', endDate: '2026-07-10', updatedAt: '2026-07-02T00:00:00.000Z' }

    expect(rescheduleChemotherapyEvents(events, original, updated, 'single')).toEqual([
      expect.objectContaining({ startDate: '2026-07-10', cycleDayOne: '2026-07-01' }),
    ])
  })
})
