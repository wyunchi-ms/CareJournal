import type { ExamRecord, MediaAsset, OcrQueueItem, ReimbursementPlan, StoredImage } from '../types'
import { deduplicateStoredImages, storedImageIdentity } from './images'

export interface MediaCatalogResult {
  assets: MediaAsset[]
  changedAssets: MediaAsset[]
  records: ExamRecord[]
  changedRecords: ExamRecord[]
  jobs: OcrQueueItem[]
  changedJobs: OcrQueueItem[]
  reimbursementPlans: ReimbursementPlan[]
  changedReimbursementPlans: ReimbursementPlan[]
  duplicateRecordImagesRemoved: number
  duplicateReimbursementAttachmentsRemoved: number
}

const assetFields = (image: StoredImage) => ({
  name: image.name,
  mimeType: image.mimeType,
  dataUrl: image.dataUrl,
  sha256: image.sha256,
  storagePath: image.storagePath,
  localUri: image.localUri,
  sourceUri: image.sourceUri,
  sourceKey: image.sourceKey,
})

export function mediaAssetId(image: StoredImage) {
  if (image.sha256) return `sha256:${image.sha256}`
  if (image.assetId) return image.assetId
  return storedImageIdentity(image)
}

function createAsset(image: StoredImage, id: string, now: string): MediaAsset {
  return {
    id,
    ...assetFields(image),
    createdAt: now,
    updatedAt: now,
  }
}

function mergeAsset(existing: MediaAsset, image: StoredImage, now: string): MediaAsset {
  const incoming = assetFields(image)
  const next: MediaAsset = { ...existing }
  let changed = false
  for (const [key, value] of Object.entries(incoming) as Array<[keyof typeof incoming, string | undefined]>) {
    if (!value || existing[key]) continue
    Object.assign(next, { [key]: value })
    changed = true
  }
  return changed ? { ...next, updatedAt: now } : existing
}

function hydrateReference<T extends StoredImage>(image: T, asset: MediaAsset): T {
  const assetId = asset.id
  const dataUrl = image.dataUrl || asset.dataUrl
  const sha256 = image.sha256 || asset.sha256
  const storagePath = image.storagePath || asset.storagePath
  const localUri = image.localUri || asset.localUri
  const sourceUri = image.sourceUri || asset.sourceUri
  const sourceKey = image.sourceKey || asset.sourceKey
  if (
    image.assetId === assetId
    && image.dataUrl === dataUrl
    && image.sha256 === sha256
    && image.storagePath === storagePath
    && image.localUri === localUri
    && image.sourceUri === sourceUri
    && image.sourceKey === sourceKey
  ) return image
  return {
    ...image,
    assetId,
    dataUrl,
    sha256,
    storagePath,
    localUri,
    sourceUri,
    sourceKey,
  }
}

export function compactMediaReference<T extends StoredImage>(image: T): T {
  if (!image.assetId) return image
  const compact = { ...image, dataUrl: '' }
  delete compact.storagePath
  delete compact.localUri
  return compact
}

export function compactRecordMedia(record: ExamRecord): ExamRecord {
  return { ...record, images: record.images.map(compactMediaReference) }
}

export function compactOcrJobMedia(job: OcrQueueItem): OcrQueueItem {
  return { ...job, image: compactMediaReference(job.image) }
}

export function compactReimbursementMedia(plan: ReimbursementPlan): ReimbursementPlan {
  return {
    ...plan,
    materials: plan.materials.map((material) => ({
      ...material,
      attachments: material.attachments.map(compactMediaReference),
    })),
  }
}

export function reconcileMediaCatalog(
  records: ExamRecord[],
  jobs: OcrQueueItem[],
  reimbursementPlans: ReimbursementPlan[],
  existingAssets: MediaAsset[] = [],
): MediaCatalogResult {
  const now = new Date().toISOString()
  const originalAssets = new Map(existingAssets.map((asset) => [asset.id, asset]))
  const assets = new Map(originalAssets)

  function link<T extends StoredImage>(image: T): T {
    const id = mediaAssetId(image)
    const existing = assets.get(id)
    const asset = existing ? mergeAsset(existing, image, now) : createAsset(image, id, now)
    assets.set(id, asset)
    return hydrateReference(image, asset)
  }

  let duplicateRecordImagesRemoved = 0
  const changedRecords: ExamRecord[] = []
  const nextRecords = records.map((record) => {
    const linked = record.images.map(link)
    const images = deduplicateStoredImages(linked)
    duplicateRecordImagesRemoved += linked.length - images.length
    const changed = images.length !== record.images.length || images.some((image, index) => image !== record.images[index])
    if (!changed) return record
    const next = { ...record, images }
    changedRecords.push(next)
    return next
  })

  const changedJobs: OcrQueueItem[] = []
  const nextJobs = jobs.map((job) => {
    const image = link(job.image)
    if (image === job.image) return job
    const next = { ...job, image }
    changedJobs.push(next)
    return next
  })

  let duplicateReimbursementAttachmentsRemoved = 0
  const changedReimbursementPlans: ReimbursementPlan[] = []
  const nextPlans = reimbursementPlans.map((plan) => {
    let changed = false
    const materials = plan.materials.map((material) => {
      const linked = material.attachments.map(link)
      const attachments = deduplicateStoredImages(linked) as typeof material.attachments
      duplicateReimbursementAttachmentsRemoved += linked.length - attachments.length
      const materialChanged = attachments.length !== material.attachments.length
        || attachments.some((attachment, index) => attachment !== material.attachments[index])
      if (!materialChanged) return material
      changed = true
      return { ...material, attachments }
    })
    if (!changed) return plan
    const next = { ...plan, materials }
    changedReimbursementPlans.push(next)
    return next
  })

  const nextAssets = [...assets.values()]
  const changedAssets = nextAssets.filter((asset) => originalAssets.get(asset.id) !== asset)
  return {
    assets: nextAssets,
    changedAssets,
    records: nextRecords,
    changedRecords,
    jobs: nextJobs,
    changedJobs,
    reimbursementPlans: nextPlans,
    changedReimbursementPlans,
    duplicateRecordImagesRemoved,
    duplicateReimbursementAttachmentsRemoved,
  }
}
