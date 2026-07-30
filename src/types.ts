export const EVENT_TYPES = {
  surgery: { label: '手术', calendarLabel: '手术', color: '#e45756' },
  hospitalization: { label: '住院', calendarLabel: '住院', color: '#4c78a8' },
  chemotherapy: { label: '化疗', calendarLabel: '化疗', color: '#7a5af8' },
  radiotherapy: { label: '放疗', calendarLabel: '放疗', color: '#f59e0b' },
  targeted: { label: '靶向治疗', calendarLabel: '靶向', color: '#0f9d8a' },
  immunotherapy: { label: '免疫治疗', calendarLabel: '免疫', color: '#0891b2' },
  medication: { label: '用药', calendarLabel: '用药', color: '#64748b' },
  appointment: { label: '门诊复诊', calendarLabel: '复诊', color: '#2563eb' },
  examination: { label: '检验检查', calendarLabel: '检查', color: '#16a34a' },
  adverseReaction: { label: '不良反应', calendarLabel: '反应', color: '#dc2626' },
  bodyMeasurement: { label: '身体记录', calendarLabel: '身体', color: '#0e7490' },
  treatmentDiary: { label: '治疗日记', calendarLabel: '日记', color: '#a53f75' },
  other: { label: '其他', calendarLabel: '其他', color: '#6b7280' },
} as const

export type EventType = keyof typeof EVENT_TYPES

export interface BodyMeasurements {
  heightCm?: number
  weightKg?: number
  temperatureC?: number
  systolicBp?: number
  diastolicBp?: number
  heartRateBpm?: number
  oxygenSaturationPercent?: number
}

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
  bodyMeasurements?: BodyMeasurements
  treatmentReaction?: string
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
  chemotherapy: { label: '化疗', description: '按周期维护每日用药和剂量', color: '#A23B36', usesMedication: true },
  radiotherapy: { label: '放疗', description: '维护放疗周期和每日安排', color: '#A66000', usesMedication: false },
  maintenance: { label: '维持治疗', description: '记录长期或周期性维持用药', color: '#2F7552', usesMedication: true },
  targeted: { label: '靶向治疗', description: '记录靶向药物和周期安排', color: '#087A70', usesMedication: true },
  immunotherapy: { label: '免疫治疗', description: '记录免疫治疗药物和周期安排', color: '#3568A8', usesMedication: true },
  supportive: { label: '支持治疗', description: '记录补液、升白等支持治疗', color: '#7651A8', usesMedication: true },
  other: { label: '其他方案', description: '记录其他周期性治疗安排', color: '#68616C', usesMedication: false },
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
  assetId?: string
  name: string
  mimeType: string
  dataUrl: string
  sha256: string
  /** Decoded-pixel fingerprint used to match lightly re-encoded copies. */
  visualFingerprint?: string
  storagePath?: string
  localUri?: string
  sourceUri?: string
  sourceKey?: string
  relativePath?: string
}

export interface MediaAsset {
  id: string
  name: string
  mimeType: string
  dataUrl: string
  sha256: string
  visualFingerprint?: string
  storagePath?: string
  localUri?: string
  sourceUri?: string
  sourceKey?: string
  /**
   * Set on the receiver side when a LAN sync peer announced this asset in the
   * metadata phase but the actual bytes have not been delivered yet. Cleared as
   * soon as the chunk stream persists real content. The flag is local-only and
   * is stripped by `metadataAsset` before any snapshot leaves the device, so it
   * never travels across the wire.
   */
  pendingSync?: boolean
  createdAt: string
  updatedAt: string
}

export const REIMBURSEMENT_COVERAGES = {
  public_medical: { label: '基本医保', claimable: true },
  commercial: { label: '商业保险', claimable: true },
  public_and_commercial: { label: '医保 + 商保', claimable: true },
  self_pay: { label: '自费（不报销）', claimable: false },
  international_excluded: { label: '国际医疗／除外责任', claimable: false },
} as const

export type ReimbursementCoverage = keyof typeof REIMBURSEMENT_COVERAGES

export type ReimbursementMaterialKind =
  | 'claim_application'
  | 'identity'
  | 'bank_account'
  | 'medical_insurance_form'
  | 'invoice'
  | 'expense_detail'
  | 'medical_record'
  | 'diagnosis'
  | 'prescription'
  | 'examination_order'
  | 'test_report'
  | 'imaging_report'
  | 'pathology_report'
  | 'inpatient_record'
  | 'discharge_summary'
  | 'treatment_record'
  | 'radiotherapy_record'
  | 'surgery_record'
  | 'settlement_statement'
  | 'referral'
  | 'other'

export interface ReimbursementAttachment extends StoredImage {
  source: 'record' | 'upload' | 'camera'
  sourceRecordId?: string
  createdAt: string
}

export interface ReimbursementMaterial {
  id: string
  kind: ReimbursementMaterialKind
  label: string
  required: boolean
  completed: boolean
  notes?: string
  attachments: ReimbursementAttachment[]
}

