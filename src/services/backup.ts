import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import type { AppPreferences, BackupPayload, ChartPin, ChemotherapyTemplate, ExamRecord, MediaAsset, ReimbursementPlan, TreatmentEvent } from '../types'
import { materializeNativeStoredImage } from './imageStorage'
import { compactRecordMedia, compactReimbursementMedia, reconcileMediaCatalog } from './mediaAssets'

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

export async function exportBackup(events: TreatmentEvent[], chemotherapyTemplates: ChemotherapyTemplate[], records: ExamRecord[], pins: ChartPin[], reimbursementPlans: ReimbursementPlan[], preferences: AppPreferences, password: string) {
  if (password.length < 8) throw new Error('备份密码至少需要 8 位')
  const catalog = reconcileMediaCatalog(records, [], reimbursementPlans)
  const portableAssets: MediaAsset[] = []
  for (const asset of catalog.assets) {
    const materialized = await materializeNativeStoredImage(asset)
    const portable: MediaAsset = {
      ...asset,
      ...materialized,
      id: asset.id,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
    }
    delete portable.storagePath
    delete portable.localUri
    portableAssets.push(portable)
  }
  const payload: BackupPayload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    assets: portableAssets,
    events,
    chemotherapyTemplates,
    records: catalog.records.map(compactRecordMedia),
    pins,
    reimbursementPlans: catalog.reimbursementPlans.map(compactReimbursementMedia),
    preferences: {
      localPrivacyOcrEnabled: preferences.localPrivacyOcrEnabled,
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
    if (![1, 2].includes(payload.version) || !Array.isArray(payload.events) || !Array.isArray(payload.records)) throw new Error('备份内容无效')
    if (payload.version === 2 && !Array.isArray(payload.assets)) throw new Error('备份素材索引无效')
    return payload
  } catch {
    throw new Error('无法读取备份，请检查文件和密码')
  }
}

function blobBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result)
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('无法读取待保存文件'))
    reader.readAsDataURL(blob)
  })
}

export async function downloadBlob(blob: Blob, filename: string) {
  if (Capacitor.isNativePlatform()) {
    const path = `CareJournal/${filename}`
    await Filesystem.writeFile({
      path,
      data: await blobBase64(blob),
      directory: Directory.Documents,
      recursive: true,
    })
    return `Documents/${path}`
  }
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
  return filename
}
