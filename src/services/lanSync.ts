import { normalizeEntityPayload, repository, type EntityKind } from '../db/repository'
import type {
  ChartPin,
  ChemotherapyTemplate,
  ExamRecord,
  LanSyncEntityKind,
  LanSyncMergeSummary,
  LanSyncSnapshot,
  MediaAsset,
  ReimbursementPlan,
  SyncTombstone,
  TreatmentEvent,
} from '../types'
import { materializeStoredImage } from './folderImport'
import { persistStoredImage } from './imageStorage'
import { compactRecordMedia, compactReimbursementMedia, reconcileMediaCatalog } from './mediaAssets'

export interface MergedLanData {
  events: TreatmentEvent[]
  chemotherapyTemplates: ChemotherapyTemplate[]
  records: ExamRecord[]
  pins: ChartPin[]
  reimbursementPlans: ReimbursementPlan[]
  assets: MediaAsset[]
  summary: LanSyncMergeSummary
}

export interface LanEncryptedEnvelope {
  version: 2
  compression: 'gzip' | 'none'
  salt: string
  iv: string
  senderPublicKey: string
  data: string
}

export interface LanCryptoIdentity {
  privateKey: CryptoKey
  publicKey: string
}

const syncedKinds = ['event', 'chemotherapyTemplate', 'record', 'pin', 'reimbursementPlan', 'asset'] as const

const kindFields = {
  event: 'events',
  chemotherapyTemplate: 'chemotherapyTemplates',
  record: 'records',
  pin: 'pins',
  reimbursementPlan: 'reimbursementPlans',
  asset: 'assets',
} as const satisfies Record<LanSyncEntityKind, keyof LanSyncSnapshot>

