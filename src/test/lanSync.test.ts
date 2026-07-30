import { afterEach, describe, expect, it } from 'vitest'
import { repository } from '../db/repository'
import {
  createLanAssetChunkSource,
  createLanCryptoIdentity,
  createLanMetadataSnapshot,
  decryptLanSnapshot,
  encryptLanSnapshot,
  kindFilterFromWantedKinds,
  LanAssetChunkReceiver,
  mergeLanSyncSnapshot,
  previewLanSyncSnapshot,
  snapshotEntityCount,
} from '../services/lanSync'
import type { ExamRecord, LanSyncSnapshot, MediaAsset, SyncTombstone, TreatmentEvent } from '../types'

const snapshot: LanSyncSnapshot = {
  version: 1,
  deviceName: '测试手机',
  createdAt: '2026-07-29T02:00:00.000Z',
  events: [{
    id: 'event-1',
    title: '治疗',
    type: 'chemotherapy',
    startDate: '2026-07-29',
    endDate: '2026-07-29',
    hospital: '',
    department: '',
    notes: '',
    allDay: true,
    tags: [],
    linkedRecordIds: [],
    createdAt: '2026-07-29T01:00:00.000Z',
    updatedAt: '2026-07-29T01:00:00.000Z',
  }],
  chemotherapyTemplates: [],
  records: [],
  pins: [],
  reimbursementPlans: [],
  assets: [],
  tombstones: [],
}

