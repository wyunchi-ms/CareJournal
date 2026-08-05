import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BackupPasswordRequiredError, exportBackup, importBackup } from '../services/backup'
import { AppProvider, useApp } from '../store/AppContext'
import type { AppPreferences, BackupPayload, ExamRecord, ReimbursementPlan, StoredImage } from '../types'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const repositoryState = vi.hoisted(() => ({
  lists: new Map<string, unknown[]>(),
  replaceKind: vi.fn(async (kind: string, entries: Array<{ id: string; payload: unknown }>) => {
    repositoryState.lists.set(kind, entries.map((entry) => entry.payload))
  }),
}))

vi.mock('../db/repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/repository')>()
  return {
    ...actual,
    repository: {
      native: false,
      removePersistedCompletedOcrJobs: vi.fn(),
      list: vi.fn(async (kind: string) => repositoryState.lists.get(kind) ?? []),
      put: vi.fn(async (kind: string, id: string, payload: unknown) => {
        const values = repositoryState.lists.get(kind)?.filter((item) => (item as { id?: string }).id !== id) ?? []
        repositoryState.lists.set(kind, [...values, payload])
      }),
      remove: vi.fn(async (kind: string, id: string) => {
        repositoryState.lists.set(kind, repositoryState.lists.get(kind)?.filter((item) => (item as { id?: string }).id !== id) ?? [])
      }),
      replaceKind: repositoryState.replaceKind,
    },
  }
})

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

const sha256Hex = async (bytes: Uint8Array) => {
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const digest = await crypto.subtle.digest('SHA-256', source)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function legacyBackupFile(payload: object, password: string) {
  const encoder = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(payload)))
  const envelope = JSON.stringify({
    format: 'carejournal-encrypted-v1',
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted)),
  })
  return new File([envelope], 'legacy.carejournal.json', { type: 'application/json' })
}

function blobFile(blob: Blob, name = 'backup.carejournal.zip') {
  return new File([blob], name, { type: blob.type || 'application/zip' })
}

async function openBackup(blob: Blob) {
  const zip = await JSZip.loadAsync(await blobArrayBuffer(blob))
  const wrapper = JSON.parse(await zip.file('backup.json')!.async('string')) as {
    format: string
    payload: BackupPayload
    assetManifest: Array<{ id: string; path: string; sha256: string; size: number; mimeType: string }>
  }
  return { zip, wrapper }
}

function blobArrayBuffer(blob: Blob) {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

const imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9])
const secondImageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
const sharedHash = await sha256Hex(imageBytes)
const secondHash = await sha256Hex(secondImageBytes)

const sharedImage: StoredImage = {
  id: 'record-image',
  name: '报告.jpg',
  mimeType: 'image/jpeg',
  dataUrl: `data:image/jpeg;base64,${bytesToBase64(imageBytes)}`,
  sha256: sharedHash,
  storagePath: '/private/local.jpg',
  localUri: 'file:///private/local.jpg',
  sourceUri: 'content://secret/source',
  sourceKey: 'secret-source-key',
  relativePath: '../secret-relative.jpg',
}

const secondImage: StoredImage = {
  id: 'record-image-2',
  name: '另一份.png',
  mimeType: 'image/png',
  dataUrl: `data:image/png;base64,${bytesToBase64(secondImageBytes)}`,
  sha256: secondHash,
}

const record: ExamRecord = {
  id: 'record-1',
  reportType: '血常规',
  sampleDate: '2026-07-23',
  indicators: [],
  images: [sharedImage, secondImage],
  linkedEventIds: [],
  fingerprint: 'fingerprint',
  ocrStatus: 'completed',
  ocrAttempts: 1,
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:00:00.000Z',
}

const plan: ReimbursementPlan = {
  id: 'plan-1',
  eventId: 'event-1',
  eventType: 'examination',
  eventTitle: '检查',
  eventDate: '2026-07-23',
  coverage: 'public_medical',
  materials: [{
    id: 'material-1',
    kind: 'test_report',
    label: '检查报告',
    required: true,
    completed: true,
    attachments: [{
      ...sharedImage,
      id: 'attachment-1',
      source: 'record',
      sourceRecordId: record.id,
      createdAt: '2026-07-23T00:00:00.000Z',
    }],
  }],
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:00:00.000Z',
}

