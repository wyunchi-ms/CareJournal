import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { repository } from '../db/repository'
import { eventForRecord, recognizeReport, toDomainRecords } from '../services/ocr'
import type { AppPreferences, BackupPayload, ChartPin, ExamRecord, OcrQueueItem, StoredImage, TreatmentEvent } from '../types'
import { DEFAULT_PREFERENCES, newId } from '../types'

interface OcrQueueStats {
  total: number
  queued: number
  processing: number
  completed: number
  failed: number
  progress: number
}

interface AppState {
  ready: boolean
  storageError: string | null
  storageLabel: string
  events: TreatmentEvent[]
  records: ExamRecord[]
  pins: ChartPin[]
  ocrJobs: OcrQueueItem[]
  ocrQueueStats: OcrQueueStats
  preferences: AppPreferences
  saveEvent: (event: TreatmentEvent) => Promise<void>
  deleteEvent: (id: string) => Promise<void>
  saveRecord: (record: ExamRecord) => Promise<void>
  saveImportedRecords: (records: ExamRecord[], events: TreatmentEvent[]) => Promise<{ added: number; merged: number }>
  deleteRecord: (id: string) => Promise<void>
  savePin: (pin: ChartPin) => Promise<void>
  deletePin: (id: string) => Promise<void>
  savePreferences: (preferences: AppPreferences) => Promise<void>
  restoreBackup: (payload: BackupPayload) => Promise<void>
  enqueueOcrImage: (image: StoredImage) => Promise<boolean>
  retryOcrJob: (id: string) => Promise<void>
  retryAllFailedOcrJobs: () => Promise<void>
  removeOcrJob: (id: string) => Promise<void>
  clearCompletedOcrJobs: () => Promise<void>
}

const AppContext = createContext<AppState | null>(null)