describe('LAN sync transport', () => {
  afterEach(async () => {
    for (const kind of ['event', 'chemotherapyTemplate', 'record', 'pin', 'reimbursementPlan', 'asset', 'syncTombstone'] as const) {
      await repository.replaceKind(kind, [])
    }
  })

  it('round-trips a plaintext LAN snapshot without synchronizing local credentials', async () => {
    const sender = await createLanCryptoIdentity()
    const receiver = await createLanCryptoIdentity()
    const envelope = await encryptLanSnapshot(snapshot, sender, receiver.publicKey)
    await expect(decryptLanSnapshot(envelope, receiver)).resolves.toEqual(snapshot)
    const response = await encryptLanSnapshot(snapshot, receiver, envelope.senderPublicKey)
    await expect(decryptLanSnapshot(response, sender)).resolves.toEqual(snapshot)
    expect(envelope.plaintext).toEqual(snapshot)
    expect(envelope.compression).toBe('none')
    expect(snapshotEntityCount(snapshot)).toBe(1)
  })

  it('allows either local device to read the direct LAN envelope', async () => {
    const sender = await createLanCryptoIdentity()
    const receiver = await createLanCryptoIdentity()
    const otherDevice = await createLanCryptoIdentity()
    const envelope = await encryptLanSnapshot(snapshot, sender, receiver.publicKey)
    await expect(decryptLanSnapshot(envelope, otherDevice)).resolves.toEqual(snapshot)
  })

  it('keeps the union of arrays while newer scalar fields win', async () => {
    await repository.put('event', 'event-1', {
      ...snapshot.events[0],
      title: '本机标题',
      tags: ['本机'],
      updatedAt: '2026-07-29T01:00:00.000Z',
    })
    const incoming: LanSyncSnapshot = {
      ...snapshot,
      events: [{
        ...snapshot.events[0],
        title: '对方较新标题',
        tags: ['对方'],
        updatedAt: '2026-07-29T03:00:00.000Z',
      }],
    }

    const merged = await mergeLanSyncSnapshot(incoming)
    expect(merged.events[0].title).toBe('对方较新标题')
    expect(merged.events[0].tags).toEqual(['本机', '对方'])
    expect(merged.summary.conflictsMerged).toBe(1)
  })

  it('exchanges metadata first and reconstructs large assets from bounded encrypted chunks', async () => {
    const dataUrl = `data:image/jpeg;base64,${'A'.repeat(700_000)}`
    const asset: MediaAsset = {
      id: 'sha256:asset-1',
      name: 'report.jpg',
      mimeType: 'image/jpeg',
      dataUrl,
      sha256: 'asset-1',
      createdAt: '2026-07-29T01:00:00.000Z',
      updatedAt: '2026-07-29T01:00:00.000Z',
    }
    const record: ExamRecord = {
      id: 'record-1',
      reportType: '血常规',
      sampleDate: '2026-07-29',
      indicators: [],
      images: [{
        id: 'image-1',
        assetId: asset.id,
        name: asset.name,
        mimeType: asset.mimeType,
        dataUrl: '',
        sha256: asset.sha256,
      }],
      linkedEventIds: [],
      fingerprint: 'record-1',
      ocrStatus: 'completed',
      ocrAttempts: 1,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
    }
    await repository.put('record', record.id, record)
    await repository.put('asset', asset.id, asset)

    const metadata = await createLanMetadataSnapshot('A')
    expect(metadata.transfer).toMatchObject({ phase: 'metadata', assetCount: 1 })
    expect(metadata.transfer?.availableAssetIds).toEqual([asset.id])
    expect(metadata.assets[0].dataUrl).toBe('')

    const source = await createLanAssetChunkSource('A')
    const receiver = new LanAssetChunkReceiver()
    let rebuilt: LanSyncSnapshot | null = null
    let chunks = 0
    while (!rebuilt) {
      const part = await source.next()
      if (part.transfer?.done) break
      chunks += 1
      rebuilt = await receiver.accept(part)
    }
    expect(chunks).toBeGreaterThan(1)
    expect(rebuilt?.assets[0]).toMatchObject({ id: asset.id, dataUrl })
    await expect(source.next()).resolves.toMatchObject({ transfer: { phase: 'assets', done: true } })

    const unchangedSource = await createLanAssetChunkSource('A', [asset.id])
    expect(unchangedSource.assetCount).toBe(0)
    await expect(unchangedSource.next()).resolves.toMatchObject({
      transfer: { phase: 'assets', done: true, assetCount: 0 },
    })
  })

  it('skips an old folder-backed asset that is no longer readable without aborting record sync', async () => {
    const asset: MediaAsset = {
      id: 'source:expired',
      name: 'expired.jpg',
      mimeType: 'image/jpeg',
      dataUrl: '',
      sha256: '',
      sourceUri: 'content://expired/report.jpg',
      createdAt: '2026-07-29T01:00:00.000Z',
      updatedAt: '2026-07-29T01:00:00.000Z',
    }
    await repository.put('asset', asset.id, asset)
    await repository.put('record', 'record-expired', {
      id: 'record-expired',
      reportType: '血常规',
      sampleDate: '2026-07-29',
      indicators: [],
      images: [{ ...asset, id: 'image-expired', assetId: asset.id }],
      linkedEventIds: [],
      fingerprint: 'record-expired',
      ocrStatus: 'completed',
      ocrAttempts: 1,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
    })

    const source = await createLanAssetChunkSource('A')
    await expect(source.next()).resolves.toMatchObject({
      transfer: { phase: 'assets', done: true, skippedAssets: 1 },
    })
    expect(source.skippedCount).toBe(1)
  })

  it('marks LAN-merged assets as pending until the chunk stream delivers their bytes', async () => {
    const metadataAsset: MediaAsset = {
      id: 'sha256:remote-asset',
      name: 'remote.jpg',
      mimeType: 'image/jpeg',
      dataUrl: '',
      sha256: 'remote-asset',
      createdAt: '2026-07-29T01:00:00.000Z',
      updatedAt: '2026-07-29T01:00:00.000Z',
    }
    const record: ExamRecord = {
      id: 'record-remote',
      reportType: 'lab',
      sampleDate: '2026-07-29',
      indicators: [],
      images: [{
        id: 'image-remote',
        assetId: metadataAsset.id,
        name: metadataAsset.name,
        mimeType: metadataAsset.mimeType,
        dataUrl: '',
        sha256: metadataAsset.sha256,
      }],
      linkedEventIds: [],
      fingerprint: 'record-remote',
      ocrStatus: 'completed',
      ocrAttempts: 1,
      createdAt: metadataAsset.createdAt,
      updatedAt: metadataAsset.updatedAt,
    }
    const incoming: LanSyncSnapshot = {
      ...snapshot,
      records: [record],
      assets: [metadataAsset],
      transfer: {
        phase: 'metadata',
        assetCount: 1,
        availableAssetIds: [metadataAsset.id],
      },
    }

    const merged = await mergeLanSyncSnapshot(incoming)
    expect(merged.assets).toHaveLength(1)
    expect(merged.assets[0].pendingSync).toBe(true)
    const stored = await repository.list<MediaAsset>('asset')
    expect(stored[0]?.pendingSync).toBe(true)
  })

  it('advertises only assets whose bytes are actually available to peers', async () => {
    const pending: MediaAsset = {
      id: 'sha256:pending',
      name: 'pending.jpg',
      mimeType: 'image/jpeg',
      dataUrl: '',
      sha256: 'pending',
      pendingSync: true,
      createdAt: '2026-07-29T01:00:00.000Z',
      updatedAt: '2026-07-29T01:00:00.000Z',
    }
    const real: MediaAsset = {
      id: 'sha256:real',
      name: 'real.jpg',
      mimeType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,QUFBQQ==',
      sha256: 'real',
      createdAt: '2026-07-29T01:00:00.000Z',
      updatedAt: '2026-07-29T01:00:00.000Z',
    }
    await repository.put('asset', pending.id, pending)
    await repository.put('asset', real.id, real)
    await repository.put('record', 'record-mixed', {
      id: 'record-mixed',
      reportType: 'lab',
      sampleDate: '2026-07-29',
      indicators: [],
      images: [
        { id: 'image-pending', assetId: pending.id, name: pending.name, mimeType: pending.mimeType, dataUrl: '', sha256: pending.sha256 },
        { id: 'image-real', assetId: real.id, name: real.name, mimeType: real.mimeType, dataUrl: '', sha256: real.sha256 },
      ],
      linkedEventIds: [],
      fingerprint: 'record-mixed',
      ocrStatus: 'completed',
      ocrAttempts: 1,
      createdAt: pending.createdAt,
      updatedAt: pending.updatedAt,
    })

    const metadata = await createLanMetadataSnapshot('B')
    expect(metadata.transfer?.availableAssetIds).toEqual([real.id])
    // pendingSync must not leak into any snapshot sent to peers.
    expect(metadata.assets.every((asset) => asset.pendingSync === undefined)).toBe(true)

    const source = await createLanAssetChunkSource('B')
    expect(source.assetCount).toBe(1)
  })

  it('lets the peer re-send exactly the pending bytes after an interrupted sync', async () => {
    // Simulate the receiving side of an A -> B transfer that failed halfway:
    // both asset rows already exist locally, but only one carries real bytes.
    const delivered: MediaAsset = {
      id: 'sha256:delivered',
      name: 'delivered.jpg',
      mimeType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,QUFBQQ==',
      sha256: 'delivered',
      createdAt: '2026-07-29T01:00:00.000Z',
      updatedAt: '2026-07-29T01:00:00.000Z',
    }
    const stuck: MediaAsset = {
      id: 'sha256:stuck',
      name: 'stuck.jpg',
      mimeType: 'image/jpeg',
      dataUrl: '',
      sha256: 'stuck',
      pendingSync: true,
      createdAt: '2026-07-29T01:00:00.000Z',
      updatedAt: '2026-07-29T01:00:00.000Z',
    }
    await repository.put('asset', delivered.id, delivered)
    await repository.put('asset', stuck.id, stuck)
    await repository.put('record', 'record-both', {
      id: 'record-both',
      reportType: 'lab',
      sampleDate: '2026-07-29',
      indicators: [],
      images: [
        { id: 'image-delivered', assetId: delivered.id, name: delivered.name, mimeType: delivered.mimeType, dataUrl: '', sha256: delivered.sha256 },
        { id: 'image-stuck', assetId: stuck.id, name: stuck.name, mimeType: stuck.mimeType, dataUrl: '', sha256: stuck.sha256 },
      ],
      linkedEventIds: [],
      fingerprint: 'record-both',
      ocrStatus: 'completed',
      ocrAttempts: 1,
      createdAt: delivered.createdAt,
      updatedAt: delivered.updatedAt,
    })

    // Peer (A) still has both assets and re-announces them in the metadata phase.
    const peerAsset = (source: MediaAsset): MediaAsset => ({
      id: source.id,
      name: source.name,
      mimeType: source.mimeType,
      dataUrl: '',
      sha256: source.sha256,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
    })
    const peerSnapshot: LanSyncSnapshot = {
      ...snapshot,
      assets: [peerAsset(delivered), peerAsset(stuck)],
    }

    const preview = await previewLanSyncSnapshot(peerSnapshot)
    expect(preview.assets).toEqual({ added: 1, updated: 0, deleted: 0 })
  })

  it('converts a wantedKinds list into a per-kind include filter', () => {
    expect(kindFilterFromWantedKinds(undefined)).toBeUndefined()
    expect(kindFilterFromWantedKinds([])).toEqual({
      event: false,
      chemotherapyTemplate: false,
      record: false,
      pin: false,
      reimbursementPlan: false,
      asset: false,
    })
    expect(kindFilterFromWantedKinds(['event', 'asset'])).toEqual({
      event: true,
      chemotherapyTemplate: false,
      record: false,
      pin: false,
      reimbursementPlan: false,
      asset: true,
    })
  })

  it('empties excluded kinds in the outgoing metadata but keeps availableAssetIds accurate', async () => {
    const asset: MediaAsset = {
      id: 'sha256:asset-filtered',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,QUFBQQ==',
      sha256: 'asset-filtered',
      createdAt: '2026-07-29T01:00:00.000Z',
      updatedAt: '2026-07-29T01:00:00.000Z',
    }
    const record: ExamRecord = {
      id: 'record-filtered',
      reportType: 'lab',
      sampleDate: '2026-07-29',
      indicators: [],
      images: [{
        id: 'image-filtered',
        assetId: asset.id,
        name: asset.name,
        mimeType: asset.mimeType,
        dataUrl: '',
        sha256: asset.sha256,
      }],
      linkedEventIds: [],
      fingerprint: 'record-filtered',
      ocrStatus: 'completed',
      ocrAttempts: 1,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
    }
    await repository.put('asset', asset.id, asset)
    await repository.put('record', record.id, record)
    await repository.put('event', 'event-kept', {
      id: 'event-kept',
      title: 'kept',
      type: 'chemotherapy',
      startDate: '2026-07-29',
      endDate: '2026-07-29',
      hospital: '',
      department: '',
      notes: '',
      allDay: true,
      tags: [],
      linkedRecordIds: [],
      createdAt: '2026-07-29T01:00:00.000Z',
      updatedAt: '2026-07-29T01:00:00.000Z',
    })

    const dropped = await createLanMetadataSnapshot('A', { include: { asset: false, record: false } })
    expect(dropped.assets).toHaveLength(0)
    expect(dropped.records).toHaveLength(0)
    expect(dropped.events).toHaveLength(1)
    // availableAssetIds still shows what we truly have on disk so older peers
    // stop advertising duplicates back at us.
    expect(dropped.transfer?.availableAssetIds).toEqual([asset.id])
  })

  it('drops incoming entries and tombstones for kinds excluded by the include filter', async () => {
    const localEvent: TreatmentEvent = {
      id: 'event-local',
      title: '本地事件',
      type: 'chemotherapy',
      startDate: '2026-07-29',
      endDate: '2026-07-29',
      hospital: '',
      department: '',
      notes: '',
      allDay: true,
      tags: [],
      linkedRecordIds: [],
      createdAt: '2026-07-29T01:00:00.000Z',
      updatedAt: '2026-07-29T01:00:00.000Z',
    }
    await repository.put('event', localEvent.id, localEvent)

    const incomingEvent: TreatmentEvent = {
      ...localEvent,
      id: 'event-incoming',
      title: '对方事件',
    }
    const tombstone: SyncTombstone = {
      id: `event:${localEvent.id}`,
      entityKind: 'event',
      entityId: localEvent.id,
      deletedAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:00:00.000Z',
    }
    const incoming: LanSyncSnapshot = {
      ...snapshot,
      events: [incomingEvent],
      tombstones: [tombstone],
    }

    const merged = await mergeLanSyncSnapshot(incoming, { include: { event: false } })
    const ids = merged.events.map((event) => event.id)
    expect(ids).toContain(localEvent.id)
    expect(ids).not.toContain(incomingEvent.id)
    expect(merged.summary.added).toBe(0)
    expect(merged.summary.deleted).toBe(0)
  })

  it('returns an empty chunk stream when the include filter excludes assets', async () => {
    const asset: MediaAsset = {
      id: 'sha256:asset-skipped',
      name: 'skip.jpg',
      mimeType: 'image/jpeg',
      dataUrl: `data:image/jpeg;base64,${'A'.repeat(300_000)}`,
      sha256: 'asset-skipped',
      createdAt: '2026-07-29T01:00:00.000Z',
      updatedAt: '2026-07-29T01:00:00.000Z',
    }
    await repository.put('asset', asset.id, asset)
    await repository.put('record', 'record-skipped', {
      id: 'record-skipped',
      reportType: 'lab',
      sampleDate: '2026-07-29',
      indicators: [],
      images: [{
        id: 'image-skipped',
        assetId: asset.id,
        name: asset.name,
        mimeType: asset.mimeType,
        dataUrl: '',
        sha256: asset.sha256,
      }],
      linkedEventIds: [],
      fingerprint: 'record-skipped',
      ocrStatus: 'completed',
      ocrAttempts: 1,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
    })

    const source = await createLanAssetChunkSource('A', [], { include: { asset: false } })
    expect(source.assetCount).toBe(0)
    await expect(source.next()).resolves.toMatchObject({
      transfer: { phase: 'assets', done: true, assetCount: 0 },
    })
  })

  it('treats assets with the same id as identical even when local metadata drifted', async () => {
    // The receiver's local copy carries a device-specific visualFingerprint and
    // a locally-stamped updatedAt (the classic churn caused by startup
    // reconciliation on the source device). The peer sends the same asset id
    // with different values across those secondary fields.
    const localCopy: MediaAsset = {
      id: 'sha256:stable-asset',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      dataUrl: '',
      sha256: 'stable-asset',
      visualFingerprint: 'v1:48x96:LOCAL-DEVICE-DIGEST',
      storagePath: 'files/assets/stable-asset.jpg',
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    }
    await repository.put('asset', localCopy.id, localCopy)
    // A record has to reference the asset or reconcileMediaCatalog(pruneUnused)
    // will drop it during the merge, mirroring how records actually keep
    // assets alive in production.
    await repository.put('record', 'record-stable', {
      id: 'record-stable',
      reportType: 'lab',
      sampleDate: '2026-06-01',
      indicators: [],
      images: [{
        id: 'image-stable',
        assetId: localCopy.id,
        name: localCopy.name,
        mimeType: localCopy.mimeType,
        dataUrl: '',
        sha256: localCopy.sha256,
        visualFingerprint: localCopy.visualFingerprint,
      }],
      linkedEventIds: [],
      fingerprint: 'record-stable',
      ocrStatus: 'completed',
      ocrAttempts: 1,
      createdAt: localCopy.createdAt,
      updatedAt: localCopy.updatedAt,
    })

    const drifted: MediaAsset = {
      id: localCopy.id,
      name: localCopy.name,
      mimeType: localCopy.mimeType,
      dataUrl: '',
      sha256: localCopy.sha256,
      visualFingerprint: 'v1:48x96:REMOTE-DEVICE-DIGEST',
      createdAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:00:00.000Z',
    }
    const peerSnapshot: LanSyncSnapshot = {
      ...snapshot,
      assets: [drifted],
    }

    // Preview must show 0 changes for this asset — same id ⇒ same bytes.
    const preview = await previewLanSyncSnapshot(peerSnapshot)
    expect(preview.assets).toEqual({ added: 0, updated: 0, deleted: 0 })

    // Merging must NOT touch the existing row so the source-of-truth device
    // keeps its original updatedAt/createdAt/visualFingerprint.
    const merged = await mergeLanSyncSnapshot(peerSnapshot)
    const kept = merged.assets.find((asset) => asset.id === localCopy.id)
    expect(kept?.visualFingerprint).toBe('v1:48x96:LOCAL-DEVICE-DIGEST')
    expect(kept?.updatedAt).toBe('2026-07-01T00:00:00.000Z')
    expect(kept?.createdAt).toBe('2026-06-01T00:00:00.000Z')
    expect(kept?.storagePath).toBe('files/assets/stable-asset.jpg')
    expect(merged.summary.updated).toBe(0)
    expect(merged.summary.conflictsMerged).toBe(0)
  })
})