const preferences: AppPreferences = {
  llm: {
    activeProvider: 'deepseek',
    providers: {
      deepseek: { endpoint: 'https://api.deepseek.com/v1', apiKey: 'secret-api-key', model: 'deepseek-chat', maxRetries: 3 },
    },
  },
  localPrivacyOcrEnabled: false,
  darkMode: false,
  chartIndicatorOrder: [],
  chartPinnedIndicatorCodes: [],
}

afterEach(() => {
  vi.doUnmock('../services/imageStorage')
  vi.resetModules()
  cleanup()
  repositoryState.lists.clear()
  repositoryState.replaceKind.mockClear()
})

function RestoreHarness({ payload }: { payload: BackupPayload }) {
  const { ready, ocrJobs, restoreBackup } = useApp()
  return <>
    <span>{ready ? `队列 ${ocrJobs.length}` : '加载中'}</span>
    <button onClick={() => void restoreBackup(payload)}>恢复</button>
  </>
}

describe('backup media asset ZIP format', () => {
  it('exports unencrypted ZIP with backup.json and deduplicated binary assets', async () => {
    const blob = await exportBackup([], [], [record], [], [plan], preferences)
    const { zip, wrapper } = await openBackup(blob)
    const backupJson = await zip.file('backup.json')!.async('string')

    expect(blob.type).toBe('application/zip')
    expect(wrapper.format).toBe('carejournal-zip-v1')
    expect(wrapper.payload.version).toBe(2)
    expect(wrapper.payload.assets).toHaveLength(2)
    expect(wrapper.assetManifest).toHaveLength(2)
    expect(zip.file(`assets/${sharedHash}.jpg`)).toBeTruthy()
    expect(zip.file(`assets/${secondHash}.png`)).toBeTruthy()
    expect(wrapper.payload.assets?.every((asset) => asset.dataUrl === '')).toBe(true)
    expect(backupJson).not.toContain('data:image/')
    expect(backupJson).not.toContain('secret-api-key')
    expect(backupJson).not.toContain('/private/local.jpg')
    expect(backupJson).not.toContain('content://secret')
    expect(backupJson).not.toContain('secret-source-key')
    expect(backupJson).not.toContain('secret-relative')

    const imported = await importBackup(blobFile(blob))
    expect(imported.assets).toHaveLength(2)
    expect(imported.assets?.find((asset) => asset.sha256 === sharedHash)?.dataUrl).toBe(sharedImage.dataUrl)
    expect(imported.records[0].images[0]).toMatchObject({ assetId: `sha256:${sharedHash}`, dataUrl: '' })
    expect(imported.reimbursementPlans?.[0].materials[0].attachments[0]).toMatchObject({ assetId: `sha256:${sharedHash}`, dataUrl: '' })
    expect(imported.preferences.llm?.providers.deepseek).not.toHaveProperty('apiKey')
  })

  it('deduplicates identical binary content by sha256 across assets', async () => {
    const duplicateRecord: ExamRecord = {
      ...record,
      images: [{ ...sharedImage, id: 'a' }, { ...sharedImage, id: 'b', name: 'same-copy.jpg' }],
    }

    const blob = await exportBackup([], [], [duplicateRecord], [], [], preferences)
    const { zip, wrapper } = await openBackup(blob)
    const assetEntries = Object.keys(zip.files).filter((name) => name.startsWith('assets/') && !zip.files[name].dir)

    expect(wrapper.payload.assets).toHaveLength(1)
    expect(wrapper.assetManifest).toHaveLength(1)
    expect(assetEntries).toEqual([`assets/${sharedHash}.jpg`])
  })

  it('rejects tampered asset bytes when hash verification fails', async () => {
    const blob = await exportBackup([], [], [record], [], [], preferences)
    const { zip, wrapper } = await openBackup(blob)
    zip.file(wrapper.assetManifest[0].path, new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00]))

    await expect(importBackup(blobFile(await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' })))).rejects.toThrow('备份素材校验失败')
  })

  it('materializes native-stored assets before stripping local-only fields', async () => {
    vi.resetModules()
    vi.doMock('../services/imageStorage', () => ({
      materializeNativeStoredImage: vi.fn(async (image: StoredImage) => ({ ...image, dataUrl: sharedImage.dataUrl })),
    }))
    const { exportBackup: exportWithNativeRead, importBackup: importWithNativeRead } = await import('../services/backup')
    const nativeOnlyRecord: ExamRecord = {
      ...record,
      images: [{ ...sharedImage, dataUrl: '', storagePath: 'native/report.jpg', localUri: 'file://native/report.jpg' }],
    }

    const blob = await exportWithNativeRead([], [], [nativeOnlyRecord], [], [], preferences)
    const { wrapper } = await openBackup(blob)
    const imported = await importWithNativeRead(blobFile(blob))

    expect(wrapper.payload.assets?.[0].dataUrl).toBe('')
    expect(JSON.stringify(wrapper)).not.toContain('native/report.jpg')
    expect(imported.assets?.[0].dataUrl).toBe(sharedImage.dataUrl)
  })

  it('repairs stale historical sha256 values from the actual materialized bytes', async () => {
    const staleRecord: ExamRecord = {
      ...record,
      images: [{ ...sharedImage, sha256: 'stale-historical-hash', assetId: 'sha256:stale-historical-hash' }],
    }

    const blob = await exportBackup([], [], [staleRecord], [], [], preferences)
    const { wrapper } = await openBackup(blob)

    expect(wrapper.payload.assets).toHaveLength(1)
    expect(wrapper.payload.assets?.[0]).toMatchObject({ id: `sha256:${sharedHash}`, sha256: sharedHash })
    expect(wrapper.payload.records[0].images[0]).toMatchObject({ assetId: `sha256:${sharedHash}` })
    await expect(importBackup(blobFile(blob))).resolves.toMatchObject({
      assets: [expect.objectContaining({ id: `sha256:${sharedHash}`, sha256: sharedHash })],
    })
  })

  it('deduplicates different stale hashes that resolve to the same actual bytes', async () => {
    const staleRecord: ExamRecord = {
      ...record,
      images: [
        { ...sharedImage, id: 'old-a', sha256: 'old-a', assetId: 'sha256:old-a' },
        { ...sharedImage, id: 'old-b', sha256: 'old-b', assetId: 'sha256:old-b' },
      ],
    }

    const blob = await exportBackup([], [], [staleRecord], [], [], preferences)
    const { wrapper } = await openBackup(blob)

    expect(wrapper.payload.assets).toHaveLength(1)
    expect(wrapper.assetManifest).toHaveLength(1)
    expect(wrapper.payload.records[0].images.every((image) => image.assetId === `sha256:${sharedHash}`)).toBe(true)
  })

  it('rejects unsafe asset paths and undeclared archive entries', async () => {
    const blob = await exportBackup([], [], [record], [], [], preferences)
    const { zip, wrapper } = await openBackup(blob)
    wrapper.assetManifest[0].path = `assets\\${sharedHash}.jpg`
    zip.file('backup.json', JSON.stringify(wrapper))

    await expect(importBackup(blobFile(await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' })))).rejects.toThrow('备份素材路径无效')

    const clean = await openBackup(blob)
    clean.zip.file('assets/unlisted.bin', new Uint8Array([1]))
    await expect(importBackup(blobFile(await clean.zip.generateAsync({ type: 'blob', mimeType: 'application/zip' })))).rejects.toThrow('备份包含未登记素材')
  })

  it('rejects oversized asset manifest entries before reading asset bytes', async () => {
    const blob = await exportBackup([], [], [record], [], [], preferences)
    const { zip, wrapper } = await openBackup(blob)
    wrapper.assetManifest[0].size = 49 * 1024 * 1024
    zip.file('backup.json', JSON.stringify(wrapper))

    await expect(importBackup(blobFile(await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' })))).rejects.toThrow('备份素材大小无效')
  })

  it('rejects duplicate payload IDs, paths, and sha256 values', async () => {
    const blob = await exportBackup([], [], [record], [], [], preferences)
    const duplicateId = await openBackup(blob)
    duplicateId.wrapper.payload.assets![1].id = duplicateId.wrapper.payload.assets![0].id
    duplicateId.wrapper.assetManifest[1].id = duplicateId.wrapper.assetManifest[0].id
    duplicateId.zip.file('backup.json', JSON.stringify(duplicateId.wrapper))
    await expect(importBackup(blobFile(await duplicateId.zip.generateAsync({ type: 'blob', mimeType: 'application/zip' })))).rejects.toThrow('备份素材索引重复')

    const duplicateSha = await openBackup(blob)
    duplicateSha.wrapper.payload.assets![1].sha256 = duplicateSha.wrapper.payload.assets![0].sha256
    duplicateSha.wrapper.payload.assets![1].mimeType = duplicateSha.wrapper.payload.assets![0].mimeType
    duplicateSha.wrapper.assetManifest[1].sha256 = duplicateSha.wrapper.assetManifest[0].sha256
    duplicateSha.wrapper.assetManifest[1].mimeType = duplicateSha.wrapper.assetManifest[0].mimeType
    duplicateSha.wrapper.assetManifest[1].path = `assets/${duplicateSha.wrapper.assetManifest[1].sha256}.jpg`
    duplicateSha.zip.file('backup.json', JSON.stringify(duplicateSha.wrapper))
    await expect(importBackup(blobFile(await duplicateSha.zip.generateAsync({ type: 'blob', mimeType: 'application/zip' })))).rejects.toThrow('重复')

    const duplicatePath = await openBackup(blob)
    duplicatePath.wrapper.assetManifest[1].sha256 = duplicatePath.wrapper.assetManifest[0].sha256
    duplicatePath.wrapper.assetManifest[1].mimeType = duplicatePath.wrapper.assetManifest[0].mimeType
    duplicatePath.wrapper.assetManifest[1].path = duplicatePath.wrapper.assetManifest[0].path
    duplicatePath.zip.file('backup.json', JSON.stringify(duplicatePath.wrapper))
    await expect(importBackup(blobFile(await duplicatePath.zip.generateAsync({ type: 'blob', mimeType: 'application/zip' })))).rejects.toThrow('重复')
  })

  it('rejects unused manifest or payload assets and missing record references', async () => {
    const blob = await exportBackup([], [], [record], [], [], preferences)
    const unused = await openBackup(blob)
    unused.wrapper.payload.records[0].images = unused.wrapper.payload.records[0].images.slice(0, 1)
    unused.zip.file('backup.json', JSON.stringify(unused.wrapper))
    await expect(importBackup(blobFile(await unused.zip.generateAsync({ type: 'blob', mimeType: 'application/zip' })))).rejects.toThrow('备份包含未使用素材')

    const missingReference = await openBackup(blob)
    missingReference.wrapper.payload.records[0].images[0].assetId = 'sha256:missing'
    missingReference.zip.file('backup.json', JSON.stringify(missingReference.wrapper))
    await expect(importBackup(blobFile(await missingReference.zip.generateAsync({ type: 'blob', mimeType: 'application/zip' })))).rejects.toThrow('备份素材引用无效')
  })

  it('rejects MIME extension mismatches and wrong magic bytes', async () => {
    const blob = await exportBackup([], [], [record], [], [], preferences)
    const mismatch = await openBackup(blob)
    mismatch.wrapper.assetManifest[0].mimeType = 'image/png'
    mismatch.wrapper.payload.assets![0].mimeType = 'image/png'
    mismatch.zip.file('backup.json', JSON.stringify(mismatch.wrapper))
    await expect(importBackup(blobFile(await mismatch.zip.generateAsync({ type: 'blob', mimeType: 'application/zip' })))).rejects.toThrow('备份素材类型无效')

    const wrongMagicBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
    const wrongMagicHash = await sha256Hex(wrongMagicBytes)
    const wrongMagic = await openBackup(blob)
    wrongMagic.wrapper.assetManifest[1].mimeType = 'image/png'
    wrongMagic.wrapper.assetManifest[1].sha256 = wrongMagicHash
    wrongMagic.wrapper.assetManifest[1].path = `assets/${wrongMagicHash}.png`
    wrongMagic.wrapper.assetManifest[1].size = wrongMagicBytes.byteLength
    wrongMagic.wrapper.payload.assets![1].mimeType = 'image/png'
    wrongMagic.wrapper.payload.assets![1].sha256 = wrongMagicHash
    wrongMagic.zip.file(wrongMagic.wrapper.assetManifest[1].path, wrongMagicBytes)
    wrongMagic.zip.file('backup.json', JSON.stringify(wrongMagic.wrapper))
    await expect(importBackup(blobFile(await wrongMagic.zip.generateAsync({ type: 'blob', mimeType: 'application/zip' })))).rejects.toThrow('备份素材类型无效')
  })

  it('rejects oversized compressed backup files before JSZip parsing', async () => {
    await expect(importBackup({ size: 128 * 1024 * 1024 + 1, type: 'application/zip', name: 'too-large.zip' } as File)).rejects.toThrow('备份文件过大')
  })

  it('restore fully clears persisted and in-memory OCR jobs and prunes old assets', async () => {
    repositoryState.lists.set('ocrJob', [{
      id: 'old-job',
      image: { ...sharedImage, assetId: `sha256:${sharedHash}` },
      status: 'queued',
      phase: 'waiting',
      progress: 0,
      attempts: 0,
      resultRecordIds: [],
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
    }])
    repositoryState.lists.set('asset', [{
      id: 'sha256:old',
      name: 'old.jpg',
      mimeType: 'image/jpeg',
      dataUrl: sharedImage.dataUrl,
      sha256: 'old',
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
    }])
    const payload: BackupPayload = {
      version: 2,
      exportedAt: '2026-07-23T00:00:00.000Z',
      events: [],
      chemotherapyTemplates: [],
      records: [{ ...record, images: [{ ...sharedImage, assetId: `sha256:${sharedHash}`, dataUrl: '' }] }],
      pins: [],
      reimbursementPlans: [],
      assets: [{
        id: `sha256:${sharedHash}`,
        name: sharedImage.name,
        mimeType: sharedImage.mimeType,
        dataUrl: sharedImage.dataUrl,
        sha256: sharedHash,
        createdAt: '2026-07-23T00:00:00.000Z',
        updatedAt: '2026-07-23T00:00:00.000Z',
      }],
      preferences,
    }

    render(<AppProvider><RestoreHarness payload={payload} /></AppProvider>)
    await screen.findByText('队列 1')
    screen.getByRole('button', { name: '恢复' }).click()

    await waitFor(() => expect(screen.getByText('队列 0')).toBeInTheDocument())
    expect(repositoryState.replaceKind).toHaveBeenCalledWith('ocrJob', [])
    expect(repositoryState.lists.get('ocrJob')).toEqual([])
    expect(repositoryState.lists.get('asset')).toHaveLength(1)
    expect((repositoryState.lists.get('asset')![0] as { id: string }).id).toBe(`sha256:${sharedHash}`)
  })

  it('rejects malformed legacy encryption parameters before key derivation', async () => {
    const malformed = new File([JSON.stringify({
      format: 'carejournal-encrypted-v1',
      salt: bytesToBase64(new Uint8Array(8)),
      iv: bytesToBase64(new Uint8Array(12)),
      data: bytesToBase64(new Uint8Array(16)),
    })], 'legacy.json', { type: 'application/json' })

    await expect(importBackup(malformed, { password: 'password-123' })).rejects.toThrow('备份文件内容无效')
  })

  it('requires a typed password error for legacy encrypted backups and decrypts with a password', async () => {
    const legacyPayload: BackupPayload = {
      version: 1,
      exportedAt: '2026-07-23T00:00:00.000Z',
      events: [],
      records: [record],
      pins: [],
      reimbursementPlans: [plan],
      preferences: {
        darkMode: false,
        localPrivacyOcrEnabled: false,
        chartIndicatorOrder: [],
        chartPinnedIndicatorCodes: [],
        azure: { endpoint: '', deployment: '', apiVersion: '2024-10-21', maxRetries: 3 },
      },
    }
    const file = await legacyBackupFile(legacyPayload, 'password-123')

    await expect(importBackup(file)).rejects.toBeInstanceOf(BackupPasswordRequiredError)
    const imported = await importBackup(file, { password: 'password-123' })

    expect(imported.version).toBe(1)
    expect(imported.records[0].images[0].dataUrl).toBe(sharedImage.dataUrl)
    expect(imported.assets).toBeUndefined()
    expect(JSON.stringify(imported)).not.toContain('content://secret')
  })
})
