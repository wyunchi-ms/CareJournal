import { describe, expect, it } from 'vitest'
import { deduplicateStoredImages, sameStoredImage, storedImageIdentity } from '../services/images'
import type { StoredImage } from '../types'

function image(overrides: Partial<StoredImage> = {}): StoredImage {
  return { id: '1', name: 'report.jpg', mimeType: 'image/jpeg', dataUrl: '', sha256: 'hash', ...overrides }
}

describe('stored image identity', () => {
  it('uses content hashes when available and falls back to the persisted folder source', () => {
    expect(storedImageIdentity(image({ sourceKey: 'folder-item' }))).toBe('sha256:hash')
    expect(storedImageIdentity(image({ sourceKey: 'folder-item', sha256: '' }))).toBe('source:folder-item')
    expect(sameStoredImage(
      image({ sourceKey: 'folder-item', sha256: '' }),
      image({ sourceKey: 'folder-item', sha256: 'compressed-hash', dataUrl: 'data:image/jpeg;base64,abc' }),
    )).toBe(true)
  })

  it('continues deduplicating regular selected images by their hash', () => {
    expect(sameStoredImage(image({ sha256: 'same' }), image({ id: '2', sha256: 'same' }))).toBe(true)
    expect(sameStoredImage(image({ sha256: 'first' }), image({ sha256: 'second' }))).toBe(false)
  })

  it('removes duplicates matched by either content or source while retaining order', () => {
    const first = image({ id: 'first', sourceKey: 'folder-one', sha256: 'same-content' })
    const duplicateContent = image({ id: 'second', sourceKey: 'folder-two', sha256: 'same-content' })
    const duplicateSource = image({ id: 'third', sourceKey: 'folder-one', sha256: 'recompressed-content' })
    const distinct = image({ id: 'fourth', sourceKey: 'folder-four', sha256: 'different-content' })

    expect(deduplicateStoredImages([first, duplicateContent, duplicateSource, distinct])).toEqual([first, distinct])
  })
})