function timestamp(value: unknown) {
  if (!value || typeof value !== 'object') return 0
  const item = value as { updatedAt?: string; createdAt?: string }
  return Date.parse(item.updatedAt || item.createdAt || '') || 0
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function valueKey(value: unknown) {
  if (isPlainObject(value) && typeof value.id === 'string') return `id:${value.id}`
  return `value:${JSON.stringify(value)}`
}

function deepUnion(older: unknown, newer: unknown): unknown {
  if (Array.isArray(older) && Array.isArray(newer)) {
    const values = new Map<string, unknown>()
    for (const item of older) values.set(valueKey(item), item)
    for (const item of newer) {
      const key = valueKey(item)
      const existing = values.get(key)
      values.set(key, existing === undefined ? item : deepUnion(existing, item))
    }
    return [...values.values()]
  }
  if (isPlainObject(older) && isPlainObject(newer)) {
    const result: Record<string, unknown> = { ...older }
    for (const [key, value] of Object.entries(newer)) {
      const existing = result[key]
      if (existing === undefined || existing === null || existing === '') result[key] = value
      else if (value === undefined || value === null || value === '') continue
      else if ((Array.isArray(existing) && Array.isArray(value)) || (isPlainObject(existing) && isPlainObject(value))) {
        result[key] = deepUnion(existing, value)
      } else {
        result[key] = value
      }
    }
    return result
  }
  return newer ?? older
}

function mergeValues<T extends { id: string }>(
  kind: LanSyncEntityKind,
  local: T[],
  incoming: T[],
  tombstones: Map<string, SyncTombstone>,
  summary: LanSyncMergeSummary,
) {
  const localById = new Map(local.map((item) => [item.id, item]))
  const incomingById = new Map(incoming.map((item) => [item.id, item]))
  const result: T[] = []
  const ids = new Set([...localById.keys(), ...incomingById.keys()])
  for (const id of ids) {
    const localValue = localById.get(id)
    const incomingValue = incomingById.get(id)
    const tombstoneId = `${kind}:${id}`
    const tombstone = tombstones.get(tombstoneId)
    const newestEntityTime = Math.max(timestamp(localValue), timestamp(incomingValue))
    if (tombstone && Date.parse(tombstone.deletedAt) >= newestEntityTime) {
      if (localValue) summary.deleted += 1
      continue
    }
    if (tombstone) tombstones.delete(tombstoneId)
    if (!localValue && incomingValue) {
      result.push(incomingValue)
      summary.added += 1
      continue
    }
    if (localValue && !incomingValue) {
      result.push(localValue)
      summary.unchanged += 1
      continue
    }
    if (!localValue || !incomingValue) continue
    if (JSON.stringify(localValue) === JSON.stringify(incomingValue)) {
      result.push(localValue)
      summary.unchanged += 1
      continue
    }
    const incomingIsNewer = timestamp(incomingValue) >= timestamp(localValue)
    const merged = deepUnion(
      incomingIsNewer ? localValue : incomingValue,
      incomingIsNewer ? incomingValue : localValue,
    ) as T
    result.push(merged)
    summary.conflictsMerged += 1
    if (JSON.stringify(merged) === JSON.stringify(localValue)) summary.unchanged += 1
    else summary.updated += 1
  }
  return result
}

function portableAsset(asset: MediaAsset, dataUrl: string): MediaAsset {
  const result: MediaAsset = { ...asset, dataUrl }
  delete result.storagePath
  delete result.localUri
  delete result.sourceUri
  delete result.sourceKey
  return result
}

export async function createLanSyncSnapshot(deviceName: string): Promise<LanSyncSnapshot> {
  const [events, chemotherapyTemplates, records, pins, reimbursementPlans, assets, tombstones] = await Promise.all([
    repository.list<TreatmentEvent>('event'),
    repository.list<ChemotherapyTemplate>('chemotherapyTemplate'),
    repository.list<ExamRecord>('record'),
    repository.list<ChartPin>('pin'),
    repository.list<ReimbursementPlan>('reimbursementPlan'),
    repository.list<MediaAsset>('asset'),
    repository.list<SyncTombstone>('syncTombstone'),
  ])
  const catalog = reconcileMediaCatalog(records, [], reimbursementPlans, assets, { pruneUnused: true })
  const transferredAssets: MediaAsset[] = []
  for (const asset of catalog.assets) {
    const materialized = await materializeStoredImage(asset)
    transferredAssets.push(portableAsset(asset, materialized.dataUrl))
  }
  return {
    version: 1,
    deviceName,
    createdAt: new Date().toISOString(),
    events,
    chemotherapyTemplates,
    records: catalog.records.map(compactRecordMedia),
    pins,
    reimbursementPlans: catalog.reimbursementPlans.map(compactReimbursementMedia),
    assets: transferredAssets,
    tombstones,
  }
}

async function persistAssets(assets: MediaAsset[]) {
  const persisted: MediaAsset[] = []
  for (const asset of assets) {
    const stored = await persistStoredImage(asset)
    persisted.push({
      ...asset,
      ...stored,
      id: asset.id,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
    })
  }
  return persisted
}

export async function mergeLanSyncSnapshot(incoming: LanSyncSnapshot): Promise<MergedLanData> {
  if (incoming.version !== 1) throw new Error('对方使用了不兼容的局域网同步版本')
  const [events, chemotherapyTemplates, records, pins, reimbursementPlans, assets, localTombstones] = await Promise.all([
    repository.list<TreatmentEvent>('event'),
    repository.list<ChemotherapyTemplate>('chemotherapyTemplate'),
    repository.list<ExamRecord>('record'),
    repository.list<ChartPin>('pin'),
    repository.list<ReimbursementPlan>('reimbursementPlan'),
    repository.list<MediaAsset>('asset'),
    repository.list<SyncTombstone>('syncTombstone'),
  ])
  const summary: LanSyncMergeSummary = {
    added: 0,
    updated: 0,
    unchanged: 0,
    deleted: 0,
    conflictsMerged: 0,
    assetsReceived: incoming.assets.length,
  }
  const tombstones = new Map<string, SyncTombstone>()
  for (const tombstone of [...localTombstones, ...incoming.tombstones]) {
    const existing = tombstones.get(tombstone.id)
    if (!existing || Date.parse(tombstone.deletedAt) > Date.parse(existing.deletedAt)) tombstones.set(tombstone.id, tombstone)
  }

  const mergedEvents = mergeValues('event', events, incoming.events, tombstones, summary)
  const mergedTemplates = mergeValues('chemotherapyTemplate', chemotherapyTemplates, incoming.chemotherapyTemplates, tombstones, summary)
  const incomingRecords = incoming.records.map((record) => normalizeEntityPayload('record', record))
  const mergedRecords = mergeValues('record', records, incomingRecords, tombstones, summary)
  const mergedPins = mergeValues('pin', pins, incoming.pins, tombstones, summary)
  const mergedPlans = mergeValues('reimbursementPlan', reimbursementPlans, incoming.reimbursementPlans, tombstones, summary)
  const mergedAssets = await persistAssets(mergeValues('asset', assets, incoming.assets, tombstones, summary))
  const catalog = reconcileMediaCatalog(mergedRecords, [], mergedPlans, mergedAssets, { pruneUnused: true })

  const replacements: Array<[EntityKind, Array<{ id: string; payload: unknown }>]> = [
    ['event', mergedEvents.map((payload) => ({ id: payload.id, payload }))],
    ['chemotherapyTemplate', mergedTemplates.map((payload) => ({ id: payload.id, payload }))],
    ['record', catalog.records.map((payload) => ({ id: payload.id, payload: compactRecordMedia(payload) }))],
    ['pin', mergedPins.map((payload) => ({ id: payload.id, payload }))],
    ['reimbursementPlan', catalog.reimbursementPlans.map((payload) => ({ id: payload.id, payload: compactReimbursementMedia(payload) }))],
    ['asset', catalog.assets.map((payload) => ({ id: payload.id, payload }))],
    ['syncTombstone', [...tombstones.values()].map((payload) => ({ id: payload.id, payload }))],
  ]
  for (const [kind, entries] of replacements) await repository.replaceKind(kind, entries)

  return {
    events: mergedEvents,
    chemotherapyTemplates: mergedTemplates,
    records: catalog.records,
    pins: mergedPins,
    reimbursementPlans: catalog.reimbursementPlans,
    assets: catalog.assets,
    summary,
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)))
  }
  return btoa(binary)
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function ownedBytes(bytes: Uint8Array) {
  return new Uint8Array(bytes)
}

