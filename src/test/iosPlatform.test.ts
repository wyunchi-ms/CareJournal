import { afterEach, describe, expect, it, vi } from 'vitest'

// ── Platform state shared across all hoisted mocks ───────────────────────────
const platformState = vi.hoisted(() => ({ isNative: false, platform: 'web' as string }))

// Mock for NativeLanSync – lets us assert iOS now uses the native plugin path
const nativeLanSync = vi.hoisted(() => ({
  start: vi.fn(async () => ({ alias: '测试设备', fingerprint: 'ios-fp', publicKey: 'fake-public-key', port: 53318, transport: 'native' })),
  stop: vi.fn(async () => undefined),
  refresh: vi.fn(async () => undefined),
  listPeers: vi.fn(async () => ({ peers: [] })),
  sendSync: vi.fn(async () => ({ envelope: '{}' })),
  completeSync: vi.fn(async () => undefined),
  rejectSync: vi.fn(async () => undefined),
  setTransferActive: vi.fn(async () => undefined),
  addListener: vi.fn(async () => ({ remove: vi.fn(async () => undefined) })),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => platformState.isNative,
    getPlatform: () => platformState.platform,
    convertFileSrc: (v: string) => `local:${v}`,
  },
  // Return the NativeLanSync spy only for 'LanSync'; everything else gets a
  // plain object so NativeImageStorage and FolderImport can register quietly.
  registerPlugin: (name: string) => (name === 'LanSync' ? nativeLanSync : {}),
}))

vi.mock('../platform/harmonyBridge', () => ({
  isHarmonyPlatform: () => false,
  addHarmonyEventListener: () => () => undefined,
  getHarmonyBridge: () => { throw new Error('no harmony bridge in iOS test') },
  parseHarmonyResult: (v: string) => JSON.parse(v),
}))

import { usesNativeImageStorage } from '../services/imageStorage'
import { canImportAndroidFolder } from '../services/folderImport'
import { lanSyncTransport } from '../services/lanSyncTransport'
import type { LanEncryptedEnvelope } from '../services/lanSync'

afterEach(async () => {
  // Reset platform back to web so each test starts clean.
  // Also stop the transport in case a previous test left it in a bad state.
  await lanSyncTransport.stop().catch(() => undefined)
  platformState.isNative = false
  platformState.platform = 'web'
  vi.clearAllMocks()
})

describe('iOS platform capability guards', () => {
  // ── NativeImageStorage ────────────────────────────────────────────────────

  it('enables native image storage on iOS', () => {
    platformState.isNative = true
    platformState.platform = 'ios'
    expect(usesNativeImageStorage()).toBe(true)
  })

  it('preserves native image storage on Android', () => {
    platformState.isNative = true
    platformState.platform = 'android'
    expect(usesNativeImageStorage()).toBe(true)
  })

  it('disables native image storage on web', () => {
    // Default state: isNative=false, platform='web'
    expect(usesNativeImageStorage()).toBe(false)
  })

  // ── FolderImport (Android-only) ───────────────────────────────────────────

  it('disables folder import on iOS', () => {
    platformState.isNative = true
    platformState.platform = 'ios'
    expect(canImportAndroidFolder()).toBe(false)
  })

  it('preserves folder import on Android', () => {
    platformState.isNative = true
    platformState.platform = 'android'
    expect(canImportAndroidFolder()).toBe(true)
  })

  // ── LAN sync transport ────────────────────────────────────────────────────

  it('starts LAN sync on iOS through the native plugin', async () => {
    platformState.isNative = true
    platformState.platform = 'ios'

    await expect(lanSyncTransport.start('测试设备', 'fake-public-key'))
      .resolves.toMatchObject({ transport: 'native', port: 53318 })

    expect(nativeLanSync.addListener).toHaveBeenCalledTimes(2)
    expect(nativeLanSync.start).toHaveBeenCalledWith({ alias: '测试设备', publicKey: 'fake-public-key' })
  })

  it('calls NativeLanSync.stop when stop() is called on iOS', async () => {
    platformState.isNative = true
    platformState.platform = 'ios'

    await lanSyncTransport.stop().catch(() => undefined)

    expect(nativeLanSync.stop).toHaveBeenCalled()
  })

  it('calls NativeLanSync.setTransferActive on iOS', async () => {
    platformState.isNative = true
    platformState.platform = 'ios'

    await lanSyncTransport.setTransferActive(true).catch(() => undefined)
    await lanSyncTransport.setTransferActive(false).catch(() => undefined)

    expect(nativeLanSync.setTransferActive).toHaveBeenCalledWith({ active: true })
    expect(nativeLanSync.setTransferActive).toHaveBeenCalledWith({ active: false })
  })

  it('routes every active LAN operation on iOS to the native plugin', async () => {
    platformState.isNative = true
    platformState.platform = 'ios'
    const envelope = {} as LanEncryptedEnvelope

    await expect(lanSyncTransport.refresh()).resolves.toBeUndefined()
    await expect(lanSyncTransport.sendSync({ host: '127.0.0.1', port: 53318 }, envelope)).resolves.toEqual({})
    await expect(lanSyncTransport.completeSync('request', envelope)).resolves.toBeUndefined()
    await expect(lanSyncTransport.rejectSync('request', 'error')).resolves.toBeUndefined()

    expect(nativeLanSync.refresh).toHaveBeenCalled()
    expect(nativeLanSync.sendSync).toHaveBeenCalledWith({ host: '127.0.0.1', port: 53318, envelope: '{}' })
    expect(nativeLanSync.completeSync).toHaveBeenCalledWith({ requestId: 'request', envelope: '{}' })
    expect(nativeLanSync.rejectSync).toHaveBeenCalledWith({ requestId: 'request', error: 'error' })
  })
})
