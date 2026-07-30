import { normalizeEntityPayload, repository, type EntityKind } from '../db/repository'
import type {
  ChartPin,
  ChemotherapyTemplate,
  ExamRecord,
  LanSyncEntityKind,
  LanSyncMergeSummary,
  LanSyncPreview,
  LanSyncSnapshot,
  MediaAsset,
  ReimbursementPlan,
  StoredImage,
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
  plaintext?: LanSyncSnapshot
}

export interface LanCryptoIdentity {
  privateKey: CryptoKey
  publicKey: string
}

const syncedKinds = ['event', 'chemotherapyTemplate', 'record', 'pin', 'reimbursementPlan', 'asset'] as const
// Plain LAN envelopes no longer incur a second Base64 expansion, so a larger
// chunk remains comfortably within the Android WebView bridge limit.
const LAN_ASSET_CHUNK_CHARACTERS = 256 * 1024
const MAX_LAN_ASSET_CHARACTERS = 48 * 1024 * 1024

const kindFields = {
  event: 'events',
  chemotherapyTemplate: 'chemotherapyTemplates',
  record: 'records',
  pin: 'pins',
  reimbursementPlan: 'reimbursementPlans',
  asset: 'assets',
} as const satisfies Record<LanSyncEntityKind, keyof LanSyncSnapshot>

/**
 * Per-kind include map used to skip whole entity kinds during LAN sync. A
 * missing key or `true` value means "include this kind"; `false` means "drop
 * every entry of this kind, in both sides' snapshots and in tombstones". The
 * filter is a purely local decision by the caller and is never serialized —
 * peers coordinate the same intent through `LanSyncSnapshot.transfer.wantedKinds`.
 */
export type LanSyncKindFilter = Partial<Record<LanSyncEntityKind, boolean>>

function includesKind(filter: LanSyncKindFilter | undefined, kind: LanSyncEntityKind): boolean {
  if (!filter) return true
  return filter[kind] !== false
}

/** Build a filter from the `wantedKinds` field the initiator sent on the wire. */
export function kindFilterFromWantedKinds(wanted?: readonly LanSyncEntityKind[]): LanSyncKindFilter | undefined {
  if (!wanted) return undefined
  return {
    event: wanted.includes('event'),
    chemotherapyTemplate: wanted.includes('chemotherapyTemplate'),
    record: wanted.includes('record'),
    pin: wanted.includes('pin'),
    reimbursementPlan: wanted.includes('reimbursementPlan'),
    asset: wanted.includes('asset'),
  }
}

/** Drop excluded kinds (and their tombstones) from a snapshot in-place-safe. */
function applyKindFilter(snapshot: LanSyncSnapshot, filter?: LanSyncKindFilter): LanSyncSnapshot {
  if (!filter) return snapshot
  return {
    ...snapshot,
    events: includesKind(filter, 'event') ? snapshot.events : [],
    chemotherapyTemplates: includesKind(filter, 'chemotherapyTemplate') ? snapshot.chemotherapyTemplates : [],
    records: includesKind(filter, 'record') ? snapshot.records : [],
    pins: includesKind(filter, 'pin') ? snapshot.pins : [],
    reimbursementPlans: includesKind(filter, 'reimbursementPlan') ? snapshot.reimbursementPlans : [],
    assets: includesKind(filter, 'asset') ? snapshot.assets : [],
    tombstones: snapshot.tombstones.filter((tombstone) => {
      const kind = tombstone.id.split(':')[0] as LanSyncEntityKind
      // Unknown prefixes fall through untouched so we never silently discard
      // future tombstone kinds we do not know about yet.
      if (!(syncedKinds as readonly string[]).includes(kind)) return true
      return includesKind(filter, kind)
    }),
  }
}

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

/**
 * Assets are content-identified: `MediaAsset.id === `sha256:${sha256}``. Two
 * rows sharing an id have byte-identical contents, so there is no meaningful
 * "update" to apply — merging their local-only metadata (visualFingerprint,
 * createdAt, updatedAt) would just amplify device-local drift into repeated
 * "更新 N 素材" preview noise and pointless writes on the source device.
 *
 * We therefore keep the local row unchanged whenever the id matches, honour
 * tombstones the usual way, and only actually copy incoming rows when the id
 * is new locally.
 */
