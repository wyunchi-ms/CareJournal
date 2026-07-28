import JSZip from 'jszip'
import { addDays, isWithinInterval, parseISO } from 'date-fns'
import { prepareImage, sameStoredImage, sha256 } from './images'
import { materializeNativeStoredImage, persistStoredImage } from './imageStorage'
import {
  EVENT_TYPES,
  REIMBURSEMENT_COVERAGES,
  newId,
  type ExamRecord,
  type ReimbursementAttachment,
  type ReimbursementCoverage,
  type ReimbursementMaterial,
  type ReimbursementMaterialKind,
  type ReimbursementPlan,
  type TreatmentEvent,
} from '../types'

interface MaterialDefinition {
  kind: ReimbursementMaterialKind
  label: string
  required?: boolean
}

const baseByCoverage: Record<ReimbursementCoverage, MaterialDefinition[]> = {
  public_medical: [],
  commercial: [],
  public_and_commercial: [
    { kind: 'settlement_statement', label: '医保结算单／费用分割单' },
  ],
  self_pay: [],
  international_excluded: [],
}

const nonHospitalMaterialKinds = new Set<ReimbursementMaterialKind>([
  'claim_application',
  'identity',
  'bank_account',
  'medical_insurance_form',
])

export function keepHospitalReimbursementMaterials(plan: ReimbursementPlan): ReimbursementPlan {
  const materials = plan.materials.filter((item) =>
    !nonHospitalMaterialKinds.has(item.kind)
    && (plan.eventType !== 'hospitalization' || item.kind !== 'medical_record')
    && (plan.eventType !== 'appointment' || !['inpatient_record', 'discharge_summary'].includes(item.kind)))
  return materials.length === plan.materials.length ? plan : { ...plan, materials }
}

const commonExpense: MaterialDefinition[] = [
  { kind: 'invoice', label: '医疗收费票据／发票' },
  { kind: 'expense_detail', label: '费用明细清单' },
  { kind: 'diagnosis', label: '诊断证明', required: false },
]

const eventMaterials: Partial<Record<TreatmentEvent['type'], MaterialDefinition[]>> = {
  hospitalization: [
    ...commonExpense,
    { kind: 'inpatient_record', label: '住院病历／病案首页' },
    { kind: 'discharge_summary', label: '出院记录／出院小结' },
    { kind: 'test_report', label: '检查检验报告', required: false },
  ],
  surgery: [
    ...commonExpense,
    { kind: 'inpatient_record', label: '住院病历／病案首页' },
    { kind: 'surgery_record', label: '手术记录' },
    { kind: 'discharge_summary', label: '出院记录／出院小结' },
    { kind: 'pathology_report', label: '病理报告', required: false },
    { kind: 'test_report', label: '检查检验报告', required: false },
  ],
  appointment: [
    ...commonExpense,
    { kind: 'medical_record', label: '门（急）诊病历' },
    { kind: 'prescription', label: '处方／用药清单', required: false },
    { kind: 'examination_order', label: '检查申请单', required: false },
    { kind: 'test_report', label: '检查检验报告', required: false },
  ],
  examination: [
    ...commonExpense,
    { kind: 'medical_record', label: '门诊病历', required: false },
    { kind: 'examination_order', label: '检查申请单' },
    { kind: 'test_report', label: '检查／检验报告' },
  ],
  radiotherapy: [
    ...commonExpense,
    { kind: 'medical_record', label: '门诊病历' },
    { kind: 'treatment_record', label: '治疗记录／治疗方案' },
    { kind: 'radiotherapy_record', label: '放疗计划及疗程记录' },
    { kind: 'test_report', label: '相关检查报告', required: false },
  ],
  chemotherapy: [
    ...commonExpense,
    { kind: 'medical_record', label: '门诊病历' },
    { kind: 'treatment_record', label: '化疗方案及给药记录' },
    { kind: 'prescription', label: '处方／用药清单' },
    { kind: 'test_report', label: '相关检查检验报告', required: false },
  ],
  targeted: [
    ...commonExpense,
    { kind: 'medical_record', label: '门诊病历' },
    { kind: 'treatment_record', label: '靶向治疗方案及用药记录' },
    { kind: 'prescription', label: '处方／用药清单' },
    { kind: 'pathology_report', label: '病理／基因检测报告', required: false },
  ],
  immunotherapy: [
    ...commonExpense,
    { kind: 'medical_record', label: '门诊病历' },
    { kind: 'treatment_record', label: '免疫治疗方案及给药记录' },
    { kind: 'prescription', label: '处方／用药清单' },
    { kind: 'test_report', label: '相关检查检验报告', required: false },
  ],
  medication: [
    ...commonExpense,
    { kind: 'medical_record', label: '门诊病历', required: false },
    { kind: 'prescription', label: '处方／外配处方' },
  ],
  adverseReaction: [
    ...commonExpense,
    { kind: 'medical_record', label: '门（急）诊病历' },
    { kind: 'diagnosis', label: '不良反应诊断或情况说明' },
  ],
  other: [
    ...commonExpense,
    { kind: 'medical_record', label: '相关病历资料' },
  ],
}

