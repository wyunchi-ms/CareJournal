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

export function storedImageIdentity(image: StoredImage) {
  return image.sourceKey ? `source:${image.sourceKey}` : `sha256:${image.sha256}`
}

export function sameStoredImage(first: StoredImage, second: StoredImage) {
  return storedImageIdentity(first) === storedImageIdentity(second)
}