async function compress(bytes: Uint8Array) {
  const blob = new Blob([ownedBytes(bytes)])
  if (typeof CompressionStream === 'undefined' || typeof blob.stream !== 'function') return { compression: 'none' as const, bytes }
  const stream = blob.stream().pipeThrough(new CompressionStream('gzip'))
  return { compression: 'gzip' as const, bytes: new Uint8Array(await new Response(stream).arrayBuffer()) }
}

async function decompress(bytes: Uint8Array, compression: LanEncryptedEnvelope['compression']) {
  if (compression === 'none') return bytes
  const blob = new Blob([ownedBytes(bytes)])
  if (typeof DecompressionStream === 'undefined' || typeof blob.stream !== 'function') throw new Error('当前设备不支持解压局域网同步数据')
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function createLanCryptoIdentity(): Promise<LanCryptoIdentity> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  ) as CryptoKeyPair
  const publicKey = await crypto.subtle.exportKey('raw', keyPair.publicKey)
  return { privateKey: keyPair.privateKey, publicKey: bytesToBase64(new Uint8Array(publicKey)) }
}

async function deriveLanKey(identity: LanCryptoIdentity, peerPublicKey: string, salt: Uint8Array<ArrayBuffer>) {
  const publicKey = await crypto.subtle.importKey(
    'raw',
    base64ToBytes(peerPublicKey),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    identity.privateKey,
    256,
  )
  const material = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', salt, info: new TextEncoder().encode('CareJournal LAN Sync v2'), hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptLanSnapshot(snapshot: LanSyncSnapshot, identity: LanCryptoIdentity, peerPublicKey: string): Promise<LanEncryptedEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const compressed = await compress(new TextEncoder().encode(JSON.stringify(snapshot)))
  const key = await deriveLanKey(identity, peerPublicKey, salt)
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, ownedBytes(compressed.bytes))
  return {
    version: 2,
    compression: compressed.compression,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    senderPublicKey: identity.publicKey,
    data: bytesToBase64(new Uint8Array(encrypted)),
  }
}

export async function decryptLanSnapshot(envelope: LanEncryptedEnvelope, identity: LanCryptoIdentity): Promise<LanSyncSnapshot> {
  try {
    if (envelope.version !== 2 || !envelope.senderPublicKey) throw new Error('版本不兼容')
    const salt = base64ToBytes(envelope.salt)
    const iv = base64ToBytes(envelope.iv)
    const key = await deriveLanKey(identity, envelope.senderPublicKey, salt)
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, base64ToBytes(envelope.data))
    const plain = await decompress(new Uint8Array(decrypted), envelope.compression)
    const snapshot = JSON.parse(new TextDecoder().decode(plain)) as LanSyncSnapshot
    if (snapshot.version !== 1 || !Array.isArray(snapshot.records) || !Array.isArray(snapshot.assets)) throw new Error('内容无效')
    return snapshot
  } catch {
    throw new Error('设备密钥不匹配，或同步数据在传输中损坏')
  }
}

export function snapshotEntityCount(snapshot: LanSyncSnapshot) {
  return syncedKinds.reduce((total, kind) => total + (snapshot[kindFields[kind]] as unknown[]).length, 0)
}
