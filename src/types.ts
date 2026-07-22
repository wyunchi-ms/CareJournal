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
  notes?: string
  tags: string[]
  linkedRecordIds: string[]
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
}

export interface DynamicVocabulary {
  hospitals: string[]
  departments: string[]
}

export interface BackupPayload {
  version: 1
  exportedAt: string
  events: TreatmentEvent[]
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
}

export const DEFAULT_VOCABULARY: DynamicVocabulary = {
  hospitals: [],
  departments: [],
}

export const newId = () => crypto.randomUUID()