export const reimbursementCoverageOptions = Object.entries(REIMBURSEMENT_COVERAGES).map(([value, item]) => ({
  value,
  label: item.label,
  description: item.claimable ? '创建材料待办并可导出' : '保留资料归档，但标记为不申请报销',
}))

function eventIsInsideHospitalization(event: TreatmentEvent, hospitalization: TreatmentEvent) {
  return event.id !== hospitalization.id
    && event.startDate >= hospitalization.startDate
    && event.endDate <= hospitalization.endDate
}

export function relatedEventsForReimbursement(event: TreatmentEvent, events: TreatmentEvent[]) {
  if (event.type !== 'hospitalization') return [event]
  return events
    .filter((candidate) => candidate.id === event.id || eventIsInsideHospitalization(candidate, event))
    .sort((first, second) => first.startDate.localeCompare(second.startDate))
}

export function reimbursableEvents(events: TreatmentEvent[]) {
  const supported = new Set(Object.keys(eventMaterials))
  const hospitalizations = events.filter((event) => event.type === 'hospitalization')
  return events
    .filter((event) => supported.has(event.type))
    .filter((event) => event.type === 'hospitalization'
      || !hospitalizations.some((hospitalization) => eventIsInsideHospitalization(event, hospitalization)))
    .sort((first, second) => second.startDate.localeCompare(first.startDate))
}

function material(definition: MaterialDefinition): ReimbursementMaterial {
  return {
    id: newId(),
    kind: definition.kind,
    label: definition.label,
    required: definition.required !== false,
    completed: false,
    attachments: [],
  }
}

function uniqueDefinitions(definitions: MaterialDefinition[]) {
  const byKind = new Map<ReimbursementMaterialKind, MaterialDefinition>()
  definitions.forEach((definition) => {
    const current = byKind.get(definition.kind)
    byKind.set(definition.kind, current
      ? { ...current, required: current.required !== false || definition.required !== false }
      : definition)
  })
  return [...byKind.values()]
}

function recordMaterial(record: ExamRecord): Pick<ReimbursementMaterial, 'kind' | 'label'> {
  const type = `${record.normalizedReportType ?? ''} ${record.reportType}`.toLocaleLowerCase('zh-CN')
  if (/病理|免疫组化|pathology/.test(type)) return { kind: 'pathology_report', label: '病理报告' }
  if (/ct|mri|磁共振|超声|彩超|x.?线|pet|内镜|影像/.test(type)) return { kind: 'imaging_report', label: '影像／内镜检查报告' }
  return { kind: 'test_report', label: '检查检验报告' }
}

function recordMatchesEvent(record: ExamRecord, event: TreatmentEvent, relatedEventIds: string[]) {
  if (event.linkedRecordIds.includes(record.id) || record.linkedEventIds.some((id) => relatedEventIds.includes(id))) return true
  const date = parseISO(record.examDate)
  const interval = { start: addDays(parseISO(event.startDate), -1), end: addDays(parseISO(event.endDate), 1) }
  if (!isWithinInterval(date, interval)) return false
  if (event.type !== 'hospitalization' && event.hospital && record.hospital && event.hospital !== record.hospital) return false
  return true
}

function recordAttachments(record: ExamRecord): ReimbursementAttachment[] {
  const now = new Date().toISOString()
  return record.images.map((image) => ({
    ...image,
    id: newId(),
    source: 'record' as const,
    sourceRecordId: record.id,
    createdAt: now,
  }))
}

export function linkExistingRecordMaterials(plan: ReimbursementPlan, event: TreatmentEvent, records: ExamRecord[]) {
  const nextMaterials = plan.materials.map((item) => ({ ...item, attachments: [...item.attachments] }))
  const relatedEventIds = plan.relatedEventIds?.length ? plan.relatedEventIds : [event.id]
  for (const record of records.filter((candidate) => recordMatchesEvent(candidate, event, relatedEventIds))) {
    const target = recordMaterial(record)
    let item = nextMaterials.find((candidate) => candidate.kind === target.kind)
    if (!item) {
      item = material({ ...target, required: false })
      nextMaterials.push(item)
    }
    for (const attachment of recordAttachments(record)) {
      if (!item.attachments.some((known) => sameStoredImage(known, attachment))) item.attachments.push(attachment)
    }
    if (item.attachments.length > 0) item.completed = true
  }
  return { ...plan, materials: nextMaterials, updatedAt: new Date().toISOString() }
}

export function createReimbursementPlan(event: TreatmentEvent, coverage: ReimbursementCoverage, records: ExamRecord[], allEvents: TreatmentEvent[] = [event]): ReimbursementPlan {
  const now = new Date().toISOString()
  const relatedEvents = relatedEventsForReimbursement(event, allEvents)
  const definitions = [
    ...baseByCoverage[coverage],
    ...relatedEvents.flatMap((item) => eventMaterials[item.type] ?? eventMaterials.other ?? []),
  ].filter((item) => event.type !== 'hospitalization' || item.kind !== 'medical_record')
  const plan: ReimbursementPlan = {
    id: newId(),
    eventId: event.id,
    relatedEventIds: relatedEvents.map((item) => item.id),
    eventType: event.type,
    eventTitle: event.title || EVENT_TYPES[event.type].label,
    eventDate: event.startDate,
    hospital: event.hospital,
    coverage,
    materials: uniqueDefinitions(definitions).map(material),
    createdAt: now,
    updatedAt: now,
  }
  return linkExistingRecordMaterials(plan, event, records)
}

