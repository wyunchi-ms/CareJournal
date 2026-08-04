/**
 * Tauri desktop platform integration tests.
 *
 * Verifies that every service function routes correctly through
 * tauriBridge when __TAURI_INTERNALS__ is present, without disturbing
 * Web / Capacitor / Harmony paths.
 *
 * @tauri-apps/api/core (invoke) and @tauri-apps/api/event (listen) are
 * both mocked so the tests run in jsdom without a real Tauri WebView.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LanEncryptedEnvelope } from '../services/lanSync'

// ── Hoisted mock implementations ──────────────────────────────────────────────
const tauriInvokeImpl = vi.hoisted(() => vi.fn())
const tauriListenImpl = vi.hoisted(() =>
  vi.fn(async (...args: [string, unknown]) => { void args; return vi.fn() }),
)

// Mock lazy-imported Tauri API modules.
// vi.mock() is hoisted and intercepts both static and dynamic imports.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => tauriInvokeImpl(cmd, args),
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, handler: unknown) => tauriListenImpl(event, handler),
}))

// Prevent Capacitor from being treated as a native platform.
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
    getPlatform: () => 'web',
    convertFileSrc: (v: string) => `local:${v}`,
  },
  registerPlugin: () => ({}),
  CapacitorHttp: {},
}))

// Prevent HarmonyOS bridge from interfering.
vi.mock('../platform/harmonyBridge', () => ({
  isHarmonyPlatform: () => false,
  getHarmonyBridge: () => { throw new Error('no harmony bridge in tauri test') },
  parseHarmonyResult: (v: string) => JSON.parse(v) as unknown,
  addHarmonyEventListener: () => () => undefined,
}))

// ── Import services AFTER all vi.mock() declarations ──────────────────────────
import { isTauriPlatform, tauriConvertFileSrc } from '../platform/tauriBridge'
import {
  garbageCollectNativeImages,
  materializeNativeStoredImage,
  migrateLegacyNativeImages,
  persistStoredImage,
  storedImageSource,
  usesNativeImageStorage,
} from '../services/imageStorage'
import { testLlmConnection } from '../services/ocr'
import { lanSyncTransport } from '../services/lanSyncTransport'
import { downloadBlob } from '../services/backup'
import type { ExamRecord, LlmSettings, OcrQueueItem, StoredImage } from '../types'
import type { LanPeer } from '../services/lanSyncTransport'

// ── Helpers ───────────────────────────────────────────────────────────────────
function enableTauri() {
  ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
    convertFileSrc: (path: string) => `tauri-asset://${path}`,
  }
}

function disableTauri() {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
}

function makeImage(overrides: Partial<StoredImage> = {}): StoredImage {
  return {
    id: 'img-1',
    name: 'report.jpg',
    mimeType: 'image/jpeg',
    dataUrl: 'data:image/jpeg;base64,YQ==',
    sha256: 'abc123',
    ...overrides,
  }
}

function makeRecord(images: StoredImage[]): ExamRecord {
  return {
    id: 'record-1',
    reportType: '血常规',
    sampleDate: '2026-08-01',
    indicators: [],
    images,
    linkedEventIds: [],
    fingerprint: 'fp',
    ocrStatus: 'completed',
    ocrAttempts: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
beforeEach(() => {
  enableTauri()
})

afterEach(async () => {
  await lanSyncTransport.stop().catch(() => undefined)
  disableTauri()
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// Platform detection
// ─────────────────────────────────────────────────────────────────────────────
describe('isTauriPlatform', () => {
  it('returns true when __TAURI_INTERNALS__ is present', () => {
    expect(isTauriPlatform()).toBe(true)
  })

  it('returns false when __TAURI_INTERNALS__ is absent', () => {
    disableTauri()
    expect(isTauriPlatform()).toBe(false)
  })
})

describe('tauriConvertFileSrc', () => {
  it('delegates to __TAURI_INTERNALS__.convertFileSrc when available', () => {
    expect(tauriConvertFileSrc('/some/path/report.jpg')).toBe('tauri-asset:///some/path/report.jpg')
  })

  it('falls back to manual URL construction when internals absent', () => {
    disableTauri()
    const url = tauriConvertFileSrc('/path/report.jpg')
    expect(url).toMatch(/^(asset:\/\/localhost\/|https:\/\/asset\.localhost\/)/)
    expect(url).toContain(encodeURIComponent('/path/report.jpg'))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// imageStorage
// ─────────────────────────────────────────────────────────────────────────────
describe('imageStorage on Tauri', () => {
  it('usesNativeImageStorage returns true', () => {
    expect(usesNativeImageStorage()).toBe(true)
  })

  it('storedImageSource uses tauriConvertFileSrc for localUri', () => {
    const img = makeImage({
      dataUrl: '',
      localUri: '/private/images/abc123.jpg',
    })
    expect(storedImageSource(img)).toBe('tauri-asset:///private/images/abc123.jpg')
  })

  it('storedImageSource still returns dataUrl when present', () => {
    const img = makeImage()
    expect(storedImageSource(img)).toBe(img.dataUrl)
  })

  it('persistStoredImage calls desktop_persist_image and clears dataUrl', async () => {
    tauriInvokeImpl.mockResolvedValueOnce({
      mimeType: 'image/jpeg',
      sha256: 'abc123',
      storagePath: 'images/abc123.jpg',
      localUri: '/private/images/abc123.jpg',
    })

    const stored = await persistStoredImage(makeImage())

    expect(tauriInvokeImpl).toHaveBeenCalledWith('desktop_persist_image', {
      id: 'img-1',
      mimeType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,YQ==',
      sha256: 'abc123',
    })
    expect(stored.dataUrl).toBe('')
    expect(stored.storagePath).toBe('images/abc123.jpg')
    expect(stored.localUri).toBe('/private/images/abc123.jpg')
  })

  it('persistStoredImage skips command when storagePath+localUri already present', async () => {
    const img = makeImage({ dataUrl: '', storagePath: 'images/abc123.jpg', localUri: '/p/abc123.jpg' })
    const result = await persistStoredImage(img)
    expect(tauriInvokeImpl).not.toHaveBeenCalled()
    expect(result.dataUrl).toBe('')
  })

  it('persistStoredImage is a no-op when there is no dataUrl', async () => {
    const img = makeImage({ dataUrl: '' })
    const result = await persistStoredImage(img)
    expect(tauriInvokeImpl).not.toHaveBeenCalled()
    expect(result).toBe(img)
  })

  it('materializeNativeStoredImage calls desktop_read_image', async () => {
    tauriInvokeImpl.mockResolvedValueOnce({
      mimeType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,YQ==',
    })
    const img = makeImage({ dataUrl: '', storagePath: 'images/abc123.jpg' })

    const result = await materializeNativeStoredImage(img)

    expect(tauriInvokeImpl).toHaveBeenCalledWith('desktop_read_image', {
      storagePath: 'images/abc123.jpg',
    })
    expect(result.dataUrl).toBe('data:image/jpeg;base64,YQ==')
    expect(result.storagePath).toBe('images/abc123.jpg')
  })

  it('migrateLegacyNativeImages returns empty result on Tauri (no migration needed)', async () => {
    await expect(migrateLegacyNativeImages()).resolves.toEqual({
      migratedEntities: 0,
      migratedImages: 0,
      failedEntities: 0,
      compacted: false,
    })
    expect(tauriInvokeImpl).not.toHaveBeenCalled()
  })

  it('garbageCollectNativeImages calls desktop_garbage_collect_images with active storagePaths', async () => {
    tauriInvokeImpl.mockResolvedValueOnce({ deleted: 3 })
    const img = makeImage({ dataUrl: '', storagePath: 'images/abc123.jpg' })
    const job = { image: makeImage({ dataUrl: '', storagePath: 'images/job.jpg' }) } as OcrQueueItem

    const deleted = await garbageCollectNativeImages([makeRecord([img])], [job])

    expect(tauriInvokeImpl).toHaveBeenCalledWith('desktop_garbage_collect_images', {
      storagePaths: expect.arrayContaining(['images/abc123.jpg', 'images/job.jpg']),
    })
    expect(deleted).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ocr – desktop_llm_post
// ─────────────────────────────────────────────────────────────────────────────
describe('testLlmConnection on Tauri', () => {
  const llmSettings: LlmSettings = {
    activeProvider: 'azure-openai',
    providers: {
      'azure-openai': {
        endpoint: 'https://example.openai.azure.com/openai/v1',
        apiKey: 'test-key',
        model: 'gpt-4o',
        maxRetries: 1,
      },
    },
  }

  it('routes the LLM request through desktop_llm_post with api-key header', async () => {
    tauriInvokeImpl.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { choices: [{ message: { content: 'OK' } }] },
      detail: '',
    })

    await expect(testLlmConnection(llmSettings)).resolves.toBeUndefined()

    expect(tauriInvokeImpl).toHaveBeenCalledWith(
      'desktop_llm_post',
      expect.objectContaining({
        url: 'https://example.openai.azure.com/openai/v1/chat/completions',
        headers: expect.objectContaining({ 'api-key': 'test-key', 'Content-Type': 'application/json' }),
        provider: 'azure-openai',
      }),
    )
    // Must NOT fall through to fetch proxy — no fetch call should have occurred
    expect(tauriInvokeImpl).toHaveBeenCalledTimes(1)
  })

  it('uses Bearer token for non-Azure providers', async () => {
    tauriInvokeImpl.mockResolvedValueOnce({ ok: true, status: 200, data: {}, detail: '' })

    const openAiSettings: LlmSettings = {
      activeProvider: 'openai',
      providers: {
        openai: {
          endpoint: 'https://api.openai.com/v1',
          apiKey: 'sk-test',
          model: 'gpt-4o',
          maxRetries: 1,
        },
      },
    }
    await testLlmConnection(openAiSettings).catch(() => undefined)

    expect(tauriInvokeImpl).toHaveBeenCalledWith(
      'desktop_llm_post',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }),
        provider: 'openai',
      }),
    )
  })

  it('throws when desktop_llm_post returns a non-OK status', async () => {
    tauriInvokeImpl.mockResolvedValueOnce({
      ok: false,
      status: 401,
      data: {},
      detail: 'Unauthorized',
    })

    await expect(testLlmConnection(llmSettings)).rejects.toThrow('连接失败')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// lanSyncTransport
// ─────────────────────────────────────────────────────────────────────────────
describe('lanSyncTransport on Tauri', () => {
  /**
   * Helper that sets up the 3 invoke calls consumed by start():
   *   1. desktop_lan_start  → LanServiceInfo
   *   2. desktop_lan_refresh → void (return value ignored)
   *   3. desktop_lan_list   → { peers: [] }
   */
  function mockStartSequence(infoOverrides: Partial<{ alias: string; fingerprint: string; publicKey: string; port: number; transport: string }> = {}) {
    tauriInvokeImpl
      .mockResolvedValueOnce({ alias: 'D', fingerprint: 'fp', publicKey: 'pk', port: 53320, transport: 'native', ...infoOverrides })
      .mockResolvedValueOnce(undefined)       // desktop_lan_refresh (return value ignored)
      .mockResolvedValueOnce({ peers: [] })   // desktop_lan_list
  }

  it('start() invokes desktop_lan_start and subscribes to both events', async () => {
    tauriInvokeImpl
      .mockResolvedValueOnce({ alias: 'Desktop', fingerprint: 'fp-tauri', publicKey: 'pk-tauri', port: 53320, transport: 'native' })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ peers: [] })

    const info = await lanSyncTransport.start('Desktop', 'pk-tauri')

    expect(info).toMatchObject({ fingerprint: 'fp-tauri', port: 53320, transport: 'native' })
    expect(tauriInvokeImpl).toHaveBeenCalledWith('desktop_lan_start', {
      alias: 'Desktop',
      publicKey: 'pk-tauri',
    })
    // Both event channels must be registered
    expect(tauriListenImpl).toHaveBeenCalledWith('desktop://peers-changed', expect.any(Function))
    expect(tauriListenImpl).toHaveBeenCalledWith('desktop://sync-request', expect.any(Function))
  })

  it('stop() invokes desktop_lan_stop and calls all unlisteners', async () => {
    const unlisten1 = vi.fn()
    const unlisten2 = vi.fn()
    tauriListenImpl
      .mockResolvedValueOnce(unlisten1)
      .mockResolvedValueOnce(unlisten2)
    mockStartSequence()

    await lanSyncTransport.start('D', 'pk')
    vi.clearAllMocks()

    await lanSyncTransport.stop()

    expect(tauriInvokeImpl).toHaveBeenCalledWith('desktop_lan_stop', undefined)
    expect(unlisten1).toHaveBeenCalled()
    expect(unlisten2).toHaveBeenCalled()
  })

  it('cleans up and rethrows when desktop_lan_start fails', async () => {
    tauriInvokeImpl.mockRejectedValueOnce(new Error('port already in use'))

    await expect(lanSyncTransport.start('D', 'pk')).rejects.toThrow('port already in use')

    expect(tauriInvokeImpl).toHaveBeenCalledWith('desktop_lan_stop', undefined)
  })

  it('refresh() invokes desktop_lan_refresh then desktop_lan_list', async () => {
    mockStartSequence()
    // Additional mocks consumed by the explicit refresh() call
    tauriInvokeImpl
      .mockResolvedValueOnce(undefined)   // desktop_lan_refresh
      .mockResolvedValueOnce({ peers: [{ fingerprint: 'peer-1', alias: 'Phone', deviceType: 'mobile', publicKey: 'pk2', host: '192.168.1.2', port: 53318, lastSeen: 0 }] })

    await lanSyncTransport.start('D', 'pk')
    const peersSeen: unknown[] = []
    lanSyncTransport.onPeers((peers) => peersSeen.push(...peers))

    await lanSyncTransport.refresh()

    const refreshCall = tauriInvokeImpl.mock.calls.find(([cmd]) => cmd === 'desktop_lan_refresh')
    const listCall = tauriInvokeImpl.mock.calls.find(([cmd]) => cmd === 'desktop_lan_list')
    expect(refreshCall).toBeDefined()
    expect(listCall).toBeDefined()
    expect(peersSeen).toHaveLength(1)
  })

  it('sendSync() invokes desktop_lan_send with serialized envelope', async () => {
    const outgoing = { version: 1, nonce: 'abc' } as unknown as LanEncryptedEnvelope
    const incoming = { version: 1, nonce: 'xyz' } as unknown as LanEncryptedEnvelope
    mockStartSequence()
    tauriInvokeImpl.mockResolvedValueOnce({ envelope: JSON.stringify(incoming) })

    await lanSyncTransport.start('D', 'pk')

    const result = await lanSyncTransport.sendSync({ host: '10.0.0.1', port: 53318 }, outgoing)

    expect(tauriInvokeImpl).toHaveBeenCalledWith('desktop_lan_send', {
      host: '10.0.0.1',
      port: 53318,
      envelope: JSON.stringify(outgoing),
    })
    expect(result).toEqual(incoming)
  })

  it('completeSync() invokes desktop_lan_complete', async () => {
    mockStartSequence()
    tauriInvokeImpl.mockResolvedValueOnce(undefined)

    await lanSyncTransport.start('D', 'pk')
    const env = {} as LanEncryptedEnvelope

    await lanSyncTransport.completeSync('req-1', env)

    expect(tauriInvokeImpl).toHaveBeenCalledWith('desktop_lan_complete', {
      requestId: 'req-1',
      envelope: JSON.stringify(env),
    })
  })

  it('rejectSync() invokes desktop_lan_reject', async () => {
    mockStartSequence()
    tauriInvokeImpl.mockResolvedValueOnce(undefined)

    await lanSyncTransport.start('D', 'pk')

    await lanSyncTransport.rejectSync('req-2', 'too large')

    expect(tauriInvokeImpl).toHaveBeenCalledWith('desktop_lan_reject', {
      requestId: 'req-2',
      error: 'too large',
    })
  })

  it('setTransferActive() invokes desktop_lan_set_transfer_active', async () => {
    tauriInvokeImpl.mockResolvedValue(undefined)

    await lanSyncTransport.setTransferActive(true)
    await lanSyncTransport.setTransferActive(false)

    expect(tauriInvokeImpl).toHaveBeenCalledWith('desktop_lan_set_transfer_active', { active: true })
    expect(tauriInvokeImpl).toHaveBeenCalledWith('desktop_lan_set_transfer_active', { active: false })
  })

  it('desktop://peers-changed event propagates to onPeers listeners', async () => {
    const peers: LanPeer[] = [{ fingerprint: 'p', alias: 'Phone', deviceType: 'mobile', publicKey: 'pk', host: '1.2.3.4', port: 53318, lastSeen: 1 }]
    // tauriListen wraps the caller's handler as (e) => handler(e.payload).
    // We capture that outer wrapper and invoke it with the Tauri event shape.
    let capturedWrapper: ((e: { payload: { peers: LanPeer[] } }) => void) | undefined
    tauriListenImpl.mockImplementation(async (event: string, wrapper: unknown) => {
      if (event === 'desktop://peers-changed') capturedWrapper = wrapper as typeof capturedWrapper
      return vi.fn()
    })
    mockStartSequence()

    await lanSyncTransport.start('D', 'pk')

    const received: LanPeer[][] = []
    lanSyncTransport.onPeers((p) => received.push(p))

    capturedWrapper?.({ payload: { peers } })

    expect(received[0]).toEqual(peers)
  })

  it('desktop://sync-request event propagates to onRequest listeners with parsed envelope', async () => {
    const envelope = { version: 1, nonce: 'n' } as unknown as LanEncryptedEnvelope
    // Same Tauri event-shape wrapping: wrapper receives { payload: T }.
    let capturedWrapper: ((e: { payload: { requestId: string; envelope: string; peerAddress?: string } }) => void) | undefined
    tauriListenImpl.mockImplementation(async (event: string, wrapper: unknown) => {
      if (event === 'desktop://sync-request') capturedWrapper = wrapper as typeof capturedWrapper
      return vi.fn()
    })
    mockStartSequence()

    await lanSyncTransport.start('D', 'pk')

    const received: { requestId: string; envelope: LanEncryptedEnvelope }[] = []
    lanSyncTransport.onRequest((req) => received.push({ requestId: req.requestId, envelope: req.envelope }))

    capturedWrapper?.({ payload: { requestId: 'req-99', envelope: JSON.stringify(envelope) } })

    expect(received[0]).toEqual({ requestId: 'req-99', envelope })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// backup – desktop_save_file
// ─────────────────────────────────────────────────────────────────────────────
describe('downloadBlob on Tauri', () => {
  it('invokes desktop_save_file with filename, mimeType and base64 content', async () => {
    tauriInvokeImpl.mockResolvedValueOnce('/Users/test/Documents/CareJournal/backup.zip')

    const blob = new Blob(['test'], { type: 'application/zip' })
    const result = await downloadBlob(blob, 'backup.zip')

    expect(tauriInvokeImpl).toHaveBeenCalledWith('desktop_save_file', expect.objectContaining({
      filename: 'backup.zip',
      mimeType: 'application/zip',
      base64: expect.any(String),
    }))
    expect(result).toContain('backup.zip')
  })

  it('does NOT trigger browser anchor download on Tauri', async () => {
    tauriInvokeImpl.mockResolvedValueOnce('/path/backup.zip')
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click')

    await downloadBlob(new Blob(['x']), 'backup.zip')

    expect(anchorClick).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Non-Tauri paths remain intact (regression guard)
// ─────────────────────────────────────────────────────────────────────────────
describe('non-Tauri web paths (regression guard)', () => {
  it('usesNativeImageStorage is false without __TAURI_INTERNALS__', () => {
    disableTauri()
    expect(usesNativeImageStorage()).toBe(false)
  })

  it('persistStoredImage keeps the image unchanged on web', async () => {
    disableTauri()
    const img = makeImage()
    const result = await persistStoredImage(img)
    expect(result).toBe(img)
    expect(tauriInvokeImpl).not.toHaveBeenCalled()
  })

  it('downloadBlob uses browser anchor on web', async () => {
    disableTauri()
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    vi.spyOn(URL, 'revokeObjectURL').mockReturnValue()

    await downloadBlob(new Blob(['x']), 'test.zip')

    expect(anchorClick).toHaveBeenCalled()
    expect(tauriInvokeImpl).not.toHaveBeenCalled()
  })
})
