import { Capacitor, registerPlugin } from '@capacitor/core'
import type { ExamRecord, OcrQueueItem, ReimbursementPlan, StoredImage } from '../types'
import { ensureStoredImageVisualFingerprint, storedImageIdentity } from './images'
import { getHarmonyBridge, isHarmonyPlatform, parseHarmonyResult } from '../platform/harmonyBridge'

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
  return (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') || isHarmonyPlatform()
}

export function storedImageSource(image: StoredImage) {
  if (image.dataUrl) return image.dataUrl
  if (image.localUri && isHarmonyPlatform()) return image.localUri
  if (image.localUri && usesNativeImageStorage()) return Capacitor.convertFileSrc(image.localUri)
  return ''
}

export async function persistStoredImage(image: StoredImage): Promise<StoredImage> {
  if (!usesNativeImageStorage() || !image.dataUrl) return image
  if (image.storagePath && image.localUri) return { ...image, dataUrl: '' }
  const persisted = isHarmonyPlatform()
    ? parseHarmonyResult<PersistedImageResult>(await getHarmonyBridge().persistImage(
      image.id,
      image.mimeType,
      image.dataUrl,
      image.sha256,
    ))
    : await NativeImageStorage.persistImage({
      id: image.id,
      mimeType: image.mimeType,
      dataUrl: image.dataUrl,
      sha256: image.sha256 || undefined,
    })
  return { ...image, ...persisted, dataUrl: '' }
}

export async function materializeNativeStoredImage(image: StoredImage): Promise<StoredImage> {
  if (image.dataUrl || !usesNativeImageStorage() || !image.storagePath) return image
  const loaded = isHarmonyPlatform()
    ? parseHarmonyResult<LoadedImageResult>(await getHarmonyBridge().readImage(image.storagePath))
    : await NativeImageStorage.readImage({ storagePath: image.storagePath })
  return { ...image, ...loaded }
}

export async function addMissingVisualFingerprints(
  records: ExamRecord[],
  reimbursementPlans: ReimbursementPlan[],
) {
  const fingerprints = new Map<string, Promise<string | undefined>>()

  async function fingerprint(image: StoredImage) {
    if (image.visualFingerprint || !image.mimeType.startsWith('image/')) return image
    const identity = storedImageIdentity(image)
    let pending = fingerprints.get(identity)
    if (!pending) {
      pending = materializeNativeStoredImage(image)
        .then(ensureStoredImageVisualFingerprint)
        .then((materialized) => materialized.visualFingerprint)
        .catch((error) => {
          console.warn(`无法为素材 ${image.name} 生成视觉指纹`, error)
          return undefined
        })
      fingerprints.set(identity, pending)
    }
    const visualFingerprint = await pending
    return visualFingerprint ? { ...image, visualFingerprint } : image
  }

  async function fingerprintOwner<T extends StoredImage>(images: T[]) {
    if (images.length < 2 || images.every((image) => image.visualFingerprint || !image.mimeType.startsWith('image/'))) {
      return images
    }
    const next: T[] = []
    for (const image of images) next.push(await fingerprint(image) as T)
    return next
  }

  const nextRecords: ExamRecord[] = []
  for (const record of records) {
    const images = await fingerprintOwner(record.images)
    nextRecords.push(images === record.images ? record : { ...record, images })
  }

  const nextPlans: ReimbursementPlan[] = []
  for (const plan of reimbursementPlans) {
    let changed = false
    const materials: ReimbursementPlan['materials'] = []
    for (const material of plan.materials) {
      const attachments = await fingerprintOwner(material.attachments) as typeof material.attachments
      if (attachments !== material.attachments) changed = true
      materials.push(attachments === material.attachments ? material : { ...material, attachments })
    }
    nextPlans.push(changed ? { ...plan, materials } : plan)
  }
  return { records: nextRecords, reimbursementPlans: nextPlans }
}

export async function migrateLegacyNativeImages(): Promise<ImageMigrationResult> {
  if (!usesNativeImageStorage()) {
    return { migratedEntities: 0, migratedImages: 0, failedEntities: 0, compacted: false }
  }
  if (isHarmonyPlatform()) {
    return { migratedEntities: 0, migratedImages: 0, failedEntities: 0, compacted: false }
  }
  return NativeImageStorage.migrateLegacyImages()
}

export async function garbageCollectNativeImages(records: ExamRecord[], jobs: OcrQueueItem[], reimbursementPlans: ReimbursementPlan[] = []) {
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
  for (const plan of reimbursementPlans) {
    for (const material of plan.materials) {
      for (const attachment of material.attachments) {
        if (attachment.storagePath) storagePaths.add(attachment.storagePath)
      }
    }
  }
  if (isHarmonyPlatform()) {
    return getHarmonyBridge().garbageCollectImages(JSON.stringify([...storagePaths]))
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

export async function makeReimbursementPlansPortable(plans: ReimbursementPlan[]): Promise<ReimbursementPlan[]> {
  const portable: ReimbursementPlan[] = []
  for (const plan of plans) {
    const materials: ReimbursementPlan['materials'] = []
    for (const material of plan.materials) {
      const attachments: typeof material.attachments = []
      for (const attachment of material.attachments) {
        const materialized = await materializeNativeStoredImage(attachment)
        const portableAttachment = { ...attachment, ...materialized }
        delete portableAttachment.storagePath
        delete portableAttachment.localUri
        attachments.push(portableAttachment)
      }
      materials.push({ ...material, attachments })
    }
    portable.push({ ...plan, materials })
  }
  return portable
}

export async function persistRestoredReimbursementPlans(plans: ReimbursementPlan[]): Promise<ReimbursementPlan[]> {
  if (!usesNativeImageStorage()) return plans
  const restored: ReimbursementPlan[] = []
  for (const plan of plans) {
    const materials: ReimbursementPlan['materials'] = []
    for (const material of plan.materials) {
      const attachments: typeof material.attachments = []
      for (const attachment of material.attachments) {
        attachments.push({ ...attachment, ...await persistStoredImage(attachment) })
      }
      materials.push({ ...material, attachments })
    }
    restored.push({ ...plan, materials })
  }
  return restored
}
