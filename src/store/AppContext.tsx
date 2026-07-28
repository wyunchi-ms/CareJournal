import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { repository } from '../db/repository'
import { eventForRecord, mergeRecognizedRecord, recognizeReport, recognizeReportText, toDomainRecords } from '../services/ocr'
import { materializeStoredImage } from '../services/folderImport'
import { deduplicateStoredImages, sameStoredImage } from '../services/images'
import { garbageCollectNativeImages, migrateLegacyNativeImages, persistRestoredRecords, persistRestoredReimbursementPlans, persistStoredImage } from '../services/imageStorage'
import { compactOcrJobMedia, compactRecordMedia, compactReimbursementMedia, reconcileMediaCatalog } from '../services/mediaAssets'
import { extractPdfText } from '../services/pdf'
import { sortChartPins } from '../services/chartPins'
import { buildVocabulary } from '../services/vocabulary'
import { keepHospitalReimbursementMaterials } from '../services/reimbursement'
import type { AppPreferences, BackupPayload, ChartPin, ChemotherapyTemplate, DynamicVocabulary, ExamRecord, MediaAsset, OcrQueueItem, ReimbursementPlan, StoredImage, TreatmentEvent } from '../types'
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
  reimbursementPlansScanned: number
  recordsUpdated: number
  reimbursementPlansUpdated: number
  imagesRemoved: number
  attachmentsRemoved: number
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
  reorderPins: (orderedIds: string[]) => Promise<void>
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
  const pinsRef = useRef<ChartPin[]>([])
  const ocrJobsRef = useRef<OcrQueueItem[]>([])
  const mediaAssetsRef = useRef<MediaAsset[]>([])
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
      const [loadedEvents, loadedTemplates, loadedRecords, loadedPins, loadedPreferences, loadedOcrJobs, loadedReimbursementPlans, loadedAssets] = await Promise.all([
        repository.list<TreatmentEvent>('event'),
        repository.list<ChemotherapyTemplate>('chemotherapyTemplate'),
        repository.list<ExamRecord>('record'),
        repository.list<ChartPin>('pin'),
        repository.list<AppPreferences>('preferences'),
        repository.list<OcrQueueItem>('ocrJob'),
        repository.list<ReimbursementPlan>('reimbursementPlan'),
        repository.list<MediaAsset>('asset'),
      ])
      if (!active) return
      setStorageError(null)
      setEvents(byDateDescending(loadedEvents))
      setChemotherapyTemplates(sortTreatmentTemplates(loadedTemplates))
      const sortedPins = sortChartPins(loadedPins)
      pinsRef.current = sortedPins
      setPins(sortedPins)
      if (loadedPreferences[0]) setPreferences({ ...DEFAULT_PREFERENCES, ...loadedPreferences[0], azure: { ...DEFAULT_PREFERENCES.azure, ...loadedPreferences[0].azure } })
      const resumedJobs = loadedOcrJobs.map((job) => job.status === 'processing' ? { ...job, status: 'queued' as const, phase: 'waiting' as const, progress: 0, error: undefined, updatedAt: new Date().toISOString() } : job).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      const hospitalReimbursementPlans = loadedReimbursementPlans.map(keepHospitalReimbursementMaterials)
      const catalog = reconcileMediaCatalog(loadedRecords, resumedJobs, hospitalReimbursementPlans, loadedAssets)
      const loadedRecordsById = new Map(loadedRecords.map((record) => [record.id, record]))
      const loadedJobsById = new Map(loadedOcrJobs.map((job) => [job.id, job]))
      const loadedReimbursementPlansById = new Map(loadedReimbursementPlans.map((plan) => [plan.id, plan]))
      await Promise.all(catalog.changedAssets.map((asset) => repository.put('asset', asset.id, asset)))
      await Promise.all(catalog.records
        .filter((record) => JSON.stringify(compactRecordMedia(record)) !== JSON.stringify(loadedRecordsById.get(record.id)))
        .map((record) => repository.put('record', record.id, compactRecordMedia(record))))
      await Promise.all(catalog.jobs
        .filter((job) => JSON.stringify(compactOcrJobMedia(job)) !== JSON.stringify(loadedJobsById.get(job.id)))
        .map((job) => repository.put('ocrJob', job.id, compactOcrJobMedia(job))))
      await Promise.all(catalog.reimbursementPlans
        .filter((plan) => JSON.stringify(compactReimbursementMedia(plan)) !== JSON.stringify(loadedReimbursementPlansById.get(plan.id)))
        .map((plan) => repository.put('reimbursementPlan', plan.id, compactReimbursementMedia(plan))))
      mediaAssetsRef.current = catalog.assets
      const sortedRecords = byDateDescending(catalog.records)
      recordsRef.current = sortedRecords
      setRecords(sortedRecords)
      ocrJobsRef.current = catalog.jobs
      setOcrJobs(catalog.jobs)
      const sortedReimbursementPlans = byDateDescending(catalog.reimbursementPlans)
      reimbursementPlansRef.current = sortedReimbursementPlans
      setReimbursementPlans(sortedReimbursementPlans)
      await garbageCollectNativeImages(sortedRecords, catalog.jobs, sortedReimbursementPlans)
      setReady(true)
    })().catch((error) => {
      console.error(error)
      if (active) setStorageError(error instanceof Error ? error.message : '无法打开本地数据库')
    })
    return () => { active = false }
  }, [])

  useEffect(() => { recordsRef.current = records }, [records])
  useEffect(() => { reimbursementPlansRef.current = reimbursementPlans }, [reimbursementPlans])
  useEffect(() => { pinsRef.current = pins }, [pins])

  useEffect(() => {
    document.documentElement.dataset.theme = preferences.darkMode ? 'dark' : 'light'
  }, [preferences.darkMode])

  const storeCatalogAssets = useCallback(async (assets: MediaAsset[], changedAssets: MediaAsset[]) => {
    await Promise.all(changedAssets.map((asset) => repository.put('asset', asset.id, asset)))
    mediaAssetsRef.current = assets
  }, [])

  const registerRecordMedia = useCallback(async (record: ExamRecord) => {
    const durableRecord = { ...record, images: await Promise.all(record.images.map(persistStoredImage)) }
    const catalog = reconcileMediaCatalog([durableRecord], [], [], mediaAssetsRef.current)
    await storeCatalogAssets(catalog.assets, catalog.changedAssets)
    return catalog.records[0]
  }, [storeCatalogAssets])

  const registerOcrJobMedia = useCallback(async (job: OcrQueueItem) => {
    const durableJob = { ...job, image: await persistStoredImage(job.image) }
    const catalog = reconcileMediaCatalog([], [durableJob], [], mediaAssetsRef.current)
    await storeCatalogAssets(catalog.assets, catalog.changedAssets)
    return catalog.jobs[0]
  }, [storeCatalogAssets])

  const registerReimbursementMedia = useCallback(async (plan: ReimbursementPlan) => {
    const materials: ReimbursementPlan['materials'] = []
    for (const material of plan.materials) {
      const attachments: typeof material.attachments = []
      for (const attachment of material.attachments) attachments.push({ ...attachment, ...await persistStoredImage(attachment) })
      materials.push({ ...material, attachments })
    }
    const catalog = reconcileMediaCatalog([], [], [{ ...plan, materials }], mediaAssetsRef.current)
    await storeCatalogAssets(catalog.assets, catalog.changedAssets)
    return catalog.reimbursementPlans[0]
  }, [storeCatalogAssets])

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
    const deduplicatedRecord = await registerRecordMedia({ ...record, images: deduplicateStoredImages(record.images) })
    await repository.put('record', deduplicatedRecord.id, compactRecordMedia(deduplicatedRecord))
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
  }, [events, registerRecordMedia])

  const saveImportedRecords = useCallback(async (incoming: ExamRecord[], createdEvents: TreatmentEvent[]) => {
    let added = 0
    let merged = 0
    const nextRecords = [...recordsRef.current]
    const acceptedEvents: TreatmentEvent[] = []
    for (const incomingRecord of incoming) {
      const record = await registerRecordMedia({ ...incomingRecord, images: deduplicateStoredImages(incomingRecord.images) })
      const duplicate = nextRecords.find((item) => item.fingerprint === record.fingerprint)
      if (duplicate) {
        const combined = await registerRecordMedia({ ...duplicate, images: deduplicateStoredImages([...duplicate.images, ...record.images]), updatedAt: new Date().toISOString(), ocrStatus: 'completed' as const })
        await repository.put('record', combined.id, compactRecordMedia(combined))
        nextRecords.splice(nextRecords.indexOf(duplicate), 1, combined)
        merged += 1
      } else {
        await repository.put('record', record.id, compactRecordMedia(record))
        nextRecords.push(record)
        const linked = createdEvents.find((event) => event.linkedRecordIds.includes(record.id))
        if (linked) {
          const completedRecord = { ...record, linkedEventIds: [linked.id] }
          await repository.put('record', record.id, compactRecordMedia(completedRecord))
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
  }, [registerRecordMedia])

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
      const onAttempt = (attempt: number) => {
        attempts = attempt
        maximumAttempts = Math.max(maximumAttempts, attempt)
      }
      const result = image.mimeType === 'application/pdf'
        ? await recognizeReportText((await extractPdfText(image)).text, image.name, preferences.azure, onAttempt, vocabulary)
        : await recognizeReport(image, preferences.azure, onAttempt, vocabulary)
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
    const hospitalPlan = await registerReimbursementMedia(keepHospitalReimbursementMaterials(plan))
    await repository.put('reimbursementPlan', hospitalPlan.id, compactReimbursementMedia(hospitalPlan))
    setReimbursementPlans((current) => byDateDescending([
      ...current.filter((item) => item.id !== hospitalPlan.id),
      hospitalPlan,
    ]))
  }, [registerReimbursementMedia])

  const deleteReimbursementPlan = useCallback(async (id: string) => {
    await repository.remove('reimbursementPlan', id)
    const nextPlans = reimbursementPlansRef.current.filter((item) => item.id !== id)
    reimbursementPlansRef.current = nextPlans
    setReimbursementPlans(nextPlans)
    void garbageCollectNativeImages(recordsRef.current, ocrJobsRef.current, nextPlans).catch(console.warn)
  }, [])

  const savePin = useCallback(async (pin: ChartPin) => {
    const existing = pinsRef.current.find((item) => item.id === pin.id)
    const orderedPins = sortChartPins(pinsRef.current)
    const firstOrder = orderedPins.find((item) => Number.isFinite(item.sortOrder))?.sortOrder
    const normalizedPin = {
      ...pin,
      sortOrder: pin.sortOrder ?? existing?.sortOrder ?? (firstOrder === undefined ? -1 : firstOrder - 1),
    }
    await repository.put('pin', normalizedPin.id, normalizedPin)
    const nextPins = sortChartPins([...pinsRef.current.filter((item) => item.id !== normalizedPin.id), normalizedPin])
    pinsRef.current = nextPins
    setPins(nextPins)
  }, [])

  const reorderPins = useCallback(async (orderedIds: string[]) => {
    const orderById = new Map(orderedIds.map((id, index) => [id, index]))
    const reordered = sortChartPins(pinsRef.current.map((pin) => ({
      ...pin,
      sortOrder: orderById.get(pin.id) ?? orderedIds.length + pinsRef.current.indexOf(pin),
    })))
    await Promise.all(reordered.map((pin) => repository.put('pin', pin.id, pin)))
    pinsRef.current = reordered
    setPins(reordered)
  }, [])

  const deletePin = useCallback(async (id: string) => {
    await repository.remove('pin', id)
    const nextPins = pinsRef.current.filter((item) => item.id !== id)
    pinsRef.current = nextPins
    setPins(nextPins)
  }, [])

  const savePreferences = useCallback(async (next: AppPreferences) => {
    await repository.put('preferences', 'main', next)
    setPreferences(next)
  }, [])

  const updateOcrJob = useCallback(async (id: string, changes: Partial<OcrQueueItem>) => {
    const current = ocrJobsRef.current.find((job) => job.id === id)
    if (!current) return
    const next = await registerOcrJobMedia({ ...current, ...changes, id: current.id, updatedAt: new Date().toISOString() })
    const nextJobs = ocrJobsRef.current.map((job) => job.id === id ? next : job)
    ocrJobsRef.current = nextJobs
    setOcrJobs(nextJobs)
    await repository.put('ocrJob', id, compactOcrJobMedia(next))
  }, [registerOcrJobMedia])

  const enqueueOcrImage = useCallback(async (image: StoredImage) => {
    const alreadyStored = recordsRef.current.some((record) => record.images.some((stored) => sameStoredImage(stored, image)))
    const alreadyQueued = ocrJobsRef.current.some((job) => job.status !== 'completed' && sameStoredImage(job.image, image))
    if (alreadyStored || alreadyQueued) return false
    const now = new Date().toISOString()
    const job = await registerOcrJobMedia({
      id: newId(),
      image,
      status: 'queued',
      phase: 'waiting',
      progress: 0,
      attempts: 0,
      resultRecordIds: [],
      createdAt: now,
      updatedAt: now,
    })
    const nextJobs = [...ocrJobsRef.current, job].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    ocrJobsRef.current = nextJobs
    setOcrJobs(nextJobs)
    await repository.put('ocrJob', job.id, compactOcrJobMedia(job))
    return true
  }, [registerOcrJobMedia])

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
    const legacyRecords = payload.records.map((record) => ({ ...record, images: deduplicateStoredImages(record.images) }))
    const legacyPlans = (payload.reimbursementPlans ?? []).map(keepHospitalReimbursementMaterials)
    const restoredRecords = payload.version === 1 ? await persistRestoredRecords(legacyRecords) : legacyRecords
    const restoredReimbursementPlans = payload.version === 1 ? await persistRestoredReimbursementPlans(legacyPlans) : legacyPlans
    const restoredAssets: MediaAsset[] = []
    for (const asset of payload.assets ?? []) {
      const persisted = await persistStoredImage(asset)
      restoredAssets.push({ ...asset, ...persisted, id: asset.id, createdAt: asset.createdAt, updatedAt: asset.updatedAt })
    }
    const assetSeeds = new Map([...mediaAssetsRef.current, ...restoredAssets].map((asset) => [asset.id, asset]))
    const catalog = reconcileMediaCatalog(restoredRecords, ocrJobsRef.current, restoredReimbursementPlans, [...assetSeeds.values()])
    await repository.replaceKind('asset', catalog.assets.map((asset) => ({ id: asset.id, payload: asset })))
    await repository.replaceKind('event', payload.events.map((item) => ({ id: item.id, payload: item })))
    await repository.replaceKind('chemotherapyTemplate', (payload.chemotherapyTemplates ?? []).map((item) => ({ id: item.id, payload: item })))
    await repository.replaceKind('record', catalog.records.map((item) => ({ id: item.id, payload: compactRecordMedia(item) })))
    await repository.replaceKind('pin', payload.pins.map((item) => ({ id: item.id, payload: item })))
    await repository.replaceKind('reimbursementPlan', catalog.reimbursementPlans.map((item) => ({ id: item.id, payload: compactReimbursementMedia(item) })))
    await Promise.all(catalog.changedJobs.map((job) => repository.put('ocrJob', job.id, compactOcrJobMedia(job))))
    const nextPreferences: AppPreferences = {
      ...DEFAULT_PREFERENCES,
      ...payload.preferences,
      azure: { ...DEFAULT_PREFERENCES.azure, ...payload.preferences.azure, apiKey: preferences.azure.apiKey },
    }
    await repository.put('preferences', 'main', nextPreferences)
    setEvents(byDateDescending(payload.events))
    setChemotherapyTemplates(sortTreatmentTemplates(payload.chemotherapyTemplates ?? []))
    mediaAssetsRef.current = catalog.assets
    const sortedRecords = byDateDescending(catalog.records)
    recordsRef.current = sortedRecords
    setRecords(sortedRecords)
    const restoredPins = sortChartPins(payload.pins)
    pinsRef.current = restoredPins
    setPins(restoredPins)
    ocrJobsRef.current = catalog.jobs
    setOcrJobs(catalog.jobs)
    const sortedReimbursementPlans = byDateDescending(catalog.reimbursementPlans)
    reimbursementPlansRef.current = sortedReimbursementPlans
    setReimbursementPlans(sortedReimbursementPlans)
    setPreferences(nextPreferences)
    void garbageCollectNativeImages(sortedRecords, ocrJobsRef.current, sortedReimbursementPlans).catch(console.warn)
  }, [preferences.azure.apiKey])

  const deduplicateImagesGlobally = useCallback(async (): Promise<ImageDeduplicationResult> => {
    const catalog = reconcileMediaCatalog(recordsRef.current, ocrJobsRef.current, reimbursementPlansRef.current, mediaAssetsRef.current)
    await storeCatalogAssets(catalog.assets, catalog.changedAssets)
    await Promise.all(catalog.changedRecords.map((record) => repository.put('record', record.id, compactRecordMedia(record))))
    await Promise.all(catalog.changedJobs.map((job) => repository.put('ocrJob', job.id, compactOcrJobMedia(job))))
    await Promise.all(catalog.changedReimbursementPlans.map((plan) => repository.put('reimbursementPlan', plan.id, compactReimbursementMedia(plan))))
    recordsRef.current = catalog.records
    setRecords(catalog.records)
    ocrJobsRef.current = catalog.jobs
    setOcrJobs(catalog.jobs)
    reimbursementPlansRef.current = catalog.reimbursementPlans
    setReimbursementPlans(catalog.reimbursementPlans)
    const filesDeleted = await garbageCollectNativeImages(catalog.records, catalog.jobs, catalog.reimbursementPlans)
    return {
      recordsScanned: catalog.records.length,
      reimbursementPlansScanned: catalog.reimbursementPlans.length,
      recordsUpdated: catalog.changedRecords.length,
      reimbursementPlansUpdated: catalog.changedReimbursementPlans.length,
      imagesRemoved: catalog.duplicateRecordImagesRemoved,
      attachmentsRemoved: catalog.duplicateReimbursementAttachmentsRemoved,
      filesDeleted,
    }
  }, [storeCatalogAssets])

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
        const isPdf = readyImage.mimeType === 'application/pdf'
        let extractedText = ''
        if (isPdf) {
          await updateOcrJob(nextJob.id, { phase: 'extracting', progress: 16 })
          extractedText = (await extractPdfText(readyImage)).text
          await updateOcrJob(nextJob.id, { phase: 'recognizing', progress: 28 })
        }
        const onAttempt = (attempt: number) => {
          attempts = attempt
          void updateOcrJob(nextJob.id, { attempts: attempt, phase: 'recognizing', progress: Math.min(55, 18 + attempt * 10) })
        }
        const result = isPdf
          ? await recognizeReportText(extractedText, readyImage.name, azure, onAttempt, vocabulary)
          : await recognizeReport(readyImage, azure, onAttempt, vocabulary)
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
    reorderPins,
    deletePin,
    savePreferences,
    restoreBackup,
    deduplicateImagesGlobally,
    enqueueOcrImage,
    retryOcrJob,
    retryAllFailedOcrJobs,
    removeOcrJob,
    clearCompletedOcrJobs,
  }), [ready, startupMessage, storageError, events, chemotherapyTemplates, records, reimbursementPlans, pins, ocrJobs, ocrQueueStats, preferences, vocabulary, saveEvent, saveEvents, deleteEvent, saveChemotherapyTemplate, reorderChemotherapyTemplates, deleteChemotherapyTemplate, saveRecord, saveImportedRecords, rerecognizeRecord, deleteRecord, saveReimbursementPlan, deleteReimbursementPlan, savePin, reorderPins, deletePin, savePreferences, restoreBackup, deduplicateImagesGlobally, enqueueOcrImage, retryOcrJob, retryAllFailedOcrJobs, removeOcrJob, clearCompletedOcrJobs])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

// Context and hook intentionally share a module so consumers receive one singleton.
// eslint-disable-next-line react-refresh/only-export-components
export function useApp() {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp 必须在 AppProvider 中使用')
  return value
}
