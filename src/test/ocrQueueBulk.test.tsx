import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppProvider, useApp } from '../store/AppContext'
import type { StoredImage } from '../types'

const storedJobs = vi.hoisted(() => new Map<string, unknown>())

vi.mock('../db/repository', () => ({
  repository: {
    native: false,
    removePersistedCompletedOcrJobs: vi.fn(),
    list: vi.fn(async (kind: string) => kind === 'ocrJob' ? [...storedJobs.values()] : []),
    put: vi.fn(async (kind: string, id: string, payload: unknown) => { if (kind === 'ocrJob') storedJobs.set(id, payload) }),
    remove: vi.fn(async (kind: string, id: string) => { if (kind === 'ocrJob') storedJobs.delete(id) }),
    replaceKind: vi.fn(),
  },
}))

function image(index: number): StoredImage {
  return {
    id: `image-${index}`,
    name: `${index}.jpg`,
    mimeType: 'image/jpeg',
    dataUrl: '',
    sha256: '',
    sourceUri: `content://image/${index}`,
    sourceKey: `folder-image-${index}`,
  }
}

function QueueHarness() {
  const { ready, ocrJobs, enqueueOcrImage } = useApp()
  return <>
    <span>{ready ? `队列 ${ocrJobs.length}` : '加载中'}</span>
    <button onClick={() => void (async () => {
      for (let index = 0; index < 120; index += 1) await enqueueOcrImage(image(index))
    })()}>批量加入</button>
  </>
}

afterEach(() => {
  cleanup()
  storedJobs.clear()
})

describe('bulk OCR queue', () => {
  it('keeps every lightweight folder item while React renders during enqueueing', async () => {
    render(<AppProvider><QueueHarness /></AppProvider>)
    await screen.findByText('队列 0')

    fireEvent.click(screen.getByRole('button', { name: '批量加入' }))

    await waitFor(() => expect(screen.getByText('队列 120')).toBeInTheDocument(), { timeout: 10000 })
    expect(storedJobs.size).toBe(120)
  })
})
