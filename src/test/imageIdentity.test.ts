import { describe, expect, it } from 'vitest'
import { sameStoredImage, storedImageIdentity } from '../services/images'
import type { StoredImage } from '../types'

function image(overrides: Partial<StoredImage> = {}): StoredImage {
  return { id: '1', name: 'report.jpg', mimeType: 'image/jpeg', dataUrl: '', sha256: 'hash', ...overrides }
}

describe('stored image identity', () => {
  it('uses the persisted folder source before content hashes', () => {
    expect(storedImageIdentity(image({ sourceKey: 'folder-item' }))).toBe('source:folder-item')
    expect(sameStoredImage(
      image({ sourceKey: 'folder-item', sha256: '' }),
      image({ sourceKey: 'folder-item', sha256: 'compressed-hash', dataUrl: 'data:image/jpeg;base64,abc' }),
    )).toBe(true)
  })

  it('continues deduplicating regular selected images by their hash', () => {
    expect(sameStoredImage(image({ sha256: 'same' }), image({ id: '2', sha256: 'same' }))).toBe(true)
    expect(sameStoredImage(image({ sha256: 'first' }), image({ sha256: 'second' }))).toBe(false)
  })
})
