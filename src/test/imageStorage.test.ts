import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExamRecord, OcrQueueItem, StoredImage } from '../types'

const nativeState = vi.hoisted(() => ({ enabled: false }))
const nativePlugin = vi.hoisted(() => ({
  persistImage: vi.fn(),
  readImage: vi.fn(),
  migrateLegacyImages: vi.fn(),
  garbageCollect: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => nativeState.enabled,
    getPlatform: () => nativeState.enabled ? 'android' : 'web',
    convertFileSrc: (value: string) => `local:${value}`,
  },
  registerPlugin: () => nativePlugin,
}))

import {
  garbageCollectNativeImages,
  makeRecordsPortable,
  materializeNativeStoredImage,
  migrateLegacyNativeImages,
  persistRestoredRecords,
  persistStoredImage,
  storedImageSource,
} from '../services/imageStorage'

function image(overrides: Partial<StoredImage> = {}): StoredImage {
  return {
    id: 'image-1',
    name: 'report.jpg',
    mimeType: 'image/jpeg',
    dataUrl: 'data:image/jpeg;base64,YQ==',
    sha256: 'hash',
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
    fingerprint: 'fingerprint',
    ocrStatus: 'completed',
    ocrAttempts: 1,
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  }
}

afterEach(() => {
  nativeState.enabled = false
  vi.clearAllMocks()
})

describe('native image storage bridge', () => {
  it('keeps browser images in IndexedDB-compatible Base64 form', async () => {
    const source = image()

    await expect(persistStoredImage(source)).resolves.toBe(source)
    expect(storedImageSource(source)).toBe(source.dataUrl)
    await expect(migrateLegacyNativeImages()).resolves.toEqual({
      migratedEntities: 0,
      migratedImages: 0,
      failedEntities: 0,
      compacted: false,
    })
    expect(nativePlugin.persistImage).not.toHaveBeenCalled()
  })

  it('persists Base64 once and keeps only a private-file reference', async () => {
    nativeState.enabled = true
    nativePlugin.persistImage.mockResolvedValue({
      mimeType: 'image/jpeg',
      sha256: 'hash',
      storagePath: 'report-images/hash.jpg',
      localUri: 'file:///private/report-images/hash.jpg',
    })

    const stored = await persistStoredImage(image())

    expect(stored).toMatchObject({
      dataUrl: '',
      storagePath: 'report-images/hash.jpg',
      localUri: 'file:///private/report-images/hash.jpg',
    })
    expect(storedImageSource(stored)).toBe('local:file:///private/report-images/hash.jpg')
    expect(nativePlugin.persistImage).toHaveBeenCalledTimes(1)
  })

  it('materializes a private file only when OCR or backup needs its bytes', async () => {
    nativeState.enabled = true
    nativePlugin.readImage.mockResolvedValue({
      mimeType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,YQ==',
    })
    const stored = image({
      dataUrl: '',
      storagePath: 'report-images/hash.jpg',
      localUri: 'file:///private/report-images/hash.jpg',
    })

    await expect(materializeNativeStoredImage(stored)).resolves.toMatchObject({
      storagePath: 'report-images/hash.jpg',
      dataUrl: 'data:image/jpeg;base64,YQ==',
    })
    const portable = await makeRecordsPortable([record([stored])])
    expect(portable[0].images[0]).toMatchObject({ dataUrl: 'data:image/jpeg;base64,YQ==' })
    expect(portable[0].images[0]).not.toHaveProperty('storagePath')
    expect(portable[0].images[0]).not.toHaveProperty('localUri')
  })

  it('restores portable backup images into private files and garbage-collects unreferenced files', async () => {
    nativeState.enabled = true
    nativePlugin.persistImage.mockResolvedValue({
      mimeType: 'image/jpeg',
      sha256: 'hash',
      storagePath: 'report-images/hash.jpg',
      localUri: 'file:///private/report-images/hash.jpg',
    })
    nativePlugin.garbageCollect.mockResolvedValue({ deleted: 2 })

    const restored = await persistRestoredRecords([record([image()])])
    const job = {
      image: image({ dataUrl: '', storagePath: 'report-images/job.jpg' }),
    } as OcrQueueItem
    await expect(garbageCollectNativeImages(restored, [job])).resolves.toBe(2)

    expect(restored[0].images[0].dataUrl).toBe('')
    expect(nativePlugin.garbageCollect).toHaveBeenCalledWith({
      storagePaths: ['report-images/hash.jpg', 'report-images/job.jpg'],
    })
  })
})
