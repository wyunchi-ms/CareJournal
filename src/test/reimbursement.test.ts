import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  advanceReimbursementStatus,
  buildReimbursementZip,
  createReimbursementPlan,
  keepHospitalReimbursementMaterials,
  reimbursableEvents,
  reimbursementPlanStatus,
  reimbursementPlanStatusLabel,
} from '../services/reimbursement'
import type { ExamRecord, ReimbursementPlan, TreatmentEvent } from '../types'

const event: TreatmentEvent = {
  id: 'event-1',
  type: 'hospitalization',
  title: '肿瘤科住院',
  startDate: '2026-07-20',
  endDate: '2026-07-24',
  allDay: true,
  hospital: '测试医院',
  tags: [],
  linkedRecordIds: ['record-1'],
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
}

const record: ExamRecord = {
  id: 'record-1',
  reportType: '血常规',
  normalizedReportType: '血常规',
  sampleDate: '2026-07-21',
  hospital: '测试医院',
  indicators: [],
  images: [{
    id: 'image-1',
    name: '血常规.jpg',
    mimeType: 'image/jpeg',
    dataUrl: 'data:image/jpeg;base64,Y2FyZWpvdXJuYWw=',
    sha256: 'same-image',
  }],
  linkedEventIds: ['event-1'],
  fingerprint: 'record-1',
  ocrStatus: 'completed',
  ocrAttempts: 1,
  createdAt: '2026-07-21T00:00:00.000Z',
  updatedAt: '2026-07-21T00:00:00.000Z',
}

describe('reimbursement plans', () => {
  it('advances reimbursement status without misclassifying legacy data', () => {
    const basePlan = createReimbursementPlan(event, 'public_medical', [record])
    const reimbursed = advanceReimbursementStatus(basePlan, '2026-07-26T00:00:00.000Z')
    const reopened = advanceReimbursementStatus(reimbursed)
    const legacy = { ...basePlan, reimbursedAt: '2026-07-25T00:00:00.000Z' } as ReimbursementPlan

    expect(reimbursementPlanStatus(basePlan)).toBe('pending')
    expect(reimbursementPlanStatusLabel(basePlan)).toBe('待报销')
    expect(reimbursed).toMatchObject({
      reimbursementStatus: 'reimbursed',
      reimbursedAt: '2026-07-26T00:00:00.000Z',
    })
    expect(reopened).toMatchObject({ reimbursementStatus: 'pending', reimbursedAt: undefined })
    expect(reimbursementPlanStatus(legacy)).toBe('reimbursed')
    expect(reimbursementPlanStatusLabel(legacy)).toBe('已报销')
  })

  it('builds hospitalization requirements and reuses matching record images', () => {
    const plan = createReimbursementPlan(event, 'public_and_commercial', [record])

    expect(plan.materials.map((item) => item.kind)).toEqual(expect.arrayContaining([
      'settlement_statement',
      'invoice',
      'expense_detail',
      'inpatient_record',
      'discharge_summary',
      'test_report',
    ]))
    expect(plan.materials.map((item) => item.kind)).not.toEqual(expect.arrayContaining([
      'medical_insurance_form',
      'claim_application',
      'identity',
      'bank_account',
    ]))
    const report = plan.materials.find((item) => item.kind === 'test_report')
    expect(report).toMatchObject({ completed: true })
    expect(report?.attachments[0]).toMatchObject({
      name: '血常规.jpg',
      source: 'record',
      sourceRecordId: 'record-1',
    })
  })

  it('removes non-hospital administrative items from legacy plans', () => {
    const plan = createReimbursementPlan(event, 'public_medical', [record])
    const cleaned = keepHospitalReimbursementMaterials({
      ...plan,
      materials: [
        ...plan.materials,
        { id: 'identity', kind: 'identity', label: '身份证明', required: true, completed: false, attachments: [] },
        { id: 'form', kind: 'medical_insurance_form', label: '医保手工报销申请表', required: true, completed: false, attachments: [] },
      ],
    })

    expect(cleaned.materials.some((item) => item.kind === 'identity')).toBe(false)
    expect(cleaned.materials.some((item) => item.kind === 'medical_insurance_form')).toBe(false)
    expect(cleaned.materials.some((item) => item.kind === 'invoice')).toBe(true)
  })

  it('groups treatment and examination events into their hospitalization', () => {
    const chemotherapy: TreatmentEvent = {
      ...event,
      id: 'chemotherapy-1',
      type: 'chemotherapy',
      title: '住院化疗',
      startDate: '2026-07-22',
      endDate: '2026-07-22',
      linkedRecordIds: [],
    }
    const examination: TreatmentEvent = {
      ...event,
      id: 'examination-1',
      type: 'examination',
      title: '住院血液检查',
      startDate: '2026-07-23',
      endDate: '2026-07-23',
      linkedRecordIds: ['record-1'],
    }
    const laterChemotherapy: TreatmentEvent = {
      ...chemotherapy,
      id: 'chemotherapy-later',
      startDate: '2026-08-10',
      endDate: '2026-08-10',
    }
    const allEvents = [event, chemotherapy, examination, laterChemotherapy]
    const plan = createReimbursementPlan(event, 'public_medical', [record], allEvents)

    expect(reimbursableEvents(allEvents).map((item) => item.id)).toEqual(['chemotherapy-later', 'event-1'])
    expect(plan.relatedEventIds).toEqual(['event-1', 'chemotherapy-1', 'examination-1'])
    expect(plan.materials.map((item) => item.kind)).toEqual(expect.arrayContaining([
      'inpatient_record',
      'treatment_record',
      'prescription',
      'examination_order',
      'test_report',
    ]))
    expect(plan.materials.some((item) => item.kind === 'medical_record')).toBe(false)
  })

  it('keeps outpatient plans free of inpatient records', () => {
    const outpatientEvent: TreatmentEvent = {
      ...event,
      id: 'outpatient-1',
      type: 'appointment',
      title: '肿瘤门诊',
      startDate: '2026-08-01',
      endDate: '2026-08-01',
      linkedRecordIds: [],
    }
    const plan = createReimbursementPlan(outpatientEvent, 'public_medical', [])

    expect(plan.materials.find((item) => item.kind === 'medical_record')?.label).toBe('门（急）诊病历')
    expect(plan.materials.some((item) => ['inpatient_record', 'discharge_summary'].includes(item.kind))).toBe(false)
  })

  it('exports plans into event and material folders with placeholders', async () => {
    const plan = createReimbursementPlan(event, 'public_medical', [record])
    const { blob, filename } = await buildReimbursementZip([plan])
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(blob)
    })
    const zip = await JSZip.loadAsync(bytes)
    const paths = Object.keys(zip.files)

    expect(filename).toMatch(/^报销材料_\d{4}-\d{2}-\d{2}\.zip$/)
    expect(paths).toContain('2026-07-20_肿瘤科住院/材料清单.txt')
    expect(paths.some((path) => path.includes('检查检验报告/01_血常规.jpg'))).toBe(true)
    expect(paths.some((path) => path.includes('医疗收费票据／发票/待补充.txt'))).toBe(true)
  })
})