const byDateDescending = <T extends { updatedAt?: string; createdAt?: string }>(items: T[]) =>
  [...items].sort((a, b) => (b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? ''))

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [storageError, setStorageError] = useState<string | null>(null)
  const [events, setEvents] = useState<TreatmentEvent[]>([])
  const [records, setRecords] = useState<ExamRecord[]>([])
  const [pins, setPins] = useState<ChartPin[]>([])
  const [ocrJobs, setOcrJobs] = useState<OcrQueueItem[]>([])
  const [preferences, setPreferences] = useState<AppPreferences>(DEFAULT_PREFERENCES)
  const recordsRef = useRef<ExamRecord[]>([])
  const ocrJobsRef = useRef<OcrQueueItem[]>([])
  const processingOcrRef = useRef(false)

  useEffect(() => {
    let active = true
    Promise.all([
      repository.list<TreatmentEvent>('event'),
      repository.list<ExamRecord>('record'),
      repository.list<ChartPin>('pin'),
      repository.list<AppPreferences>('preferences'),
      repository.list<OcrQueueItem>('ocrJob'),
    ]).then(async ([loadedEvents, loadedRecords, loadedPins, loadedPreferences, loadedOcrJobs]) => {
      if (!active) return
      setStorageError(null)
      setEvents(byDateDescending(loadedEvents))
      const sortedRecords = byDateDescending(loadedRecords)
      recordsRef.current = sortedRecords
      setRecords(sortedRecords)
      setPins(loadedPins)
      if (loadedPreferences[0]) setPreferences({ ...DEFAULT_PREFERENCES, ...loadedPreferences[0], azure: { ...DEFAULT_PREFERENCES.azure, ...loadedPreferences[0].azure } })
      const resumedJobs = loadedOcrJobs.map((job) => job.status === 'processing' ? { ...job, status: 'queued' as const, phase: 'waiting' as const, progress: 0, error: undefined, updatedAt: new Date().toISOString() } : job).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      ocrJobsRef.current = resumedJobs
      setOcrJobs(resumedJobs)
      await Promise.all(resumedJobs.filter((job) => loadedOcrJobs.find((loaded) => loaded.id === job.id)?.status === 'processing').map((job) => repository.put('ocrJob', job.id, job)))
      setReady(true)
    }).catch((error) => {
      console.error(error)
      if (active) setStorageError(error instanceof Error ? error.message : '无法打开本地数据库')
    })
    return () => { active = false }
  }, [])

  useEffect(() => { recordsRef.current = records }, [records])
  useEffect(() => { ocrJobsRef.current = ocrJobs }, [ocrJobs])

  useEffect(() => {
    document.documentElement.dataset.theme = preferences.darkMode ? 'dark' : 'light'
  }, [preferences.darkMode])

  const saveEvent = useCallback(async (event: TreatmentEvent) => {
    await repository.put('event', event.id, event)
    setEvents((current) => byDateDescending([...current.filter((item) => item.id !== event.id), event]))
  }, [])

  const deleteEvent = useCallback(async (id: string) => {
    await repository.remove('event', id)
    setEvents((current) => current.filter((item) => item.id !== id))
  }, [])

  const saveRecord = useCallback(async (record: ExamRecord) => {
    await repository.put('record', record.id, record)
    setRecords((current) => byDateDescending([...current.filter((item) => item.id !== record.id), record]))
  }, [])

  const saveImportedRecords = useCallback(async (incoming: ExamRecord[], createdEvents: TreatmentEvent[]) => {
    let added = 0
    let merged = 0
    const nextRecords = [...recordsRef.current]
    const acceptedEvents: TreatmentEvent[] = []
    for (const record of incoming) {
      const duplicate = nextRecords.find((item) => item.fingerprint === record.fingerprint)
      if (duplicate) {
        const knownHashes = new Set(duplicate.images.map((image) => image.sha256))
        const combined = { ...duplicate, images: [...duplicate.images, ...record.images.filter((image) => !knownHashes.has(image.sha256))], updatedAt: new Date().toISOString(), ocrStatus: 'completed' as const }
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

  const deleteRecord = useCallback(async (id: string) => {
    const record = records.find((item) => item.id === id)
    await repository.remove('record', id)
    for (const eventId of record?.linkedEventIds ?? []) {
      await repository.remove('event', eventId)
    }
    setRecords((current) => current.filter((item) => item.id !== id))
    setEvents((current) => current.filter((item) => !record?.linkedEventIds.includes(item.id)))
  }, [records])

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
    const alreadyStored = recordsRef.current.some((record) => record.images.some((stored) => stored.sha256 === image.sha256))
    const alreadyQueued = ocrJobsRef.current.some((job) => job.status !== 'completed' && job.image.sha256 === image.sha256)
    if (alreadyStored || alreadyQueued) return false
    const now = new Date().toISOString()
    const job: OcrQueueItem = {
      id: newId(),
      image,
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
  }, [])

  const clearCompletedOcrJobs = useCallback(async () => {
    const completedIds = ocrJobsRef.current.filter((job) => job.status === 'completed').map((job) => job.id)
    await Promise.all(completedIds.map((id) => repository.remove('ocrJob', id)))
    const nextJobs = ocrJobsRef.current.filter((job) => job.status !== 'completed')
    ocrJobsRef.current = nextJobs
    setOcrJobs(nextJobs)
  }, [])

  const restoreBackup = useCallback(async (payload: BackupPayload) => {
    await repository.replaceKind('event', payload.events.map((item) => ({ id: item.id, payload: item })))
    await repository.replaceKind('record', payload.records.map((item) => ({ id: item.id, payload: item })))
    await repository.replaceKind('pin', payload.pins.map((item) => ({ id: item.id, payload: item })))
    const nextPreferences: AppPreferences = {
      ...DEFAULT_PREFERENCES,
      ...payload.preferences,
      azure: { ...DEFAULT_PREFERENCES.azure, ...payload.preferences.azure, apiKey: preferences.azure.apiKey },
    }
    await repository.put('preferences', 'main', nextPreferences)
    setEvents(byDateDescending(payload.events))
    setRecords(byDateDescending(payload.records))
    setPins(payload.pins)
    setPreferences(nextPreferences)
  }, [preferences.azure.apiKey])

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
        await updateOcrJob(nextJob.id, { status: 'processing', phase: 'recognizing', progress: 10, error: undefined })
        const result = await recognizeReport(nextJob.image, azure, (attempt) => {
          attempts = attempt
          void updateOcrJob(nextJob.id, { attempts: attempt, phase: 'recognizing', progress: Math.min(55, 18 + attempt * 10) })
        })
        await updateOcrJob(nextJob.id, { attempts, phase: 'saving', progress: 78 })
        const domainRecords = await toDomainRecords(result, [nextJob.image], attempts)
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
  }, [ready, ocrJobs, preferences.azure, saveImportedRecords, updateOcrJob])

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
    storageError,
    storageLabel: repository.native ? 'SQLite（本机）' : 'IndexedDB（浏览器）',
    events,
    records,
    pins,
    ocrJobs,
    ocrQueueStats,
    preferences,
    saveEvent,
    deleteEvent,
    saveRecord,
    saveImportedRecords,
    deleteRecord,
    savePin,
    deletePin,
    savePreferences,
    restoreBackup,
    enqueueOcrImage,
    retryOcrJob,
    retryAllFailedOcrJobs,
    removeOcrJob,
    clearCompletedOcrJobs,
  }), [ready, storageError, events, records, pins, ocrJobs, ocrQueueStats, preferences, saveEvent, deleteEvent, saveRecord, saveImportedRecords, deleteRecord, savePin, deletePin, savePreferences, restoreBackup, enqueueOcrImage, retryOcrJob, retryAllFailedOcrJobs, removeOcrJob, clearCompletedOcrJobs])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

// Context and hook intentionally share a module so consumers receive one singleton.
// eslint-disable-next-line react-refresh/only-export-components
export function useApp() {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp 必须在 AppProvider 中使用')
  return value
}