export function changeReimbursementCoverage(plan: ReimbursementPlan, event: TreatmentEvent, coverage: ReimbursementCoverage, records: ExamRecord[], allEvents: TreatmentEvent[] = [event]) {
  const regenerated = createReimbursementPlan(event, coverage, records, allEvents)
  const previousByKind = new Map(plan.materials.map((item) => [item.kind, item]))
  const materials = regenerated.materials.map((item) => {
    const previous = previousByKind.get(item.kind)
    return previous ? { ...item, id: previous.id, completed: previous.completed, notes: previous.notes, attachments: previous.attachments } : item
  })
  plan.materials.filter((item) => item.kind === 'other').forEach((item) => materials.push(item))
  return linkExistingRecordMaterials({
    ...regenerated,
    id: plan.id,
    createdAt: plan.createdAt,
    coverage,
    materials,
  }, event, records)
}

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('文件读取失败'))
    reader.readAsDataURL(file)
  })
}

export async function prepareReimbursementAttachment(file: File, source: 'upload' | 'camera'): Promise<ReimbursementAttachment> {
  if (file.type.startsWith('image/')) {
    const image = await prepareImage(file)
    const persisted = await persistStoredImage(image)
    return { ...persisted, source, createdAt: new Date().toISOString() }
  }
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) throw new Error('仅支持图片或 PDF 文件')
  if (file.size > 30 * 1024 * 1024) throw new Error('单个 PDF 不能超过 30 MB')
  const dataUrl = await readFile(file)
  const persisted = await persistStoredImage({
    id: newId(),
    name: file.name,
    mimeType: 'application/pdf',
    dataUrl,
    sha256: await sha256(dataUrl),
  })
  return { ...persisted, source, createdAt: new Date().toISOString() }
}

function safeName(value: string) {
  const printable = [...value.trim()].map((character) => character.charCodeAt(0) < 32 ? '_' : character).join('')
  return printable.replace(/[<>:"/\\|?*]/g, '_').replace(/[. ]+$/g, '').slice(0, 80) || '未命名'
}

function extensionFor(attachment: ReimbursementAttachment) {
  const existing = attachment.name.match(/(\.[A-Za-z0-9]{1,8})$/)?.[1]
  if (existing) return existing.toLowerCase()
  if (attachment.mimeType === 'application/pdf') return '.pdf'
  if (attachment.mimeType === 'image/png') return '.png'
  if (attachment.mimeType === 'image/webp') return '.webp'
  return '.jpg'
}

async function attachmentBase64(attachment: ReimbursementAttachment) {
  const materialized = await materializeNativeStoredImage(attachment)
  const comma = materialized.dataUrl.indexOf(',')
  if (comma < 0) throw new Error(`无法读取文件：${attachment.name}`)
  return materialized.dataUrl.slice(comma + 1)
}

export async function buildReimbursementZip(plans: ReimbursementPlan[]) {
  if (!plans.length) throw new Error('请至少选择一个报销计划')
  const zip = new JSZip()
  for (const plan of plans.map(keepHospitalReimbursementMaterials)) {
    const eventFolder = zip.folder(safeName(`${plan.eventDate}_${plan.eventTitle}`))!
    const completed = plan.materials.filter((item) => item.completed).length
    eventFolder.file('材料清单.txt', [
      `事件：${plan.eventTitle}`,
      `日期：${plan.eventDate}`,
      `医院：${plan.hospital || '未记录'}`,
      `报销类型：${REIMBURSEMENT_COVERAGES[plan.coverage].label}`,
      `报销状态：${plan.reimbursedAt ? '已报销' : '待报销'}`,
      `完成进度：${completed}/${plan.materials.length}`,
      '',
      ...plan.materials.map((item) => `${item.completed ? '☑' : '☐'} ${item.label}${item.required ? '' : '（按需）'} · ${item.attachments.length} 个文件`),
    ].join('\r\n'))

    for (const item of plan.materials) {
      const materialFolder = eventFolder.folder(safeName(item.label))!
      if (!item.attachments.length) {
        materialFolder.file('待补充.txt', `${item.label}${item.required ? '' : '（按需）'}尚未上传材料。`)
        continue
      }
      for (let index = 0; index < item.attachments.length; index += 1) {
        const attachment = item.attachments[index]
        const extension = extensionFor(attachment)
        const baseName = safeName(attachment.name.replace(/\.[^.]+$/, ''))
        materialFolder.file(`${String(index + 1).padStart(2, '0')}_${baseName}${extension}`, await attachmentBase64(attachment), { base64: true })
      }
    }
  }
  return {
    blob: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }),
    filename: `报销材料_${new Date().toISOString().slice(0, 10)}.zip`,
  }
}
