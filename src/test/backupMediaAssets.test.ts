import { describe, expect, it } from 'vitest'
import { exportBackup, importBackup } from '../services/backup'
import type { AppPreferences, ExamRecord, ReimbursementPlan, StoredImage } from '../types'

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary)
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
  return { text: async () => envelope } as File
}

const sharedImage: StoredImage = {
  id: 'record-image',
  name: '报告.jpg',
  mimeType: 'image/jpeg',
  dataUrl: 'data:image/jpeg;base64,YQ==',
  sha256: 'shared-hash',
}

const record: ExamRecord = {
  id: 'record-1',
  reportType: '血常规',
  examDate: '2026-07-23',
  indicators: [],
  images: [sharedImage],
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
  azure: { endpoint: '', apiKey: 'secret', deployment: '', apiVersion: '2024-10-21', maxRetries: 3 },
  darkMode: false,
  chartIndicatorOrder: [],
  chartPinnedIndicatorCodes: [],
}

describe('backup media asset format', () => {
  it('writes shared record and reimbursement content once in v2', async () => {
    const blob = await exportBackup([], [], [record], [], [plan], preferences, 'password-123')
    const envelope = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(blob)
    })
    const payload = await importBackup({ text: async () => envelope } as File, 'password-123')

    expect(payload.version).toBe(2)
    expect(payload.assets).toHaveLength(1)
    expect(payload.assets?.[0].dataUrl).toBe(sharedImage.dataUrl)
    expect(payload.records[0].images[0]).toMatchObject({ assetId: 'sha256:shared-hash', dataUrl: '' })
    expect(payload.reimbursementPlans?.[0].materials[0].attachments[0])
      .toMatchObject({ assetId: 'sha256:shared-hash', dataUrl: '' })
    expect(JSON.stringify(payload).match(/data:image\/jpeg/g)).toHaveLength(1)
    expect(payload.preferences.azure).not.toHaveProperty('apiKey')
  })

  it('continues accepting existing v1 backups for migration', async () => {
    const legacyPayload = {
      version: 1,
      exportedAt: '2026-07-23T00:00:00.000Z',
      events: [],
      records: [record],
      pins: [],
      reimbursementPlans: [plan],
      preferences: {
        darkMode: false,
        chartIndicatorOrder: [],
        chartPinnedIndicatorCodes: [],
        azure: { endpoint: '', deployment: '', apiVersion: '2024-10-21', maxRetries: 3 },
      },
    }

    const imported = await importBackup(await legacyBackupFile(legacyPayload, 'password-123'), 'password-123')

    expect(imported.version).toBe(1)
    expect(imported.records[0].images[0].dataUrl).toBe(sharedImage.dataUrl)
    expect(imported.assets).toBeUndefined()
  })
})
