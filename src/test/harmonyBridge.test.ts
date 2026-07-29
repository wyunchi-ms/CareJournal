import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addHarmonyEventListener,
  getHarmonyBridge,
  isHarmonyPlatform,
  parseHarmonyResult,
  type HarmonyBridgeApi,
} from '../platform/harmonyBridge'

function mockBridge(): HarmonyBridgeApi {
  return {
    getPlatformInfo: vi.fn(),
    exitApp: vi.fn(),
    listEntities: vi.fn(),
    putEntity: vi.fn(),
    removeEntity: vi.fn(),
    replaceEntities: vi.fn(),
    removeCompletedOcrJobs: vi.fn(),
    persistImage: vi.fn(),
    readImage: vi.fn(),
    garbageCollectImages: vi.fn(),
    pickFiles: vi.fn(),
    saveFile: vi.fn(),
    httpPost: vi.fn(),
    lanStart: vi.fn(),
    lanStop: vi.fn(),
    lanRefresh: vi.fn(),
    lanListPeers: vi.fn(),
    lanSendSync: vi.fn(),
    lanCompleteSync: vi.fn(),
    lanRejectSync: vi.fn(),
  }
}

afterEach(() => {
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
})
