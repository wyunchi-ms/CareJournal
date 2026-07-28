import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { repository } from '../db/repository'
import { eventForRecord, mergeRecognizedRecord, recognizeReport, toDomainRecords } from '../services/ocr'
import { materializeStoredImage } from '../services/folderImport'
import { deduplicateStoredImages, sameStoredImage } from '../services/images'
import { garbageCollectNativeImages, migrateLegacyNativeImages, persistRestoredRecords, persistRestoredReimbursementPlans, persistStoredImage } from '../services/imageStorage'
import { buildVocabulary } from '../services/vocabulary'
import { keepHospitalReimbursementMaterials } from '../services/reimbursement'
import type { AppPreferences, BackupPayload, ChartPin, ChemotherapyTemplate, DynamicVocabulary, ExamRecord, OcrQueueItem, ReimbursementPlan, StoredImage, TreatmentEvent } from '../types'
import { DEFAULT_PREFERENCES, newId } from '../types'

interface OcrQueueStats {
  total: number
  queued: number
  processing: number
  completed: number
  failed: number
  progress: number
}

interface ImageDeduplicationResult {
  recordsScanned: number
  recordsUpdated: number
  imagesRemoved: number
  filesDeleted: number
}

interface AppState {
  ready: boolean
  startupMessage: string
  storageError: string | null
  storageLabel: string
  events: TreatmentEvent[]
  chemotherapyTemplates: ChemotherapyTemplate[]
  records: ExamRecord[]
  reimbursementPlans: ReimbursementPlan[]
  pins: ChartPin[]
  ocrJobs: OcrQueueItem[]
  ocrQueueStats: OcrQueueStats
  preferences: AppPreferences
  vocabulary: DynamicVocabulary
  saveEvent: (event: TreatmentEvent) => Promise<void>
  saveEvents: (events: TreatmentEvent[]) => Promise<void>
  deleteEvent: (id: string) => Promise<void>
  saveChemotherapyTemplate: (template: ChemotherapyTemplate) => Promise<void>
  reorderChemotherapyTemplates: (orderedIds: string[]) => Promise<void>
  deleteChemotherapyTemplate: (id: string) => Promise<void>
  saveRecord: (record: ExamRecord) => Promise<void>
  saveImportedRecords: (records: ExamRecord[], events: TreatmentEvent[]) => Promise<{ added: number; merged: number }>
  rerecognizeRecord: (id: string) => Promise<ExamRecord>
  deleteRecord: (id: string) => Promise<void>
  saveReimbursementPlan: (plan: ReimbursementPlan) => Promise<void>
  deleteReimbursementPlan: (id: string) => Promise<void>
  savePin: (pin: ChartPin) => Promise<void>
  deletePin: (id: string) => Promise<void>
  savePreferences: (preferences: AppPreferences) => Promise<void>
  restoreBackup: (payload: BackupPayload) => Promise<void>
  deduplicateImagesGlobally: () => Promise<ImageDeduplicationResult>
  enqueueOcrImage: (image: StoredImage) => Promise<boolean>
  retryOcrJob: (id: string) => Promise<void>
  retryAllFailedOcrJobs: () => Promise<void>
  removeOcrJob: (id: string) => Promise<void>
  clearCompletedOcrJobs: () => Promise<void>
}

const AppContext = createContext<AppState | null>(null)

const byDateDescending = <T extends { updatedAt?: string; createdAt?: string }>(items: T[]) =>
  [...items].sort((a, b) => (b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? ''))