export interface ReimbursementPlan {
  id: string
  eventId: string
  relatedEventIds?: string[]
  eventType: EventType
  eventTitle: string
  eventDate: string
  hospital?: string
  coverage: ReimbursementCoverage
  reimbursementStatus?: 'pending' | 'reimbursed'
  reimbursedAt?: string
  materials: ReimbursementMaterial[]
  notes?: string
  createdAt: string
  updatedAt: string
}

export type OcrQueueStatus = 'queued' | 'processing' | 'completed' | 'failed'
export type OcrQueuePhase = 'waiting' | 'extracting' | 'redacting' | 'recognizing' | 'saving' | 'done' | 'error'

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
  /** 标本采集日期；无标本检查则为实际检查／执行日期。 */
  sampleDate: string
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
  sortOrder?: number
  title: string
  mode: 'trend' | 'cycle'
  indicatorCodes: string[]
  cycleEventIds: string[]
  createdAt: string
}

export const LLM_PROVIDER_IDS = [
  'azure-openai',
  'openai',
  'deepseek',
  'kimi',
  'doubao',
  'qwen',
  'gemini',
  'minimax',
  'glm',
  'openrouter',
  'openai-compatible',
] as const

export type LlmProviderId = typeof LLM_PROVIDER_IDS[number]

export interface LlmProviderSettings {
  endpoint: string
  apiKey: string
  model: string
  maxRetries: number
}

export interface LlmSettings {
  activeProvider: LlmProviderId
  providers: Partial<Record<LlmProviderId, LlmProviderSettings>>
}

export interface LegacyAzureSettings {
  endpoint: string
  apiKey: string
  deployment: string
  apiVersion?: string
  maxRetries: number
}

export interface AppPreferences {
  llm: LlmSettings
  localPrivacyOcrEnabled: boolean
  darkMode: boolean
  chartIndicatorOrder: string[]
  chartPinnedIndicatorCodes: string[]
}

export type LanSyncEntityKind = 'event' | 'chemotherapyTemplate' | 'record' | 'pin' | 'reimbursementPlan' | 'asset'

export interface SyncTombstone {
  id: string
  entityKind: LanSyncEntityKind
  entityId: string
  deletedAt: string
  updatedAt: string
}

export interface LanSyncSnapshot {
  version: 1
  deviceName: string
  createdAt: string
  events: TreatmentEvent[]
  chemotherapyTemplates: ChemotherapyTemplate[]
  records: ExamRecord[]
  pins: ChartPin[]
  reimbursementPlans: ReimbursementPlan[]
  assets: MediaAsset[]
  tombstones: SyncTombstone[]
    /**
     * Version 3 transport metadata. Older peers omit this field and continue to
     * exchange a single full snapshot.
     */
    transfer?: {
      phase: 'preview' | 'metadata' | 'assets'
      done?: boolean
      assetIndex?: number
      assetCount?: number
      /** IDs of files that this device can currently read and send. */
      availableAssetIds?: string[]
      /**
       * Entity kinds the initiator is willing to accept from the responder in
       * this sync. When present, the responder must only populate the listed
       * kinds in its outbound metadata snapshot and chunk stream. Absent means
       * "accept everything", which preserves compatibility with peers that do
       * not know about the selectable-sync feature.
       */
      wantedKinds?: LanSyncEntityKind[]
      skippedAssets?: number
      preview?: LanSyncPreview
      chunk?: {
      asset: MediaAsset
      index: number
      count: number
      data: string
    }
  }
}

export interface LanSyncPreviewCount {
  added: number
  updated: number
  deleted: number
}

export interface LanSyncPreview {
  events: LanSyncPreviewCount
  chemotherapyTemplates: LanSyncPreviewCount
  records: LanSyncPreviewCount
  pins: LanSyncPreviewCount
  reimbursementPlans: LanSyncPreviewCount
  assets: LanSyncPreviewCount
}

export interface LanSyncMergeSummary {
  added: number
  updated: number
  unchanged: number
  deleted: number
  conflictsMerged: number
  assetsReceived: number
}

export interface DynamicVocabulary {
  hospitals: string[]
  departments: string[]
}

export interface BackupPayload {
  version: 1 | 2
  exportedAt: string
  assets?: MediaAsset[]
  events: TreatmentEvent[]
  chemotherapyTemplates?: ChemotherapyTemplate[]
  records: ExamRecord[]
  pins: ChartPin[]
  reimbursementPlans?: ReimbursementPlan[]
  preferences: Omit<AppPreferences, 'llm'> & {
    llm?: {
      activeProvider: LlmProviderId
      providers: Partial<Record<LlmProviderId, Omit<LlmProviderSettings, 'apiKey'>>>
    }
    azure?: Omit<LegacyAzureSettings, 'apiKey'>
  }
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  llm: {
    activeProvider: 'azure-openai',
    providers: {
      'azure-openai': {
        endpoint: '',
        apiKey: '',
        model: '',
        maxRetries: 3,
      },
    },
  },
  localPrivacyOcrEnabled: false,
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