function mergeAssetsById(
  local: MediaAsset[],
  incoming: MediaAsset[],
  tombstones: Map<string, SyncTombstone>,
  summary: LanSyncMergeSummary,
): MediaAsset[] {
  const localById = new Map(local.map((asset) => [asset.id, asset]))
  const incomingById = new Map(incoming.map((asset) => [asset.id, asset]))
  const result: MediaAsset[] = []
  const ids = new Set([...localById.keys(), ...incomingById.keys()])
  for (const id of ids) {
    const localValue = localById.get(id)
    const incomingValue = incomingById.get(id)
    const tombstoneId = `asset:${id}`
    const tombstone = tombstones.get(tombstoneId)
    const newestEntityTime = Math.max(timestamp(localValue), timestamp(incomingValue))
    if (tombstone && Date.parse(tombstone.deletedAt) >= newestEntityTime) {
      if (localValue) summary.deleted += 1
      continue
    }
    if (tombstone) tombstones.delete(tombstoneId)
    if (localValue) {
      result.push(localValue)
      summary.unchanged += 1
      continue
    }
    if (incomingValue) {
      result.push(incomingValue)
      summary.added += 1
    }
  }
  return result
}

/**
 * Preview counter counterpart for {@link mergeAssetsById}. Only counts assets
 * whose id does not exist locally as "added" — same id is never "updated" —
 * and honours asset tombstones the usual way. Pending rows (bytes not yet
 * received) are treated as absent so the peer knows to re-send them.
 */
function countAssetsForPreview(
  local: MediaAsset[],
  incoming: MediaAsset[],
  tombstones: Map<string, SyncTombstone>,
) {
  const availableById = new Map(local.filter((asset) => !asset.pendingSync).map((asset) => [asset.id, asset]))
  let added = 0
  for (const item of incoming) {
    if (!availableById.has(item.id)) added += 1
  }
  const deleted = [...availableById.values()].filter((asset) => {
    const tombstone = tombstones.get(`asset:${asset.id}`)
    return tombstone && Date.parse(tombstone.deletedAt) >= timestamp(asset)
  }).length
  return { added, updated: 0, deleted }
}

function portableAsset(asset: MediaAsset, dataUrl: string): MediaAsset {
  const result: MediaAsset = { ...asset, dataUrl }
  delete result.storagePath
  delete result.localUri
  delete result.sourceUri
  delete result.sourceKey
  // pendingSync is a local-only marker for LAN sync progress. It must never
  // travel across the wire, otherwise peers would start propagating each
  // other's pending markers and dead-lock the reconciliation.
  delete result.pendingSync
  return result
}

async function loadLanCatalog() {
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
  return { events, chemotherapyTemplates, pins, tombstones, catalog }
}

function metadataAsset(asset: MediaAsset): MediaAsset {
  return portableAsset(asset, '')
}

function snapshotWith(
  deviceName: string,
  source: Awaited<ReturnType<typeof loadLanCatalog>>,
  assets: MediaAsset[],
): LanSyncSnapshot {
  return {
    version: 1,
    deviceName,
    createdAt: new Date().toISOString(),
    events: source.events,
    chemotherapyTemplates: source.chemotherapyTemplates,
    records: source.catalog.records.map(compactRecordMedia),
    pins: source.pins,
    reimbursementPlans: source.catalog.reimbursementPlans.map(compactReimbursementMedia),
    assets,
    tombstones: source.tombstones,
  }
}

export async function createLanSyncSnapshot(deviceName: string): Promise<LanSyncSnapshot> {
  const source = await loadLanCatalog()
  const transferredAssets: MediaAsset[] = []
  for (const asset of source.catalog.assets) {
    const materialized = await materializeStoredImage(asset)
    transferredAssets.push(portableAsset(asset, materialized.dataUrl))
  }
  return snapshotWith(deviceName, source, transferredAssets)
}

export async function createLanMetadataSnapshot(
  deviceName: string,
  options: { include?: LanSyncKindFilter } = {},
): Promise<LanSyncSnapshot> {
  const source = await loadLanCatalog()
  const availableAssets = source.catalog.assets.filter(assetAvailableLocally)
  const base = snapshotWith(deviceName, source, source.catalog.assets.map(metadataAsset))
  const filtered = applyKindFilter(base, options.include)
  return {
    ...filtered,
    transfer: {
      phase: 'metadata',
      // availableAssetIds always reflects real local availability. Even when
      // the caller has excluded assets from this direction, the field still
      // lets older peers skip duplicates from their side.
      assetCount: availableAssets.length,
      availableAssetIds: availableAssets.map((asset) => asset.id),
    },
  }
}

export async function createLanPreviewSnapshot(deviceName: string): Promise<LanSyncSnapshot> {
  const snapshot = await createLanMetadataSnapshot(deviceName)
  return { ...snapshot, transfer: { ...snapshot.transfer!, phase: 'preview' } }
}

