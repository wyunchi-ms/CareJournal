import { Capacitor, registerPlugin } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import JSZip from 'jszip'
import type { AppPreferences, BackupPayload, ChartPin, ChemotherapyTemplate, ExamRecord, LlmProviderId, LlmProviderSettings, MediaAsset, ReimbursementPlan, StoredImage, TreatmentEvent } from '../types'
import { materializeNativeStoredImage } from './imageStorage'
import { compactRecordMedia, compactReimbursementMedia, reconcileMediaCatalog } from './mediaAssets'
import { getHarmonyBridge, isHarmonyPlatform } from '../platform/harmonyBridge'
import { isTauriPlatform, tauriInvoke } from '../platform/tauriBridge'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const ZIP_FORMAT = 'carejournal-zip-v1'
const LEGACY_ENCRYPTED_FORMAT = 'carejournal-encrypted-v1'
const MAX_ENTRY_COUNT = 20000
const MAX_BACKUP_FILE_BYTES = 128 * 1024 * 1024
const MAX_BACKUP_JSON_BYTES = 10 * 1024 * 1024
const MAX_ASSET_BYTES = 48 * 1024 * 1024
const MAX_TOTAL_UNCOMPRESSED_BYTES = 128 * 1024 * 1024
const MAX_ENTITY_COUNT = 100000
const ANDROID_PRIVATE_ASSET_PREFIX = 'report-images/'
const SHA256_HEX = /^[a-f0-9]{64}$/
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'])

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
}

const MIME_BY_EXTENSION: Record<string, string> = Object.fromEntries(
  Object.entries(EXTENSION_BY_MIME).map(([mimeType, extension]) => [extension, mimeType]),
)

interface BackupAssetManifestEntry {
  id: string
  name: string
  mimeType: string
  size: number
  sha256: string
  path: string
  visualFingerprint?: string
  createdAt: string
  updatedAt: string
}

interface ZipBackupWrapper {
  format: typeof ZIP_FORMAT
  exportedAt: string
  payload: BackupPayload
  assetManifest: BackupAssetManifestEntry[]
}

export interface AndroidBackupZipResult {
  cancelled: boolean
  path?: string
  filename?: string
  assetCount?: number
  bytesWritten?: number
}

interface BackupZipPlugin {
  save(options: {
    filename: string
    payload: BackupPayload
  }): Promise<AndroidBackupZipResult>
}

export interface VerifiedBackupAsset {
  sourceId: string
  sourceAsset: MediaAsset
  id: string
  sha256: string
  size: number
  path: string
}

const BackupZip = registerPlugin<BackupZipPlugin>('BackupZip')

interface ImportBackupOptions {
  password?: string
}

export class BackupPasswordRequiredError extends Error {
  constructor() {
    super('此备份已加密，请输入备份密码')
    this.name = 'BackupPasswordRequiredError'
  }
}

