export const EVENT_TYPES = {
  surgery: { label: '手术', color: '#e45756' },
  hospitalization: { label: '住院', color: '#4c78a8' },
  chemotherapy: { label: '化疗', color: '#7a5af8' },
  radiotherapy: { label: '放疗', color: '#f59e0b' },
  targeted: { label: '靶向治疗', color: '#0f9d8a' },
  immunotherapy: { label: '免疫治疗', color: '#0891b2' },
  medication: { label: '用药', color: '#64748b' },
  appointment: { label: '门诊复诊', color: '#2563eb' },
  examination: { label: '检验检查', color: '#16a34a' },
  adverseReaction: { label: '不良反应', color: '#dc2626' },
  other: { label: '其他', color: '#6b7280' },
} as const

export type EventType = keyof typeof EVENT_TYPES

export interface TreatmentEvent {
  id: string
  type: EventType
  title: string
  startDate: string
  endDate: string
  allDay: boolean
  hospital?: string
  department?: string
  doctor?: string
  regimen?: string
  medications?: string
  dosage?: string
  cycleNumber?: number
  cycleDayOne?: string
  chemotherapyTemplateId?: string
  chemotherapyCourseId?: string
  chemotherapyCycleId?: string
  administrationDay?: number
  plannedStartDate?: string
  notes?: string
  tags: string[]
  linkedRecordIds: string[]
  createdAt: string
  updatedAt: string
}

export interface ChemotherapyMedication {
  id: string
  name: string
  dose?: string
  unit?: string
  administration?: string
  notes?: string
}

export const CHEMOTHERAPY_DOSE_UNITS = [
  { value: 'mg/m²', label: 'mg/m²（按体表面积）' },
  { value: 'g/m²', label: 'g/m²（按体表面积）' },
  { value: 'μg/m²', label: 'μg/m²（按体表面积）' },
  { value: 'IU/m²', label: 'IU/m²（按体表面积）' },
  { value: 'mg/kg', label: 'mg/kg（按体重）' },
  { value: 'μg/kg', label: 'μg/kg（按体重）' },
  { value: 'IU/kg', label: 'IU/kg（按体重）' },
  { value: 'mg', label: 'mg（总剂量）' },
  { value: 'g', label: 'g（总剂量）' },
  { value: 'μg', label: 'μg（总剂量）' },
  { value: 'IU', label: 'IU（总剂量）' },
  { value: 'AUC', label: 'AUC（目标暴露量）' },
] as const

export const TREATMENT_PLAN_TYPES = {
  chemotherapy: { label: '化疗', description: '按周期维护每日用药和剂量', color: '#91462f', usesMedication: true },
  radiotherapy: { label: '放疗', description: '维护放疗周期和每日安排', color: '#b97818', usesMedication: false },
  maintenance: { label: '维持治疗', description: '记录长期或周期性维持用药', color: '#567a5b', usesMedication: true },
  targeted: { label: '靶向治疗', description: '记录靶向药物和周期安排', color: '#39776f', usesMedication: true },
  immunotherapy: { label: '免疫治疗', description: '记录免疫治疗药物和周期安排', color: '#46738a', usesMedication: true },
  supportive: { label: '支持治疗', description: '记录补液、升白等支持治疗', color: '#796a57', usesMedication: true },
  other: { label: '其他方案', description: '记录其他周期性治疗安排', color: '#766b67', usesMedication: false },
} as const

export type TreatmentPlanType = keyof typeof TREATMENT_PLAN_TYPES

export interface ChemotherapyTemplateDayPlan {
  id: string
  day: number
  radiotherapySite?: string
  radiotherapyDoseGy?: string
  medicationItems?: ChemotherapyMedication[]
  medications?: string
  dosage?: string
  notes?: string
}

export interface ChemotherapyTemplate {
  id: string
  templateType?: TreatmentPlanType
  sortOrder?: number
  name: string
  regimen?: string
  medications?: string
  dosage?: string
  cycleLengthDays: number
  administrationDays: number[]
  dayPlans?: ChemotherapyTemplateDayPlan[]
  defaultCycleCount: number
  hospital?: string
  department?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

export type AbnormalFlag = 'high' | 'low' | 'critical' | 'normal' | 'unknown'

export interface LabIndicator {
  id: string
  rawName: string
  normalizedCode: string
  normalizedName: string
  value: number | null
  rawValue: string
  unit: string
  referenceLow: number | null
  referenceHigh: number | null
  referenceText: string
  abnormalFlag: AbnormalFlag
}

export interface StoredImage {
  id: string
  name: string
  mimeType: string
  dataUrl: string
  sha256: string
  storagePath?: string
  localUri?: string
  sourceUri?: string
  sourceKey?: string
  relativePath?: string
}

export type OcrQueueStatus = 'queued' | 'processing' | 'completed' | 'failed'
export type OcrQueuePhase = 'waiting' | 'recognizing' | 'saving' | 'done' | 'error'

export interface OcrQueueItem {
  id: string
  image: StoredImage
  status: OcrQueueStatus
  phase: OcrQueuePhase
  progress: number
  attempts: number
  error?: string
  resultRecordIds: string[]
  createdAt: string
  updatedAt: string
}

export type OcrStatus = 'not_requested' | 'processing' | 'completed' | 'failed'

export interface ExamRecord {
  id: string
  reportType: string
  normalizedReportType?: string
  examDate: string
  reportDate?: string
  hospital?: string
  department?: string
  summary?: string
  indicators: LabIndicator[]
  images: StoredImage[]
  linkedEventIds: string[]
  fingerprint: string
  ocrStatus: OcrStatus
  ocrError?: string
  ocrAttempts: number
  createdAt: string
  updatedAt: string
}

export interface ChartPin {
  id: string
  title: string
  mode: 'trend' | 'cycle'
  indicatorCodes: string[]
  cycleEventIds: string[]
  createdAt: string
}

export interface AzureSettings {
  endpoint: string
  apiKey: string
  deployment: string
  apiVersion: string
  maxRetries: number
}

export interface AppPreferences {
  azure: AzureSettings
  darkMode: boolean
  chartIndicatorOrder: string[]
  chartPinnedIndicatorCodes: string[]
}

export interface DynamicVocabulary {
  hospitals: string[]
  departments: string[]
}

export interface BackupPayload {
  version: 1
  exportedAt: string
  events: TreatmentEvent[]
  chemotherapyTemplates?: ChemotherapyTemplate[]
  records: ExamRecord[]
  pins: ChartPin[]
  preferences: Omit<AppPreferences, 'azure'> & { azure: Omit<AzureSettings, 'apiKey'> }
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  azure: {
    endpoint: '',
    apiKey: '',
    deployment: '',
    apiVersion: '2024-10-21',
    maxRetries: 3,
  },
  darkMode: false,
  chartIndicatorOrder: [],
  chartPinnedIndicatorCodes: [],
}

export const DEFAULT_VOCABULARY: DynamicVocabulary = {
  hospitals: [],
  departments: [],
}

export const newId = () => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
