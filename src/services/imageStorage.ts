import { Capacitor, registerPlugin } from '@capacitor/core'
import type { ExamRecord, OcrQueueItem, StoredImage } from '../types'

interface PersistedImageResult {
  mimeType: string
  sha256: string
  storagePath: string
  localUri: string
}

interface LoadedImageResult {
  mimeType: string
  dataUrl: string
}

export interface ImageMigrationResult {
  migratedEntities: number
  migratedImages: number
  failedEntities: number
  compacted: boolean
}

interface NativeImageStoragePlugin {
  persistImage(options: {
    id: string
    mimeType: string
    dataUrl: string
    sha256?: string
  }): Promise<PersistedImageResult>
  readImage(options: { storagePath: string }): Promise<LoadedImageResult>
  migrateLegacyImages(): Promise<ImageMigrationResult>
  garbageCollect(options: { storagePaths: string[] }): Promise<{ deleted: number }>
}

const NativeImageStorage = registerPlugin<NativeImageStoragePlugin>('NativeImageStorage')

export function usesNativeImageStorage() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export function storedImageSource(image: StoredImage) {
  if (image.dataUrl) return image.dataUrl
  if (image.localUri && usesNativeImageStorage()) return Capacitor.convertFileSrc(image.localUri)
  return ''
}

export async function persistStoredImage(image: StoredImage): Promise<StoredImage> {
  if (!usesNativeImageStorage() || !image.dataUrl) return image
  if (image.storagePath && image.localUri) return { ...image, dataUrl: '' }
  const persisted = await NativeImageStorage.persistImage({
    id: image.id,
    mimeType: image.mimeType,
    dataUrl: image.dataUrl,
    sha256: image.sha256 || undefined,
  })
  return { ...image, ...persisted, dataUrl: '' }
}

export async function materializeNativeStoredImage(image: StoredImage): Promise<StoredImage> {
  if (image.dataUrl || !usesNativeImageStorage() || !image.storagePath) return image
  const loaded = await NativeImageStorage.readImage({ storagePath: image.storagePath })
  return { ...image, ...loaded }
}

export async function migrateLegacyNativeImages(): Promise<ImageMigrationResult> {
  if (!usesNativeImageStorage()) {
    return { migratedEntities: 0, migratedImages: 0, failedEntities: 0, compacted: false }
  }
  return NativeImageStorage.migrateLegacyImages()
}

export async function garbageCollectNativeImages(records: ExamRecord[], jobs: OcrQueueItem[]) {
  if (!usesNativeImageStorage()) return 0
  const storagePaths = new Set<string>()
  for (const record of records) {
    for (const image of record.images) {
      if (image.storagePath) storagePaths.add(image.storagePath)
    }
  }
  for (const job of jobs) {
    if (job.image.storagePath) storagePaths.add(job.image.storagePath)
  }
  const result = await NativeImageStorage.garbageCollect({ storagePaths: [...storagePaths] })
  return result.deleted
}

export async function makeRecordsPortable(records: ExamRecord[]): Promise<ExamRecord[]> {
  const portable: ExamRecord[] = []
  for (const record of records) {
    const images: StoredImage[] = []
    for (const image of record.images) {
      const materialized = await materializeNativeStoredImage(image)
      const portableImage = { ...materialized }
      delete portableImage.storagePath
      delete portableImage.localUri
      images.push(portableImage)
    }
    portable.push({ ...record, images })
  }
  return portable
}

export async function persistRestoredRecords(records: ExamRecord[]): Promise<ExamRecord[]> {
  if (!usesNativeImageStorage()) return records
  const restored: ExamRecord[] = []
  for (const record of records) {
    const images: StoredImage[] = []
    for (const image of record.images) images.push(await persistStoredImage(image))
    restored.push({ ...record, images })
  }
  return restored
}
