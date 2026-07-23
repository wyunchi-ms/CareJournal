import type { AppPreferences, BackupPayload, ChartPin, ExamRecord, TreatmentEvent } from '../types'
import { makeRecordsPortable } from './imageStorage'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function exportBackup(events: TreatmentEvent[], records: ExamRecord[], pins: ChartPin[], preferences: AppPreferences, password: string) {
  if (password.length < 8) throw new Error('备份密码至少需要 8 位')
  const portableRecords = await makeRecordsPortable(records)
  const payload: BackupPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    events,
    records: portableRecords,
    pins,
    preferences: {
      darkMode: preferences.darkMode,
      chartIndicatorOrder: preferences.chartIndicatorOrder,
      chartPinnedIndicatorCodes: preferences.chartPinnedIndicatorCodes,
      azure: { ...preferences.azure, apiKey: undefined } as Omit<AppPreferences['azure'], 'apiKey'>,
    },
  }
  delete (payload.preferences.azure as Partial<AppPreferences['azure']>).apiKey
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt)
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(payload)))
  const envelope = JSON.stringify({ format: 'carejournal-encrypted-v1', salt: bytesToBase64(salt), iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(encrypted)) })
  return new Blob([envelope], { type: 'application/x-carejournal+json' })
}

export async function importBackup(file: File, password: string): Promise<BackupPayload> {
  try {
    const envelope = JSON.parse(await file.text()) as { format: string; salt: string; iv: string; data: string }
    if (envelope.format !== 'carejournal-encrypted-v1') throw new Error('格式不支持')
    const salt = base64ToBytes(envelope.salt)
    const iv = base64ToBytes(envelope.iv)
    const key = await deriveKey(password, salt)
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, base64ToBytes(envelope.data))
    const payload = JSON.parse(decoder.decode(decrypted)) as BackupPayload
    if (payload.version !== 1 || !Array.isArray(payload.events) || !Array.isArray(payload.records)) throw new Error('备份内容无效')
    return payload
  } catch {
    throw new Error('无法读取备份，请检查文件和密码')
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
