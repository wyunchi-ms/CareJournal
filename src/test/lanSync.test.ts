import { afterEach, describe, expect, it } from 'vitest'
import { repository } from '../db/repository'
import {
  createLanAssetChunkSource,
  createLanCryptoIdentity,
  createLanMetadataSnapshot,
  decryptLanSnapshot,
  encryptLanSnapshot,
  LanAssetChunkReceiver,
  mergeLanSyncSnapshot,
  snapshotEntityCount,
} from '../services/lanSync'
import type { ExamRecord, LanSyncSnapshot, MediaAsset } from '../types'

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
})
