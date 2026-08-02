import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addHarmonyEventListener,
  getHarmonyBridge,
  isHarmonyPlatform,
  parseHarmonyResult,
  type HarmonyBridgeApi,
} from '../platform/harmonyBridge'
import { lanSyncTransport } from '../services/lanSyncTransport'

function mockBridge(): HarmonyBridgeApi {
  return {
    getPlatformInfo: vi.fn(),
    exitApp: vi.fn(async () => undefined),
    listEntities: vi.fn(async () => '[]'),
    putEntity: vi.fn(async () => undefined),
    removeEntity: vi.fn(async () => undefined),
    replaceEntities: vi.fn(async () => undefined),
    removeCompletedOcrJobs: vi.fn(async () => undefined),
    persistImage: vi.fn(async () => '{}'),
    readImage: vi.fn(async () => '{}'),
    garbageCollectImages: vi.fn(async () => 0),
    pickFiles: vi.fn(async () => '[]'),
    saveFile: vi.fn(async () => ''),
    httpPost: vi.fn(async () => '{}'),
    lanStart: vi.fn(async () => '{}'),
    lanStop: vi.fn(async () => undefined),
    lanRefresh: vi.fn(async () => undefined),
    lanListPeers: vi.fn(async () => '{"peers":[]}'),
    lanSendSync: vi.fn(async () => '{}'),
    lanSetTransferActive: vi.fn(async () => undefined),
    lanCompleteSync: vi.fn(async () => undefined),
    lanRejectSync: vi.fn(async () => undefined),
  }
}

afterEach(async () => {
  await lanSyncTransport.stop().catch(() => undefined)
  delete window.CareJournalHarmony
})

describe('HarmonyOS bridge', () => {
  it('detects the injected ArkWeb proxy without affecting a normal browser', () => {
    expect(isHarmonyPlatform()).toBe(false)
    const bridge = mockBridge()
    window.CareJournalHarmony = bridge
    expect(isHarmonyPlatform()).toBe(true)
    expect(getHarmonyBridge()).toBe(bridge)
  })

  it('parses native JSON results and forwards native events', () => {
    expect(parseHarmonyResult<{ count: number }>('{"count":2}')).toEqual({ count: 2 })
    const listener = vi.fn()
    const remove = addHarmonyEventListener(listener)
    window.dispatchEvent(new CustomEvent('carejournal:harmony', {
      detail: { type: 'foreground' },
    }))
    expect(listener).toHaveBeenCalledWith({ type: 'foreground' })
    remove()
  })

  it('cleans up the Harmony transport when lanStart fails so a later retry works', async () => {
    const bridge = mockBridge()
    window.CareJournalHarmony = bridge
    vi.mocked(bridge.lanStart)
      .mockRejectedValueOnce(new Error('socket bind failed'))
      .mockResolvedValueOnce(JSON.stringify({
        alias: 'Harmony',
        fingerprint: 'device-1',
        publicKey: 'key-1',
        port: 53318,
        transport: 'native',
      }))
    vi.mocked(bridge.lanListPeers).mockResolvedValue(JSON.stringify({ peers: [] }))

    await expect(lanSyncTransport.start('Harmony', 'key-1')).rejects.toThrow('socket bind failed')
    expect(bridge.lanStop).toHaveBeenCalledTimes(1)

    await expect(lanSyncTransport.start('Harmony', 'key-1')).resolves.toMatchObject({
      fingerprint: 'device-1',
      port: 53318,
    })
    expect(bridge.lanStart).toHaveBeenCalledTimes(2)
  })

  it('forwards transfer-active state to the Harmony bridge', async () => {
    const bridge = mockBridge()
    window.CareJournalHarmony = bridge
    await lanSyncTransport.setTransferActive(true)
    await lanSyncTransport.setTransferActive(false)
    expect(bridge.lanSetTransferActive).toHaveBeenNthCalledWith(1, true)
    expect(bridge.lanSetTransferActive).toHaveBeenNthCalledWith(2, false)
  })
})
