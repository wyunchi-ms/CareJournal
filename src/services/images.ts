import type { StoredImage } from '../types'
import { newId } from '../types'

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片解码失败'))
    image.src = dataUrl
  })
}

export async function prepareImage(file: File): Promise<StoredImage> {
  const original = await readFile(file)
  const source = await loadImage(original)
  const maxDimension = 2200
  const ratio = Math.min(1, maxDimension / Math.max(source.width, source.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(source.width * ratio)
  canvas.height = Math.round(source.height * ratio)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前设备无法处理图片')
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.86)
  return {
    id: newId(),
    name: file.name,
    mimeType: 'image/jpeg',
    dataUrl,
    sha256: await sha256(dataUrl),
  }
}

export async function preparePdf(file: File): Promise<StoredImage> {
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) throw new Error('所选文件不是 PDF')
  if (file.size > 30 * 1024 * 1024) throw new Error('单个 PDF 不能超过 30 MB')
  const dataUrl = await readFile(file)
  return {
    id: newId(),
    name: file.name,
    mimeType: 'application/pdf',
    dataUrl,
    sha256: await sha256(dataUrl),
  }
}

export function storedImageIdentity(image: StoredImage) {
  if (image.assetId) return `asset:${image.assetId}`
  if (image.sha256) return `sha256:${image.sha256}`
  if (image.sourceKey) return `source:${image.sourceKey}`
  if (image.storagePath) return `storage:${image.storagePath}`
  if (image.localUri) return `uri:${image.localUri}`
  return `id:${image.id}`
}

export function sameStoredImage(first: StoredImage, second: StoredImage) {
  if (first.assetId && second.assetId && first.assetId === second.assetId) return true
  if (first.sha256 && second.sha256 && first.sha256 === second.sha256) return true
  if (first.sourceKey && second.sourceKey && first.sourceKey === second.sourceKey) return true
  if (first.storagePath && second.storagePath && first.storagePath === second.storagePath) return true
  if (first.localUri && second.localUri && first.localUri === second.localUri) return true
  const firstHasStableIdentity = Boolean(first.sha256 || first.sourceKey || first.storagePath || first.localUri)
  const secondHasStableIdentity = Boolean(second.sha256 || second.sourceKey || second.storagePath || second.localUri)
  return !firstHasStableIdentity && !secondHasStableIdentity && Boolean(first.id && second.id && first.id === second.id)
}

export function deduplicateStoredImages(images: StoredImage[]) {
  const unique: StoredImage[] = []
  for (const image of images) {
    if (!unique.some((known) => sameStoredImage(known, image))) unique.push(image)
  }
  return unique
}