const sortTreatmentTemplates = (items: ChemotherapyTemplate[]) =>
  [...items].sort((a, b) => {
    const aHasOrder = Number.isFinite(a.sortOrder)
    const bHasOrder = Number.isFinite(b.sortOrder)
    if (aHasOrder && bHasOrder) return (a.sortOrder as number) - (b.sortOrder as number)
    if (aHasOrder !== bHasOrder) return aHasOrder ? -1 : 1
    return (b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? '')
  })

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [startupMessage, setStartupMessage] = useState('正在打开本地病程库…')
  const [storageError, setStorageError] = useState<string | null>(null)
  const [events, setEvents] = useState<TreatmentEvent[]>([])
  const [chemotherapyTemplates, setChemotherapyTemplates] = useState<ChemotherapyTemplate[]>([])
  const [records, setRecords] = useState<ExamRecord[]>([])
  const [reimbursementPlans, setReimbursementPlans] = useState<ReimbursementPlan[]>([])
  const [pins, setPins] = useState<ChartPin[]>([])
  const [ocrJobs, setOcrJobs] = useState<OcrQueueItem[]>([])
  const [preferences, setPreferences] = useState<AppPreferences>(DEFAULT_PREFERENCES)
  const recordsRef = useRef<ExamRecord[]>([])
  const reimbursementPlansRef = useRef<ReimbursementPlan[]>([])
  const ocrJobsRef = useRef<OcrQueueItem[]>([])
  const processingOcrRef = useRef(false)
  const vocabulary = useMemo(() => buildVocabulary([...events, ...records, ...chemotherapyTemplates]), [events, records, chemotherapyTemplates])

  useEffect(() => {
    let active = true
    void (async () => {
      setStartupMessage('正在优化本地图片存储…')
      const migration = await migrateLegacyNativeImages()
      if (migration.failedEntities > 0) {
        console.warn(`${migration.failedEntities} 条旧图片记录暂未完成原生文件迁移，将在下次启动重试`)
      }
      setStartupMessage('正在读取本地病程记录…')
      await repository.removePersistedCompletedOcrJobs()
      const [loadedEvents, loadedTemplates, loadedRecords, loadedPins, loadedPreferences, loadedOcrJobs, loadedReimbursementPlans] = await Promise.all([
        repository.list<TreatmentEvent>('event'),
        repository.list<ChemotherapyTemplate>('chemotherapyTemplate'),
        repository.list<ExamRecord>('record'),
        repository.list<ChartPin>('pin'),
        repository.list<AppPreferences>('preferences'),
        repository.list<OcrQueueItem>('ocrJob'),
        repository.list<ReimbursementPlan>('reimbursementPlan'),
      ])
      if (!active) return
      setStorageError(null)
      setEvents(byDateDescending(loadedEvents))
      setChemotherapyTemplates(sortTreatmentTemplates(loadedTemplates))
      const deduplicatedRecords = loadedRecords.map((record) => ({
        ...record,
        images: deduplicateStoredImages(record.images),
      }))
      await Promise.all(deduplicatedRecords
        .filter((record, index) => record.images.length !== loadedRecords[index].images.length)
        .map((record) => repository.put('record', record.id, record)))
      const sortedRecords = byDateDescending(deduplicatedRecords)
      recordsRef.current = sortedRecords
      setRecords(sortedRecords)
      setPins(loadedPins)
      if (loadedPreferences[0]) setPreferences({ ...DEFAULT_PREFERENCES, ...loadedPreferences[0], azure: { ...DEFAULT_PREFERENCES.azure, ...loadedPreferences[0].azure } })
      const resumedJobs = loadedOcrJobs.map((job) => job.status === 'processing' ? { ...job, status: 'queued' as const, phase: 'waiting' as const, progress: 0, error: undefined, updatedAt: new Date().toISOString() } : job).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      ocrJobsRef.current = resumedJobs
      setOcrJobs(resumedJobs)
      const hospitalReimbursementPlans = loadedReimbursementPlans.map(keepHospitalReimbursementMaterials)
      await Promise.all(hospitalReimbursementPlans
        .filter((plan, index) => plan !== loadedReimbursementPlans[index])
        .map((plan) => repository.put('reimbursementPlan', plan.id, plan)))
      const sortedReimbursementPlans = byDateDescending(hospitalReimbursementPlans)
      reimbursementPlansRef.current = sortedReimbursementPlans
      setReimbursementPlans(sortedReimbursementPlans)
      await Promise.all(resumedJobs.filter((job) => loadedOcrJobs.find((loaded) => loaded.id === job.id)?.status === 'processing').map((job) => repository.put('ocrJob', job.id, job)))
      await garbageCollectNativeImages(sortedRecords, resumedJobs, sortedReimbursementPlans)
      setReady(true)
    })().catch((error) => {
      console.error(error)
      if (active) setStorageError(error instanceof Error ? error.message : '无法打开本地数据库')
    })
    return () => { active = false }
  }, [])

  useEffect(() => { recordsRef.current = records }, [records])
  useEffect(() => { reimbursementPlansRef.current = reimbursementPlans }, [reimbursementPlans])

  useEffect(() => {
    document.documentElement.dataset.theme = preferences.darkMode ? 'dark' : 'light'
  }, [preferences.darkMode])

  const saveEvent = useCallback(async (event: TreatmentEvent) => {
    await repository.put('event', event.id, event)
    setEvents((current) => byDateDescending([...current.filter((item) => item.id !== event.id), event]))
  }, [])

  const saveEvents = useCallback(async (nextEvents: TreatmentEvent[]) => {
    for (const event of nextEvents) await repository.put('event', event.id, event)
    const updatedById = new Map(nextEvents.map((event) => [event.id, event]))
    setEvents((current) => byDateDescending([
      ...current.filter((event) => !updatedById.has(event.id)),
      ...nextEvents,
    ]))
  }, [])

  const deleteEvent = useCallback(async (id: string) => {
    await repository.remove('event', id)
    setEvents((current) => current.filter((item) => item.id !== id))
  }, [])

  const saveChemotherapyTemplate = useCallback(async (template: ChemotherapyTemplate) => {
    await repository.put('chemotherapyTemplate', template.id, template)
    setChemotherapyTemplates((current) => sortTreatmentTemplates([
      ...current.filter((item) => item.id !== template.id),
      template,
    ]))
  }, [])

  const reorderChemotherapyTemplates = useCallback(async (orderedIds: string[]) => {
    const orderById = new Map(orderedIds.map((id, index) => [id, index]))
    const reordered = sortTreatmentTemplates(chemotherapyTemplates.map((template) => ({
      ...template,
      sortOrder: orderById.get(template.id) ?? template.sortOrder,
    })))
    await Promise.all(reordered.map((template) => repository.put('chemotherapyTemplate', template.id, template)))
    setChemotherapyTemplates(reordered)
  }, [chemotherapyTemplates])

  const deleteChemotherapyTemplate = useCallback(async (id: string) => {
    await repository.remove('chemotherapyTemplate', id)
    setChemotherapyTemplates((current) => current.filter((item) => item.id !== id))
  }, [])

  const saveRecord = useCallback(async (record: ExamRecord) => {
    const deduplicatedRecord = { ...record, images: deduplicateStoredImages(record.images) }
    await repository.put('record', deduplicatedRecord.id, deduplicatedRecord)
    const linkedEvents = events.filter((event) => event.type === 'examination' && event.linkedRecordIds.includes(deduplicatedRecord.id))
    const updatedEvents = linkedEvents.map((event): TreatmentEvent => ({
      ...event,
      title: deduplicatedRecord.normalizedReportType || deduplicatedRecord.reportType,
      startDate: deduplicatedRecord.examDate,
      endDate: deduplicatedRecord.examDate,
      hospital: deduplicatedRecord.hospital,
      department: deduplicatedRecord.department,
      notes: deduplicatedRecord.summary,
      updatedAt: deduplicatedRecord.updatedAt,
    }))
    await Promise.all(updatedEvents.map((event) => repository.put('event', event.id, event)))
    setRecords((current) => byDateDescending([...current.filter((item) => item.id !== deduplicatedRecord.id), deduplicatedRecord]))
    if (updatedEvents.length) {
      const updatedById = new Map(updatedEvents.map((event) => [event.id, event]))
      setEvents((current) => byDateDescending(current.map((event) => updatedById.get(event.id) ?? event)))
    }
  }, [events])

  const saveImportedRecords = useCallback(async (incoming: ExamRecord[], createdEvents: TreatmentEvent[]) => {
    let added = 0
    let merged = 0
    const nextRecords = [...recordsRef.current]
    const acceptedEvents: TreatmentEvent[] = []
    for (const incomingRecord of incoming) {
      const record = { ...incomingRecord, images: deduplicateStoredImages(incomingRecord.images) }
      const duplicate = nextRecords.find((item) => item.fingerprint === record.fingerprint)
      if (duplicate) {
        const combined = { ...duplicate, images: deduplicateStoredImages([...duplicate.images, ...record.images]), updatedAt: new Date().toISOString(), ocrStatus: 'completed' as const }
        await repository.put('record', combined.id, combined)
        nextRecords.splice(nextRecords.indexOf(duplicate), 1, combined)
        merged += 1
      } else {
        await repository.put('record', record.id, record)
        nextRecords.push(record)
        const linked = createdEvents.find((event) => event.linkedRecordIds.includes(record.id))
        if (linked) {
          const completedRecord = { ...record, linkedEventIds: [linked.id] }
          await repository.put('record', record.id, completedRecord)
          nextRecords.splice(nextRecords.indexOf(record), 1, completedRecord)
          await repository.put('event', linked.id, linked)
          acceptedEvents.push(linked)
        }
        added += 1
      }
    }
    const sortedRecords = byDateDescending(nextRecords)
    recordsRef.current = sortedRecords
    setRecords(sortedRecords)
    setEvents((current) => byDateDescending([...current, ...acceptedEvents]))
    return { added, merged }
  }, [])

  const rerecognizeRecord = useCallback(async (id: string) => {
    const storedRecord = recordsRef.current.find((record) => record.id === id)
    if (!storedRecord) throw new Error('找不到要重新识别的检查记录')
    const original = { ...storedRecord, images: deduplicateStoredImages(storedRecord.images) }
    if (original.images.length === 0) throw new Error('这份记录没有可用于重新识别的原始图片')

    const recognizedRecords: ExamRecord[] = []
    let maximumAttempts = 0
    for (const storedImage of original.images) {
      const image = await materializeStoredImage(storedImage)
      let attempts = 0
      const result = await recognizeReport(image, preferences.azure, (attempt) => {
        attempts = attempt
        maximumAttempts = Math.max(maximumAttempts, attempt)
      }, vocabulary)
      const candidates = await toDomainRecords(result, [], attempts, vocabulary)
      const matching = candidates.find((candidate) =>
        candidate.normalizedReportType === original.normalizedReportType
        || candidate.reportType === original.reportType)
      if (matching) recognizedRecords.push(matching)
      else if (candidates[0]) recognizedRecords.push(candidates[0])
    }

    const updated = mergeRecognizedRecord(original, recognizedRecords, maximumAttempts)
    await saveRecord(updated)
    return updated
  }, [preferences.azure, saveRecord, vocabulary])

  const deleteRecord = useCallback(async (id: string) => {
    const record = records.find((item) => item.id === id)
    await repository.remove('record', id)
    for (const eventId of record?.linkedEventIds ?? []) {
      await repository.remove('event', eventId)
    }
    const nextRecords = records.filter((item) => item.id !== id)
    recordsRef.current = nextRecords
    setRecords(nextRecords)
    setEvents((current) => current.filter((item) => !record?.linkedEventIds.includes(item.id)))
    void garbageCollectNativeImages(nextRecords, ocrJobsRef.current, reimbursementPlansRef.current).catch(console.warn)
  }, [records])

  const saveReimbursementPlan = useCallback(async (plan: ReimbursementPlan) => {
    const hospitalPlan = keepHospitalReimbursementMaterials(plan)
    await repository.put('reimbursementPlan', hospitalPlan.id, hospitalPlan)
    setReimbursementPlans((current) => byDateDescending([
      ...current.filter((item) => item.id !== hospitalPlan.id),
      hospitalPlan,
    ]))
  }, [])

  const deleteReimbursementPlan = useCallback(async (id: string) => {
    await repository.remove('reimbursementPlan', id)
    const nextPlans = reimbursementPlansRef.current.filter((item) => item.id !== id)
    reimbursementPlansRef.current = nextPlans
    setReimbursementPlans(nextPlans)
    void garbageCollectNativeImages(recordsRef.current, ocrJobsRef.current, nextPlans).catch(console.warn)
  }, [])

  const savePin = useCallback(async (pin: ChartPin) => {
    await repository.put('pin', pin.id, pin)
    setPins((current) => [...current.filter((item) => item.id !== pin.id), pin])
  }, [])

  const deletePin = useCallback(async (id: string) => {
    await repository.remove('pin', id)
    setPins((current) => current.filter((item) => item.id !== id))
  }, [])

  const savePreferences = useCallback(async (next: AppPreferences) => {
    await repository.put('preferences', 'main', next)
    setPreferences(next)
  }, [])

  const updateOcrJob = useCallback(async (id: string, changes: Partial<OcrQueueItem>) => {
    const current = ocrJobsRef.current.find((job) => job.id === id)
    if (!current) return
    const next = { ...current, ...changes, id: current.id, updatedAt: new Date().toISOString() }
    const nextJobs = ocrJobsRef.current.map((job) => job.id === id ? next : job)
    ocrJobsRef.current = nextJobs
    setOcrJobs(nextJobs)
    await repository.put('ocrJob', id, next)
  }, [])

  const enqueueOcrImage = useCallback(async (image: StoredImage) => {
    const alreadyStored = recordsRef.current.some((record) => record.images.some((stored) => sameStoredImage(stored, image)))
    const alreadyQueued = ocrJobsRef.current.some((job) => job.status !== 'completed' && sameStoredImage(job.image, image))
    if (alreadyStored || alreadyQueued) return false
    const durableImage = await persistStoredImage(image)
    const now = new Date().toISOString()
    const job: OcrQueueItem = {
      id: newId(),
      image: durableImage,
      status: 'queued',
      phase: 'waiting',
      progress: 0,
      attempts: 0,
      resultRecordIds: [],
      createdAt: now,
      updatedAt: now,
    }
    const nextJobs = [...ocrJobsRef.current, job].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    ocrJobsRef.current = nextJobs
    setOcrJobs(nextJobs)
    await repository.put('ocrJob', job.id, job)
    return true
  }, [])

  const retryOcrJob = useCallback(async (id: string) => {
    await updateOcrJob(id, { status: 'queued', phase: 'waiting', progress: 0, attempts: 0, error: undefined, resultRecordIds: [] })
  }, [updateOcrJob])

  const retryAllFailedOcrJobs = useCallback(async () => {
    const failedIds = ocrJobsRef.current.filter((job) => job.status === 'failed').map((job) => job.id)
    for (const id of failedIds) await updateOcrJob(id, { status: 'queued', phase: 'waiting', progress: 0, attempts: 0, error: undefined, resultRecordIds: [] })
  }, [updateOcrJob])

  const removeOcrJob = useCallback(async (id: string) => {
    const current = ocrJobsRef.current.find((job) => job.id === id)
    if (!current || current.status === 'processing') return
    await repository.remove('ocrJob', id)
    const nextJobs = ocrJobsRef.current.filter((job) => job.id !== id)
    ocrJobsRef.current = nextJobs
    setOcrJobs(nextJobs)
    void garbageCollectNativeImages(recordsRef.current, nextJobs, reimbursementPlansRef.current).catch(console.warn)
  }, [])

  const clearCompletedOcrJobs = useCallback(async () => {
    const completedIds = ocrJobsRef.current.filter((job) => job.status === 'completed').map((job) => job.id)
    await Promise.all(completedIds.map((id) => repository.remove('ocrJob', id)))
    const nextJobs = ocrJobsRef.current.filter((job) => job.status !== 'completed')
    ocrJobsRef.current = nextJobs
    setOcrJobs(nextJobs)
    void garbageCollectNativeImages(recordsRef.current, nextJobs, reimbursementPlansRef.current).catch(console.warn)
  }, [])

  const restoreBackup = useCallback(async (payload: BackupPayload) => {
    const restoredRecords = await persistRestoredRecords(payload.records.map((record) => ({
      ...record,
      images: deduplicateStoredImages(record.images),
    })))
    const restoredReimbursementPlans = await persistRestoredReimbursementPlans((payload.reimbursementPlans ?? []).map(keepHospitalReimbursementMaterials))
    await repository.replaceKind('event', payload.events.map((item) => ({ id: item.id, payload: item })))
    await repository.replaceKind('chemotherapyTemplate', (payload.chemotherapyTemplates ?? []).map((item) => ({ id: item.id, payload: item })))
    await repository.replaceKind('record', restoredRecords.map((item) => ({ id: item.id, payload: item })))
    await repository.replaceKind('pin', payload.pins.map((item) => ({ id: item.id, payload: item })))
    await repository.replaceKind('reimbursementPlan', restoredReimbursementPlans.map((item) => ({ id: item.id, payload: item })))
    const nextPreferences: AppPreferences = {
      ...DEFAULT_PREFERENCES,
      ...payload.preferences,
      azure: { ...DEFAULT_PREFERENCES.azure, ...payload.preferences.azure, apiKey: preferences.azure.apiKey },
    }
    await repository.put('preferences', 'main', nextPreferences)
    setEvents(byDateDescending(payload.events))
    setChemotherapyTemplates(sortTreatmentTemplates(payload.chemotherapyTemplates ?? []))
    const sortedRecords = byDateDescending(restoredRecords)
    recordsRef.current = sortedRecords
    setRecords(sortedRecords)
    setPins(payload.pins)
    const sortedReimbursementPlans = byDateDescending(restoredReimbursementPlans)
    reimbursementPlansRef.current = sortedReimbursementPlans
    setReimbursementPlans(sortedReimbursementPlans)
    setPreferences(nextPreferences)
    void garbageCollectNativeImages(sortedRecords, ocrJobsRef.current, sortedReimbursementPlans).catch(console.warn)
  }, [preferences.azure.apiKey])

  const deduplicateImagesGlobally = useCallback(async (): Promise<ImageDeduplicationResult> => {
    let recordsUpdated = 0
    let imagesRemoved = 0
    const deduplicatedRecords = recordsRef.current.map((record) => {
      const images = deduplicateStoredImages(record.images)
      const removed = record.images.length - images.length
      if (removed === 0) return record
      recordsUpdated += 1
      imagesRemoved += removed
      return { ...record, images }
    })
    const changedRecords = deduplicatedRecords.filter((record, index) => record !== recordsRef.current[index])
    await Promise.all(changedRecords.map((record) => repository.put('record', record.id, record)))
    recordsRef.current = deduplicatedRecords
    setRecords(deduplicatedRecords)
    const filesDeleted = await garbageCollectNativeImages(deduplicatedRecords, ocrJobsRef.current, reimbursementPlansRef.current)
    return {
      recordsScanned: deduplicatedRecords.length,
      recordsUpdated,
      imagesRemoved,
      filesDeleted,
    }
  }, [])

  useEffect(() => {
    const azure = preferences.azure
    const configured = Boolean(azure.endpoint.trim() && azure.apiKey.trim() && azure.deployment.trim() && azure.apiVersion.trim())
    if (!ready || !configured || processingOcrRef.current) return
    const nextJob = ocrJobsRef.current.find((job) => job.status === 'queued')
    if (!nextJob) return

    processingOcrRef.current = true
    void (async () => {
      let attempts = 0
      try {
        await updateOcrJob(nextJob.id, { status: 'processing', phase: 'recognizing', progress: 5, error: undefined })
        const readyImage = await materializeStoredImage(nextJob.image)
        const durableImage = await persistStoredImage(readyImage)
        await updateOcrJob(nextJob.id, { image: durableImage, progress: 10 })
        const result = await recognizeReport(readyImage, azure, (attempt) => {
          attempts = attempt
          void updateOcrJob(nextJob.id, { attempts: attempt, phase: 'recognizing', progress: Math.min(55, 18 + attempt * 10) })
        }, vocabulary)
        await updateOcrJob(nextJob.id, { attempts, phase: 'saving', progress: 78 })
        const domainRecords = await toDomainRecords(result, [durableImage], attempts, vocabulary)
        const domainEvents = domainRecords.map(eventForRecord)
        await saveImportedRecords(domainRecords, domainEvents)
        await updateOcrJob(nextJob.id, {
          status: 'completed',
          phase: 'done',
          progress: 100,
          attempts,
          error: undefined,
          resultRecordIds: domainRecords.map((record) => record.id),
        })
        // Keep the completed item in this session for progress feedback, but do
        // not persist another full copy of its image across future launches.
        await repository.remove('ocrJob', nextJob.id)
      } catch (error) {
        await updateOcrJob(nextJob.id, {
          status: 'failed',
          phase: 'error',
          progress: 100,
          attempts,
          error: error instanceof Error ? error.message : '识别失败，请重试',
        })
      } finally {
        processingOcrRef.current = false
        setOcrJobs([...ocrJobsRef.current])
      }
    })()
  }, [ready, ocrJobs, preferences.azure, vocabulary, saveImportedRecords, updateOcrJob])

  const ocrQueueStats = useMemo<OcrQueueStats>(() => {
    const total = ocrJobs.length
    const queued = ocrJobs.filter((job) => job.status === 'queued').length
    const processing = ocrJobs.filter((job) => job.status === 'processing').length
    const completed = ocrJobs.filter((job) => job.status === 'completed').length
    const failed = ocrJobs.filter((job) => job.status === 'failed').length
    const progress = total ? Math.round(ocrJobs.reduce((sum, job) => sum + job.progress, 0) / total) : 0
    return { total, queued, processing, completed, failed, progress }
  }, [ocrJobs])

  const value = useMemo<AppState>(() => ({
    ready,
    startupMessage,
    storageError,
    storageLabel: repository.native ? 'SQLite（本机）' : 'IndexedDB（浏览器）',
    events,
    chemotherapyTemplates,
    records,
    reimbursementPlans,
    pins,
    ocrJobs,
    ocrQueueStats,
    preferences,
    vocabulary,
    saveEvent,
    saveEvents,
    deleteEvent,
    saveChemotherapyTemplate,
    reorderChemotherapyTemplates,
    deleteChemotherapyTemplate,
    saveRecord,
    saveImportedRecords,
    rerecognizeRecord,
    deleteRecord,
    saveReimbursementPlan,
    deleteReimbursementPlan,
    savePin,
    deletePin,
    savePreferences,
    restoreBackup,
    deduplicateImagesGlobally,
    enqueueOcrImage,
    retryOcrJob,
    retryAllFailedOcrJobs,
    removeOcrJob,
    clearCompletedOcrJobs,
  }), [ready, startupMessage, storageError, events, chemotherapyTemplates, records, reimbursementPlans, pins, ocrJobs, ocrQueueStats, preferences, vocabulary, saveEvent, saveEvents, deleteEvent, saveChemotherapyTemplate, reorderChemotherapyTemplates, deleteChemotherapyTemplate, saveRecord, saveImportedRecords, rerecognizeRecord, deleteRecord, saveReimbursementPlan, deleteReimbursementPlan, savePin, deletePin, savePreferences, restoreBackup, deduplicateImagesGlobally, enqueueOcrImage, retryOcrJob, retryAllFailedOcrJobs, removeOcrJob, clearCompletedOcrJobs])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

// Context and hook intentionally share a module so consumers receive one singleton.
// eslint-disable-next-line react-refresh/only-export-components
export function useApp() {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp 必须在 AppProvider 中使用')
  return value
}
