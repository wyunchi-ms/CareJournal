import { Capacitor, registerPlugin } from '@capacitor/core'
import type { StoredImage } from '../types'
import { newId } from '../types'
import { materializeNativeStoredImage } from './imageStorage'
import { ensureStoredImageVisualFingerprint } from './images'

export interface FolderImageSource {
  uri: string
  name: string
  mimeType: string
  relativePath: string
  size: number
  lastModified: number
  sourceKey: string
}

interface PickFolderResult {
  cancelled: boolean
  folderName?: string
  files: FolderImageSource[]
}

interface LoadedFolderImage {
  mimeType: string
  dataUrl: string
  sha256: string
  storagePath: string
  localUri: string
}

interface FolderImportPlugin {
  pickFolder(): Promise<PickFolderResult>
  loadImage(options: { uri: string }): Promise<LoadedFolderImage>
}

const FolderImport = registerPlugin<FolderImportPlugin>('FolderImport')

export function canImportAndroidFolder() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function pickAndroidImageFolder() {
  if (!canImportAndroidFolder()) throw new Error('文件夹扫描仅支持 Android')
  return FolderImport.pickFolder()
}

export function folderSourceToStoredImage(source: FolderImageSource): StoredImage {
  return {
    id: newId(),
    name: source.name,
    mimeType: source.mimeType,
    dataUrl: '',
    sha256: '',
    sourceUri: source.uri,
    sourceKey: source.sourceKey,
    relativePath: source.relativePath,
  }
}

export async function materializeStoredImage(image: StoredImage): Promise<StoredImage> {
  if (image.dataUrl) return image
  if (image.storagePath) {
    try {
      return await materializeNativeStoredImage(image)
    } catch (error) {
      if (!image.sourceUri) throw error
    }
  }
  if (!image.sourceUri || !canImportAndroidFolder()) throw new Error('图片内容不可用，请重新选择原文件或文件夹')
  const loaded = await FolderImport.loadImage({ uri: image.sourceUri })
  return ensureStoredImageVisualFingerprint({ ...image, ...loaded })
}
