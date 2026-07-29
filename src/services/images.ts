import type { StoredImage } from '../types'
import { newId } from '../types'

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value)
  return sha256Bytes(bytes)
}

async function sha256Bytes(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function dataUrlSha256(dataUrl: string) {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return sha256(dataUrl)
  const metadata = dataUrl.slice(0, comma)
  const payload = dataUrl.slice(comma + 1)
  if (!metadata.includes(';base64')) return sha256Bytes(new TextEncoder().encode(decodeURIComponent(payload)))
  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return sha256Bytes(bytes)
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

const VISUAL_FINGERPRINT_WIDTH = 48
const VISUAL_FINGERPRINT_HEIGHT = 96
const VISUAL_FINGERPRINT_PREFIX = 'v1'

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let start = 0; start < bytes.length; start += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(start, start + chunkSize))
  }
  return btoa(binary)
}

function visualFingerprintFromSource(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = VISUAL_FINGERPRINT_WIDTH
  canvas.height = VISUAL_FINGERPRINT_HEIGHT
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('当前设备无法生成图片指纹')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data
  const luminance = new Uint8Array(canvas.width * canvas.height)
  for (let sourceIndex = 0, targetIndex = 0; sourceIndex < rgba.length; sourceIndex += 4, targetIndex += 1) {
    luminance[targetIndex] = Math.round(
      rgba[sourceIndex] * 0.299
      + rgba[sourceIndex + 1] * 0.587
      + rgba[sourceIndex + 2] * 0.114,
    )
  }
  return `${VISUAL_FINGERPRINT_PREFIX}:${width}x${height}:${bytesToBase64(luminance)}`
}

export async function createVisualFingerprint(dataUrl: string) {
  const source = await loadImage(dataUrl)
  return visualFingerprintFromSource(source, source.naturalWidth || source.width, source.naturalHeight || source.height)
}

export async function ensureStoredImageVisualFingerprint<T extends StoredImage>(image: T): Promise<T> {
  if (image.visualFingerprint || !image.dataUrl || !image.mimeType.startsWith('image/')) return image
  return { ...image, visualFingerprint: await createVisualFingerprint(image.dataUrl) }
}

interface ParsedVisualFingerprint {
  width: number
  height: number
  luminance: Uint8Array
}

function parseVisualFingerprint(value: string): ParsedVisualFingerprint | null {
  const match = /^v1:(\d+)x(\d+):([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match) return null
  try {
    const binary = atob(match[3])
    if (binary.length !== VISUAL_FINGERPRINT_WIDTH * VISUAL_FINGERPRINT_HEIGHT) return null
    return {
      width: Number(match[1]),
      height: Number(match[2]),
      luminance: Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    }
  } catch {
    return null
  }
}

export function sameVisualFingerprint(first: string, second: string) {
  if (first === second) return true
  const left = parseVisualFingerprint(first)
  const right = parseVisualFingerprint(second)
  if (!left || !right || left.width !== right.width || left.height !== right.height) return false
  let absoluteDifference = 0
  let materiallyDifferentPixels = 0
  for (let index = 0; index < left.luminance.length; index += 1) {
    const difference = Math.abs(left.luminance[index] - right.luminance[index])
    absoluteDifference += difference
    if (difference > 3) materiallyDifferentPixels += 1
  }
  const meanDifference = absoluteDifference / left.luminance.length
  return meanDifference <= 0.75 && materiallyDifferentPixels / left.luminance.length <= 0.002
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
    sha256: await dataUrlSha256(dataUrl),
    visualFingerprint: visualFingerprintFromSource(canvas, canvas.width, canvas.height),
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
    sha256: await dataUrlSha256(dataUrl),
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
  if (
    first.visualFingerprint
    && second.visualFingerprint
    && first.mimeType.startsWith('image/')
    && second.mimeType.startsWith('image/')
    && sameVisualFingerprint(first.visualFingerprint, second.visualFingerprint)
  ) return true
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
