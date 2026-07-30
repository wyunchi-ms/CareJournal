import { describe, expect, it } from 'vitest'
import { compactRecordMedia, compactReimbursementMedia, reconcileMediaCatalog } from '../services/mediaAssets'
import type { ExamRecord, ReimbursementAttachment, ReimbursementPlan, StoredImage } from '../types'

function image(overrides: Partial<StoredImage> = {}): StoredImage {
  return {
    id: 'record-image',
    name: '检查报告.jpg',
    mimeType: 'image/jpeg',
    dataUrl: '',
    sha256: 'shared-hash',
    storagePath: 'report-images/shared-hash.jpg',
    localUri: 'file:///private/report-images/shared-hash.jpg',
    ...overrides,
  }
}

function record(images: StoredImage[]): ExamRecord {
  return {
    id: 'record-1',
    reportType: '血常规',
    sampleDate: '2026-07-23',
    indicators: [],
    images,
    linkedEventIds: [],
    fingerprint: 'record-fingerprint',
    ocrStatus: 'completed',
    ocrAttempts: 1,
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  }
}

function attachment(overrides: Partial<ReimbursementAttachment> = {}): ReimbursementAttachment {
  return {
    ...image({ id: 'attachment-1', name: '报销材料.jpg' }),
    source: 'record',
    sourceRecordId: 'record-1',
    createdAt: '2026-07-23T00:00:00.000Z',
    ...overrides,
  }
}

function plan(attachments: ReimbursementAttachment[]): ReimbursementPlan {
  return {
    id: 'plan-1',
    eventId: 'event-1',
    eventType: 'examination',
    eventTitle: '检查',
    eventDate: '2026-07-23',
    coverage: 'public_medical',
    materials: [{
      id: 'material-1',
      kind: 'test_report',
      label: '检查检验报告',
      required: true,
      completed: true,
      attachments,
    }],
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  }
}

describe('unified media asset catalog', () => {
  it('migrates legacy record and reimbursement references to one shared asset without moving files', () => {
    const result = reconcileMediaCatalog(
      [record([image()])],
      [],
      [plan([attachment()])],
    )

    expect(result.assets).toHaveLength(1)
    expect(result.assets[0]).toMatchObject({
      id: 'sha256:shared-hash',
      storagePath: 'report-images/shared-hash.jpg',
      localUri: 'file:///private/report-images/shared-hash.jpg',
    })
    expect(result.records[0].images[0].assetId).toBe('sha256:shared-hash')
    expect(result.reimbursementPlans[0].materials[0].attachments[0].assetId).toBe('sha256:shared-hash')
  })

  it('compacts owner metadata only after an asset link exists and hydrates it again on restart', () => {
    const first = reconcileMediaCatalog([record([image()])], [], [plan([attachment()])])
    const compactRecord = compactRecordMedia(first.records[0])
    const compactPlan = compactReimbursementMedia(first.reimbursementPlans[0])

    expect(compactRecord.images[0]).toMatchObject({ assetId: 'sha256:shared-hash', dataUrl: '' })
    expect(compactRecord.images[0]).not.toHaveProperty('storagePath')
    expect(compactPlan.materials[0].attachments[0]).not.toHaveProperty('localUri')

    const restarted = reconcileMediaCatalog([compactRecord], [], [compactPlan], first.assets)
    expect(restarted.records[0].images[0]).toMatchObject({
      storagePath: 'report-images/shared-hash.jpg',
      localUri: 'file:///private/report-images/shared-hash.jpg',
    })
    expect(restarted.reimbursementPlans[0].materials[0].attachments[0].assetId).toBe('sha256:shared-hash')
  })

  it('removes duplicate PDF references inside one reimbursement material', () => {
    const pdf = attachment({
      id: 'pdf-1',
      name: '发票.pdf',
      mimeType: 'application/pdf',
      sha256: 'pdf-hash',
      storagePath: 'report-images/pdf-hash.pdf',
      localUri: 'file:///private/report-images/pdf-hash.pdf',
    })
    const duplicatePdf = { ...pdf, id: 'pdf-2' }
    const result = reconcileMediaCatalog([], [], [plan([pdf, duplicatePdf])])

    expect(result.assets).toHaveLength(1)
    expect(result.reimbursementPlans[0].materials[0].attachments).toHaveLength(1)
    expect(result.duplicateReimbursementAttachmentsRemoved).toBe(1)
  })

  it('prunes a re-encoded visual duplicate and its unreferenced asset', () => {
    const pixels = new Uint8Array(48 * 96).fill(180)
    const visualFingerprint = `v1:414x2200:${btoa(String.fromCharCode(...pixels))}`
    const original = image({ sha256: 'legacy-hash', visualFingerprint })
    const reencoded = image({
      id: 'reencoded',
      name: 'renamed-copy.jpg',
      sha256: 'file-hash',
      visualFingerprint,
      storagePath: 'report-images/file-hash.jpg',
      localUri: 'file:///private/report-images/file-hash.jpg',
    })

    const result = reconcileMediaCatalog(
      [record([original, reencoded])],
      [],
      [],
      [],
      { pruneUnused: true },
    )

    expect(result.records[0].images).toHaveLength(1)
    expect(result.assets).toHaveLength(1)
    expect(result.duplicateRecordImagesRemoved).toBe(1)
  })

  it('does not bump asset updatedAt when reconcile fills in derived fields', async () => {
    // Simulate the classic drift trigger: startup reconciliation runs and the
    // record image brings a locally-computed visualFingerprint the asset did
    // not carry. That is not a real content change — assets are immutable —
    // so the row's updatedAt must stay put.
    const originalAsset = {
      id: 'sha256:stable-hash',
      name: '检查报告.jpg',
      mimeType: 'image/jpeg',
      dataUrl: '',
      sha256: 'stable-hash',
      storagePath: 'report-images/stable-hash.jpg',
      localUri: 'file:///private/report-images/stable-hash.jpg',
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    }
    const enrichedImage = image({
      id: 'record-image',
      sha256: 'stable-hash',
      storagePath: 'report-images/stable-hash.jpg',
      localUri: 'file:///private/report-images/stable-hash.jpg',
      // Newly computed on this device — the asset row had never seen it.
      visualFingerprint: `v1:48x96:${btoa('L'.repeat(48 * 96))}`,
    })

    const result = reconcileMediaCatalog(
      [record([enrichedImage])],
      [],
      [],
      [originalAsset],
      { pruneUnused: true },
    )

    expect(result.assets).toHaveLength(1)
    expect(result.assets[0].visualFingerprint).toBe(enrichedImage.visualFingerprint)
    // The asset row got a new derived field, but updatedAt is untouched.
    expect(result.assets[0].updatedAt).toBe('2026-07-01T00:00:00.000Z')
    expect(result.assets[0].createdAt).toBe('2026-06-01T00:00:00.000Z')
  })
})