export async function previewLanSyncSnapshot(incoming: LanSyncSnapshot): Promise<LanSyncPreview> {
  const [events, chemotherapyTemplates, records, pins, reimbursementPlans, assets, localTombstones] = await Promise.all([
    repository.list<TreatmentEvent>('event'),
    repository.list<ChemotherapyTemplate>('chemotherapyTemplate'),
    repository.list<ExamRecord>('record'),
    repository.list<ChartPin>('pin'),
    repository.list<ReimbursementPlan>('reimbursementPlan'),
    repository.list<MediaAsset>('asset'),
    repository.list<SyncTombstone>('syncTombstone'),
  ])
  const tombstones = new Map([...localTombstones, ...incoming.tombstones].map((item) => [item.id, item]))
  function count<T extends { id: string }>(kind: LanSyncEntityKind, local: T[], remote: T[]) {
    const localById = new Map(local.map((item) => [item.id, item]))
    let added = 0
    let updated = 0
    for (const item of remote) {
      const existing = localById.get(item.id)
      if (!existing) added += 1
      else if (JSON.stringify(existing) !== JSON.stringify(item)) updated += 1
    }
    const deleted = local.filter((item) => {
      const tombstone = tombstones.get(`${kind}:${item.id}`)
      return tombstone && Date.parse(tombstone.deletedAt) >= timestamp(item)
    }).length
    return { added, updated, deleted }
  }
  return {
    events: count('event', events, incoming.events),
    chemotherapyTemplates: count('chemotherapyTemplate', chemotherapyTemplates, incoming.chemotherapyTemplates),
    records: count('record', records, incoming.records),
    pins: count('pin', pins, incoming.pins),
    reimbursementPlans: count('reimbursementPlan', reimbursementPlans, incoming.reimbursementPlans),
    // Assets are content-immutable. Same id ⇔ same bytes → never "updated".
    // Pending rows are treated as absent so the peer knows to send them.
    assets: countAssetsForPreview(assets, incoming.assets, tombstones),
  }
}

function assetAvailableLocally(asset: MediaAsset) {
  if (asset.pendingSync) return false
  return Boolean(asset.dataUrl || asset.storagePath || asset.sourceUri)
}

function emptyLanSnapshot(deviceName: string): LanSyncSnapshot {
  return {
    version: 1,
    deviceName,
    createdAt: new Date().toISOString(),
    events: [],
    chemotherapyTemplates: [],
    records: [],
    pins: [],
    reimbursementPlans: [],
    assets: [],
    tombstones: [],
  }
}

export interface LanAssetChunkSource {
  readonly assetCount: number
  readonly skippedCount: number
  next(): Promise<LanSyncSnapshot>
}

export async function createLanAssetChunkSource(
  deviceName: string,
  peerAvailableAssetIds: Iterable<string> = [],
  options: { include?: LanSyncKindFilter } = {},
): Promise<LanAssetChunkSource> {
  const source = await loadLanCatalog()
  const peerAssets = new Set(peerAvailableAssetIds)
  const includeAssets = includesKind(options.include, 'asset')
  const assets = includeAssets
    ? source.catalog.assets.filter((asset) => assetAvailableLocally(asset) && !peerAssets.has(asset.id))
    : []
  let assetIndex = 0
  let chunkIndex = 0
  let currentData = ''
  let currentAsset: MediaAsset | undefined
  let skippedAssets = 0

  return {
    assetCount: assets.length,
    get skippedCount() { return skippedAssets },
    async next() {
      while (!currentAsset && assetIndex < assets.length) {
        const candidate = assets[assetIndex]
        let materialized: StoredImage
        try {
          materialized = await materializeStoredImage(candidate) as MediaAsset
        } catch (error) {
          skippedAssets += 1
          assetIndex += 1
          console.warn(`跳过无法读取的同步素材：${candidate.name}`, error)
          continue
        }
        if (!materialized.dataUrl) {
          assetIndex += 1
          continue
        }
        if (materialized.dataUrl.length > MAX_LAN_ASSET_CHARACTERS) {
          throw new Error(`素材“${candidate.name}”超过局域网同步的单文件上限（约 36 MB），请先压缩或拆分`)
        }
        currentAsset = metadataAsset(candidate)
        currentData = materialized.dataUrl
        chunkIndex = 0
      }

      const snapshot = emptyLanSnapshot(deviceName)
      if (!currentAsset) {
        snapshot.transfer = {
          phase: 'assets',
          done: true,
          assetIndex: assets.length,
          assetCount: assets.length,
          skippedAssets,
        }
        return snapshot
      }

      const chunkCount = Math.max(1, Math.ceil(currentData.length / LAN_ASSET_CHUNK_CHARACTERS))
      const data = currentData.slice(
        chunkIndex * LAN_ASSET_CHUNK_CHARACTERS,
        (chunkIndex + 1) * LAN_ASSET_CHUNK_CHARACTERS,
      )
      snapshot.transfer = {
        phase: 'assets',
        done: false,
        assetIndex,
        assetCount: assets.length,
        chunk: {
          asset: currentAsset,
          index: chunkIndex,
          count: chunkCount,
          data,
        },
      }
      chunkIndex += 1
      if (chunkIndex >= chunkCount) {
        assetIndex += 1
        chunkIndex = 0
        currentData = ''
        currentAsset = undefined
      }
      return snapshot
    },
  }
}