class BackupValidationError extends Error {
  constructor(message = '备份文件内容无效') {
    super(message)
    this.name = 'BackupValidationError'
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

function base64ToBytes(value: string) {
  if (!isValidBase64(value)) throw new BackupValidationError()
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isValidBase64(value: string) {
  return value.length % 4 === 0 && BASE64.test(value)
}

function dataUrlToBytes(dataUrl: string, expectedMimeType: string) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!match) throw new BackupValidationError('备份素材编码无效')
  const [, mimeType, data] = match
  if (mimeType !== expectedMimeType || !isValidBase64(data)) throw new BackupValidationError('备份素材类型无效')
  return base64ToBytes(data)
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: string) {
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`
}

async function sha256Hex(bytes: Uint8Array) {
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const digest = await crypto.subtle.digest('SHA-256', source)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function extensionForAsset(asset: MediaAsset) {
  const known = EXTENSION_BY_MIME[asset.mimeType]
  if (known) return known
  const suffix = asset.name.toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1]
  return suffix && /^[a-z0-9]+$/.test(suffix) ? suffix : 'bin'
}

function validateAllowedMimeType(mimeType: string) {
  if (!Object.hasOwn(EXTENSION_BY_MIME, mimeType)) throw new BackupValidationError('备份素材类型无效')
}

function validateSafeAssetPath(path: string, sha256: string, mimeType: string) {
  validateAllowedMimeType(mimeType)
  if (path.includes('\\') || path.startsWith('/') || path.startsWith('.') || path.includes('..')) throw new BackupValidationError('备份素材路径无效')
  const match = /^assets\/([a-f0-9]{64})\.([a-z0-9]{1,8})$/.exec(path)
  if (!match || match[1] !== sha256) throw new BackupValidationError('备份素材路径无效')
  const extensionMime = MIME_BY_EXTENSION[match[2]]
  if (!extensionMime || extensionMime !== mimeType || match[2] !== EXTENSION_BY_MIME[mimeType]) throw new BackupValidationError('备份素材类型无效')
}

function validateMagicBytes(bytes: Uint8Array, mimeType: string) {
  validateAllowedMimeType(mimeType)
  const ascii = (...values: number[]) => values.every((value, index) => bytes[index] === value)
  if (mimeType === 'image/jpeg') {
    if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new BackupValidationError('备份素材类型无效')
    return
  }
  if (mimeType === 'image/png') {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    if (bytes.length < signature.length || !signature.every((value, index) => bytes[index] === value)) throw new BackupValidationError('备份素材类型无效')
    return
  }
  if (mimeType === 'image/gif') {
    if (!(bytes.length >= 6 && (ascii(0x47, 0x49, 0x46, 0x38, 0x37, 0x61) || ascii(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)))) throw new BackupValidationError('备份素材类型无效')
    return
  }
  if (mimeType === 'image/webp') {
    if (!(bytes.length >= 12 && ascii(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)) throw new BackupValidationError('备份素材类型无效')
    return
  }
  if (mimeType === 'application/pdf') {
    if (!(bytes.length >= 5 && ascii(0x25, 0x50, 0x44, 0x46, 0x2d))) throw new BackupValidationError('备份素材类型无效')
    return
  }
  if (mimeType === 'image/heic' || mimeType === 'image/heif') {
    if (bytes.length < 12 || bytes[4] !== 0x66 || bytes[5] !== 0x74 || bytes[6] !== 0x79 || bytes[7] !== 0x70) throw new BackupValidationError('备份素材类型无效')
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])
    if (!HEIF_BRANDS.has(brand)) throw new BackupValidationError('备份素材类型无效')
  }
}

function stripLocalImageFields<T extends StoredImage>(image: T): T {
  const portable = { ...image }
  delete portable.storagePath
  delete portable.localUri
  delete portable.sourceUri
  delete portable.sourceKey
  delete portable.relativePath
  return portable
}

function stripPortableReferenceFields<T extends StoredImage>(image: T): T {
  const portable = stripLocalImageFields(image)
  delete portable.visualFingerprint
  return portable
}

function stripLocalAssetFields(asset: MediaAsset): MediaAsset {
  const portable = stripLocalImageFields(asset)
  delete portable.pendingSync
  return portable
}

function stripBridgeOnlyAssetFields(asset: MediaAsset): MediaAsset {
  const portable = stripLocalAssetFields(asset)
  portable.dataUrl = ''
  return portable
}

function metadataAssetForAndroid(asset: MediaAsset): MediaAsset {
  const portable = stripBridgeOnlyAssetFields(asset)
  if (!asset.storagePath?.startsWith(ANDROID_PRIVATE_ASSET_PREFIX)) throw new Error(`素材 ${asset.name || asset.id} 缺少本机私有存储路径，无法在 Android 上流式导出`)
  return { ...portable, storagePath: asset.storagePath }
}

function stripRecordLocalFields(record: ExamRecord): ExamRecord {
  return { ...record, images: record.images.map(stripPortableReferenceFields) }
}

function stripPlanLocalFields(plan: ReimbursementPlan): ReimbursementPlan {
  return {
    ...plan,
    materials: plan.materials.map((material) => ({
      ...material,
      attachments: material.attachments.map(stripPortableReferenceFields),
    })),
  }
}

function assertEntityLimits(payload: BackupPayload) {
  const checks = [
    payload.events,
    payload.chemotherapyTemplates ?? [],
    payload.records,
    payload.pins,
    payload.reimbursementPlans ?? [],
    payload.assets ?? [],
  ]
  if (checks.some((items) => !Array.isArray(items) || items.length > MAX_ENTITY_COUNT)) throw new BackupValidationError()
}

function validatePayload(payload: BackupPayload) {
  if (!isRecord(payload)) throw new BackupValidationError()
  if (![1, 2].includes(payload.version) || typeof payload.exportedAt !== 'string') throw new BackupValidationError()
  if (!Array.isArray(payload.events) || !Array.isArray(payload.records) || !Array.isArray(payload.pins) || !isRecord(payload.preferences)) throw new BackupValidationError()
  if (payload.chemotherapyTemplates !== undefined && !Array.isArray(payload.chemotherapyTemplates)) throw new BackupValidationError()
  if (payload.reimbursementPlans !== undefined && !Array.isArray(payload.reimbursementPlans)) throw new BackupValidationError()
  if (payload.version === 2 && !Array.isArray(payload.assets)) throw new BackupValidationError('备份素材索引无效')
  for (const asset of payload.assets ?? []) {
    if (asset.dataUrl && asset.dataUrl.length > MAX_ASSET_BYTES * 2) throw new BackupValidationError('备份素材大小无效')
  }
  assertEntityLimits(payload)
}

function validateWrapper(wrapper: unknown): ZipBackupWrapper {
  if (!isRecord(wrapper) || wrapper.format !== ZIP_FORMAT || typeof wrapper.exportedAt !== 'string') throw new BackupValidationError()
  if (!Array.isArray(wrapper.assetManifest)) throw new BackupValidationError('备份素材索引无效')
  const payload = wrapper.payload as BackupPayload
  validatePayload(payload)
  if (payload.version !== 2 || !Array.isArray(payload.assets)) throw new BackupValidationError('备份素材索引无效')
  if (wrapper.assetManifest.length !== payload.assets.length || wrapper.assetManifest.length > MAX_ENTITY_COUNT) throw new BackupValidationError('备份素材索引无效')
  return wrapper as unknown as ZipBackupWrapper
}

function referencedPayloadAssetIds(payload: BackupPayload) {
  const referenced = new Set<string>()
  const addReference = (image: StoredImage) => {
    if (!image.assetId || typeof image.assetId !== 'string') throw new BackupValidationError('备份素材引用无效')
    referenced.add(image.assetId)
  }
  for (const record of payload.records) for (const image of record.images) addReference(image)
  for (const plan of payload.reimbursementPlans ?? []) {
    for (const material of plan.materials) for (const attachment of material.attachments) addReference(attachment)
  }
  return referenced
}

function portablePreferences(preferences: AppPreferences): BackupPayload['preferences'] {
  const portableProviders = Object.fromEntries(
    Object.entries(preferences.llm.providers).map(([id, settings]) => {
      const portable = { ...(settings as LlmProviderSettings) } as Partial<LlmProviderSettings>
      delete portable.apiKey
      return [id, portable]
    }),
  ) as Partial<Record<LlmProviderId, Omit<LlmProviderSettings, 'apiKey'>>>
  return {
    localPrivacyOcrEnabled: preferences.localPrivacyOcrEnabled,
    darkMode: preferences.darkMode,
    chartIndicatorOrder: preferences.chartIndicatorOrder,
    chartPinnedIndicatorCodes: preferences.chartPinnedIndicatorCodes,
    llm: {
      activeProvider: preferences.llm.activeProvider,
      providers: portableProviders,
    },
  }
}

async function createPortableCatalog(records: ExamRecord[], reimbursementPlans: ReimbursementPlan[]) {
  const catalog = reconcileMediaCatalog(records, [], reimbursementPlans)
  const assets: MediaAsset[] = []
  for (const asset of catalog.assets) {
    const materialized = await materializeNativeStoredImage(asset)
    assets.push(stripLocalAssetFields({
      ...asset,
      ...materialized,
      id: asset.id,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
    }))
  }
  return {
    catalog: {
      ...catalog,
      records: catalog.records.map(stripRecordLocalFields),
      reimbursementPlans: catalog.reimbursementPlans.map(stripPlanLocalFields),
    },
    assets,
  }
}

function remapAssetReferences<T extends StoredImage>(image: T, assetIds: Map<string, string>): T {
  if (!image.assetId) return image
  const assetId = assetIds.get(image.assetId)
  return assetId && assetId !== image.assetId ? { ...image, assetId } : image
}

function remapRecordAssets(record: ExamRecord, assetIds: Map<string, string>): ExamRecord {
  return { ...record, images: record.images.map((image) => remapAssetReferences(image, assetIds)) }
}

function remapPlanAssets(plan: ReimbursementPlan, assetIds: Map<string, string>): ReimbursementPlan {
  return {
    ...plan,
    materials: plan.materials.map((material) => ({
      ...material,
      attachments: material.attachments.map((attachment) => remapAssetReferences(attachment, assetIds)),
    })),
  }
}

export function backupPayloadFromAssets(
  events: TreatmentEvent[],
  chemotherapyTemplates: ChemotherapyTemplate[],
  records: ExamRecord[],
  pins: ChartPin[],
  reimbursementPlans: ReimbursementPlan[],
  preferences: AppPreferences,
  sourceAssets: VerifiedBackupAsset[],
  exportedAt = new Date().toISOString(),
): ZipBackupWrapper {
  const repairedAssetIds = new Map<string, string>()
  const seenAssets = new Set<string>()
  const payloadAssets: MediaAsset[] = []
  const manifest: BackupAssetManifestEntry[] = []

  for (const item of sourceAssets) {
    repairedAssetIds.set(item.sourceId, item.id)
    if (seenAssets.has(item.id)) continue
    seenAssets.add(item.id)
    const asset: MediaAsset = { ...stripBridgeOnlyAssetFields(item.sourceAsset), id: item.id, sha256: item.sha256 }
    payloadAssets.push(asset)
    manifest.push({
      id: asset.id,
      name: asset.name,
      mimeType: asset.mimeType,
      size: item.size,
      sha256: item.sha256,
      path: item.path,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
    })
  }

  const payload: BackupPayload = {
    version: 2,
    exportedAt,
    assets: payloadAssets,
    events,
    chemotherapyTemplates,
    records: records.map((record) => compactRecordMedia(remapRecordAssets(record, repairedAssetIds))),
    pins,
    reimbursementPlans: reimbursementPlans.map((plan) => compactReimbursementMedia(remapPlanAssets(plan, repairedAssetIds))),
    preferences: portablePreferences(preferences),
  }
  return { format: ZIP_FORMAT, exportedAt: payload.exportedAt, payload, assetManifest: manifest }
}

export async function prepareAndroidBackupZipPayload(
  events: TreatmentEvent[],
  chemotherapyTemplates: ChemotherapyTemplate[],
  records: ExamRecord[],
  pins: ChartPin[],
  reimbursementPlans: ReimbursementPlan[],
  preferences: AppPreferences,
) {
  const catalog = reconcileMediaCatalog(records, [], reimbursementPlans)
  const assets = catalog.assets.map(metadataAssetForAndroid)
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    assets,
    events,
    chemotherapyTemplates,
    records: catalog.records.map((record) => compactRecordMedia(stripRecordLocalFields(record))),
    pins,
    reimbursementPlans: catalog.reimbursementPlans.map((plan) => compactReimbursementMedia(stripPlanLocalFields(plan))),
    preferences: portablePreferences(preferences),
  } satisfies BackupPayload
}

export async function exportAndroidBackupZip(
  filename: string,
  events: TreatmentEvent[],
  chemotherapyTemplates: ChemotherapyTemplate[],
  records: ExamRecord[],
  pins: ChartPin[],
  reimbursementPlans: ReimbursementPlan[],
  preferences: AppPreferences,
) {
  if (Capacitor.getPlatform() !== 'android') throw new Error('Android 流式备份仅支持 Android')
  return BackupZip.save({
    filename,
    payload: await prepareAndroidBackupZipPayload(events, chemotherapyTemplates, records, pins, reimbursementPlans, preferences),
  })
}

export async function exportBackup(
  events: TreatmentEvent[],
  chemotherapyTemplates: ChemotherapyTemplate[],
  records: ExamRecord[],
  pins: ChartPin[],
  reimbursementPlans: ReimbursementPlan[],
  preferences: AppPreferences,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _password = '',
) {
  const { catalog, assets } = await createPortableCatalog(records, reimbursementPlans)
  const zip = new JSZip()
  const verifiedAssets: VerifiedBackupAsset[] = []
  const seenContent = new Map<string, string>()

  for (const sourceAsset of assets) {
    validateAllowedMimeType(sourceAsset.mimeType)
    const bytes = dataUrlToBytes(sourceAsset.dataUrl, sourceAsset.mimeType)
    validateMagicBytes(bytes, sourceAsset.mimeType)
    if (bytes.byteLength > MAX_ASSET_BYTES) throw new Error('单个备份素材不能超过 48MiB')
    const sha256 = await sha256Hex(bytes)
    const id = `sha256:${sha256}`
    const asset: MediaAsset = { ...sourceAsset, id, sha256, dataUrl: '' }
    const path = seenContent.get(sha256) ?? `assets/${sha256}.${extensionForAsset(asset)}`
    seenContent.set(sha256, path)
    if (!zip.file(path)) zip.file(path, bytes)
    verifiedAssets.push({ sourceId: sourceAsset.id, sourceAsset, id, sha256, size: bytes.byteLength, path })
  }

  const wrapper = backupPayloadFromAssets(events, chemotherapyTemplates, catalog.records, pins, catalog.reimbursementPlans, preferences, verifiedAssets)
  const backupJson = JSON.stringify(wrapper)
  if (encoder.encode(backupJson).byteLength > MAX_BACKUP_JSON_BYTES) throw new Error('备份索引过大')
  zip.file('backup.json', backupJson)
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/zip' })
}

async function importLegacyEncrypted(text: string, password?: string): Promise<BackupPayload> {
  if (encoder.encode(text).byteLength > MAX_BACKUP_FILE_BYTES) throw new BackupValidationError('备份文件过大')
  let envelope: { format?: string; salt?: string; iv?: string; data?: string }
  try {
    envelope = JSON.parse(text) as typeof envelope
  } catch {
    throw new BackupValidationError('备份文件格式不支持')
  }
  if (envelope.format !== LEGACY_ENCRYPTED_FORMAT) throw new BackupValidationError('备份文件格式不支持')
  if (!password) throw new BackupPasswordRequiredError()
  if (typeof envelope.salt !== 'string' || typeof envelope.iv !== 'string' || typeof envelope.data !== 'string') throw new BackupValidationError()
  try {
    const salt = base64ToBytes(envelope.salt)
    const iv = base64ToBytes(envelope.iv)
    if (salt.byteLength !== 16 || iv.byteLength !== 12) throw new BackupValidationError()
    const key = await deriveKey(password, salt)
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, base64ToBytes(envelope.data))
    const payload = JSON.parse(decoder.decode(decrypted)) as BackupPayload
    validatePayload(payload)
    return sanitizeImportedPayload(payload)
  } catch (error) {
    if (error instanceof BackupValidationError) throw error
    throw new Error('无法读取备份，请检查文件和密码')
  }
}

function sanitizeImportedPayload(payload: BackupPayload): BackupPayload {
  return {
    ...payload,
    assets: payload.assets?.map(stripLocalAssetFields),
    records: payload.records.map(stripRecordLocalFields),
    reimbursementPlans: payload.reimbursementPlans?.map(stripPlanLocalFields),
  }
}

async function verifyAndHydrateZip(wrapper: ZipBackupWrapper, zip: JSZip): Promise<BackupPayload> {
  const manifestById = new Map<string, BackupAssetManifestEntry>()
  const manifestByPath = new Map<string, BackupAssetManifestEntry>()
  const manifestBySha = new Map<string, BackupAssetManifestEntry>()
  let total = encoder.encode(JSON.stringify(wrapper)).byteLength

  for (const entry of wrapper.assetManifest) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.name !== 'string' || typeof entry.mimeType !== 'string') throw new BackupValidationError('备份素材索引无效')
    if (typeof entry.sha256 !== 'string' || !SHA256_HEX.test(entry.sha256) || typeof entry.path !== 'string') throw new BackupValidationError('备份素材索引无效')
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_ASSET_BYTES) throw new BackupValidationError('备份素材大小无效')
    validateSafeAssetPath(entry.path, entry.sha256, entry.mimeType)
    if (manifestById.has(entry.id)) throw new BackupValidationError('备份素材索引重复')
    if (manifestByPath.has(entry.path)) throw new BackupValidationError('备份素材路径重复')
    if (manifestBySha.has(entry.sha256)) throw new BackupValidationError('备份素材校验重复')
    manifestById.set(entry.id, entry)
    const knownPath = manifestByPath.get(entry.path)
    if (knownPath && (knownPath.sha256 !== entry.sha256 || knownPath.size !== entry.size || knownPath.mimeType !== entry.mimeType)) {
      throw new BackupValidationError('备份素材路径重复')
    }
    manifestByPath.set(entry.path, entry)
    manifestBySha.set(entry.sha256, entry)
  }

  const payloadById = new Set<string>()
  const payloadBySha = new Set<string>()
  const referencedAssetIds = referencedPayloadAssetIds(wrapper.payload)
  for (const referencedId of referencedAssetIds) {
    if (!manifestById.has(referencedId)) throw new BackupValidationError('备份素材引用无效')
  }
  if (referencedAssetIds.size !== (wrapper.payload.assets ?? []).length) throw new BackupValidationError('备份包含未使用素材')

  const hydratedAssets: MediaAsset[] = []
  for (const asset of wrapper.payload.assets ?? []) {
    if (!isRecord(asset) || typeof asset.id !== 'string' || typeof asset.sha256 !== 'string' || !SHA256_HEX.test(asset.sha256) || typeof asset.mimeType !== 'string') throw new BackupValidationError('备份素材索引无效')
    validateAllowedMimeType(asset.mimeType)
    if (payloadById.has(asset.id)) throw new BackupValidationError('备份素材索引重复')
    if (payloadBySha.has(asset.sha256)) throw new BackupValidationError('备份素材校验重复')
    if (!referencedAssetIds.has(asset.id)) throw new BackupValidationError('备份包含未使用素材')
    payloadById.add(asset.id)
    payloadBySha.add(asset.sha256)
    const manifest = manifestById.get(asset.id)
    if (!manifest || manifest.sha256 !== asset.sha256 || manifest.mimeType !== asset.mimeType) throw new BackupValidationError('备份素材索引无效')
    if (asset.dataUrl) throw new BackupValidationError('备份索引不能内嵌素材')
    const file = zip.file(manifest.path)
    if (!file) throw new BackupValidationError('备份素材缺失')
    const bytes = await file.async('uint8array')
    total += bytes.byteLength
    if (bytes.byteLength !== manifest.size || bytes.byteLength > MAX_ASSET_BYTES || total > MAX_TOTAL_UNCOMPRESSED_BYTES) throw new BackupValidationError('备份素材大小无效')
    const sha256 = await sha256Hex(bytes)
    if (sha256 !== manifest.sha256) throw new BackupValidationError('备份素材校验失败')
    validateMagicBytes(bytes, manifest.mimeType)
    hydratedAssets.push(stripLocalAssetFields({
      ...asset,
      name: manifest.name,
      mimeType: manifest.mimeType,
      sha256,
      visualFingerprint: manifest.visualFingerprint ?? asset.visualFingerprint,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
      dataUrl: bytesToDataUrl(bytes, manifest.mimeType),
    }))
  }

  const registeredPaths = new Set(wrapper.assetManifest.map((entry) => entry.path))
  for (const file of Object.values(zip.files)) {
    if (file.dir || file.name === 'backup.json') continue
    if (!registeredPaths.has(file.name)) throw new BackupValidationError('备份包含未登记素材')
  }

  for (const referencedId of referencedAssetIds) {
    if (!hydratedAssets.some((asset) => asset.id === referencedId)) throw new BackupValidationError('备份素材引用无效')
  }

  return sanitizeImportedPayload({ ...wrapper.payload, assets: hydratedAssets })
}

async function importZip(file: File): Promise<BackupPayload> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(await blobArrayBuffer(file))
  } catch {
    throw new BackupValidationError('备份文件格式不支持')
  }
  const entries = Object.values(zip.files)
  if (entries.length > MAX_ENTRY_COUNT) throw new BackupValidationError('备份文件条目过多')
  for (const entry of entries) {
    const unsafeName = (entry as { unsafeOriginalName?: string }).unsafeOriginalName
    if (entry.name.includes('\\') || entry.name.startsWith('/') || entry.name.includes('..') || unsafeName?.includes('..') || unsafeName?.includes('\\') || unsafeName?.startsWith('/')) throw new BackupValidationError('备份文件路径无效')
  }
  const backupEntry = zip.file('backup.json')
  if (!backupEntry) throw new BackupValidationError('备份索引缺失')
  const backupBytes = await backupEntry.async('uint8array')
  if (backupBytes.byteLength > MAX_BACKUP_JSON_BYTES) throw new BackupValidationError('备份索引过大')
  try {
    return await verifyAndHydrateZip(validateWrapper(JSON.parse(decoder.decode(backupBytes))), zip)
  } catch (error) {
    if (error instanceof BackupValidationError) throw error
    throw new BackupValidationError()
  }
}

export async function importBackup(file: File, passwordOrOptions?: string | ImportBackupOptions): Promise<BackupPayload> {
  if (file.size > MAX_BACKUP_FILE_BYTES) throw new BackupValidationError('备份文件过大')
  const password = typeof passwordOrOptions === 'string' ? passwordOrOptions : passwordOrOptions?.password
  if (file.type.includes('json') || file.name.toLowerCase().endsWith('.json')) return importLegacyEncrypted(await blobText(file), password)
  try {
    return await importZip(file)
  } catch (zipError) {
    if (!(zipError instanceof BackupValidationError) || zipError.message !== '备份文件格式不支持') throw zipError
    return importLegacyEncrypted(await blobText(file), password)
  }
}

function blobText(blob: Blob) {
  if (typeof blob.text === 'function') return blob.text()
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('无法读取备份文件'))
    reader.readAsText(blob)
  })
}

function blobArrayBuffer(blob: Blob) {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('无法读取备份文件'))
    reader.readAsArrayBuffer(blob)
  })
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
  if (isHarmonyPlatform()) {
    const mimeType = blob.type || 'application/octet-stream'
    return getHarmonyBridge().saveFile(filename, mimeType, await blobBase64(blob))
  }
  if (isTauriPlatform()) {
    return tauriInvoke<string>('desktop_save_file', {
      filename,
      mimeType: blob.type || 'application/octet-stream',
      base64: await blobBase64(blob),
    })
  }
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