interface PendingLanAsset {
  asset: MediaAsset
  count: number
  parts: string[]
}

export class LanAssetChunkReceiver {
  private pending = new Map<string, PendingLanAsset>()

  async accept(snapshot: LanSyncSnapshot): Promise<LanSyncSnapshot | null> {
    const chunk = snapshot.transfer?.chunk
    if (snapshot.transfer?.phase !== 'assets' || !chunk) return null
    if (chunk.count < 1 || chunk.count > 1024 || chunk.index < 0 || chunk.index >= chunk.count) {
      throw new Error('收到的素材分块信息无效')
    }
    let pending = this.pending.get(chunk.asset.id)
    if (!pending) {
      pending = { asset: chunk.asset, count: chunk.count, parts: new Array<string>(chunk.count) }
      this.pending.set(chunk.asset.id, pending)
    }
    if (pending.count !== chunk.count) throw new Error('收到的素材分块数量不一致')
    pending.parts[chunk.index] = chunk.data
    if (pending.parts.filter(Boolean).length !== pending.count) return null

    const dataUrl = pending.parts.join('')
    this.pending.delete(chunk.asset.id)
    if (dataUrl.length > MAX_LAN_ASSET_CHARACTERS || !dataUrl.startsWith('data:')) {
      throw new Error('收到的素材内容无效或超过单文件上限')
    }
    return {
      ...emptyLanSnapshot(snapshot.deviceName),
      assets: [{ ...pending.asset, dataUrl }],
    }
  }
}

async function persistAssets(assets: MediaAsset[]) {
  const persisted: MediaAsset[] = []
  for (const asset of assets) {
    const stored = await persistStoredImage(asset)
    const durable: MediaAsset = {
      ...asset,
      ...stored,
      id: asset.id,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
    }
    // Any row without real bytes stays flagged as pendingSync so a subsequent
    // sync will treat it as missing on this device. Once the chunk stream
    // delivers the payload the flag is cleared here or in storeLanAsset.
    if (durable.dataUrl || durable.storagePath || durable.localUri || durable.sourceUri) {
      delete durable.pendingSync
    } else {
      durable.pendingSync = true
    }
    persisted.push(durable)
  }
  return persisted
}

export async function mergeLanSyncSnapshot(
  incoming: LanSyncSnapshot,
  options: { include?: LanSyncKindFilter } = {},
): Promise<MergedLanData> {
  if (incoming.version !== 1) throw new Error('对方使用了不兼容的局域网同步版本')
  const filtered = applyKindFilter(incoming, options.include)
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
    assetsReceived: filtered.assets.length,
  }
  const tombstones = new Map<string, SyncTombstone>()
  for (const tombstone of [...localTombstones, ...filtered.tombstones]) {
    const existing = tombstones.get(tombstone.id)
    if (!existing || Date.parse(tombstone.deletedAt) > Date.parse(existing.deletedAt)) tombstones.set(tombstone.id, tombstone)
  }

  const mergedEvents = mergeValues('event', events, filtered.events, tombstones, summary)
  const mergedTemplates = mergeValues('chemotherapyTemplate', chemotherapyTemplates, filtered.chemotherapyTemplates, tombstones, summary)
  const incomingRecords = filtered.records.map((record) => normalizeEntityPayload('record', record))
  const mergedRecords = mergeValues('record', records, incomingRecords, tombstones, summary)
  const mergedPins = mergeValues('pin', pins, filtered.pins, tombstones, summary)
  const mergedPlans = mergeValues('reimbursementPlan', reimbursementPlans, filtered.reimbursementPlans, tombstones, summary)
  const mergedAssets = await persistAssets(mergeAssetsById(assets, filtered.assets, tombstones, summary))
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
  void peerPublicKey
  return {
    version: 2,
    compression: 'none',
    salt: '',
    iv: '',
    senderPublicKey: identity.publicKey,
    data: '',
    plaintext: snapshot,
  }
}

export async function decryptLanSnapshot(envelope: LanEncryptedEnvelope, identity: LanCryptoIdentity): Promise<LanSyncSnapshot> {
  if (envelope.plaintext) {
    const snapshot = envelope.plaintext
    if (snapshot.version !== 1 || !Array.isArray(snapshot.records) || !Array.isArray(snapshot.assets)) {
      throw new Error('同步数据内容无效')
    }
    return snapshot
  }
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
