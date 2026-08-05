import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { LanEncryptedEnvelope } from './lanSync'
import { addHarmonyEventListener, getHarmonyBridge, isHarmonyPlatform, parseHarmonyResult } from '../platform/harmonyBridge'
import { isTauriPlatform, tauriInvoke, tauriListen } from '../platform/tauriBridge'

export interface LanPeer {
  fingerprint: string
  alias: string
  deviceType: 'mobile' | 'web'
  publicKey: string
  host: string
  port: number
  lastSeen: number
}

export interface LanServiceInfo {
  alias: string
  fingerprint: string
  publicKey: string
  port: number
  transport: 'native' | 'web'
}

export interface IncomingLanRequest {
  requestId: string
  envelope: LanEncryptedEnvelope
  peerAddress?: string
}

interface LanSyncNativePlugin {
  start(options: { alias: string; publicKey: string }): Promise<LanServiceInfo>
  stop(): Promise<void>
  refresh(): Promise<void>
  listPeers(): Promise<{ peers: LanPeer[] }>
  sendSync(options: { host: string; port: number; envelope: string }): Promise<{ envelope: string }>
  completeSync(options: { requestId: string; envelope: string }): Promise<void>
  rejectSync(options: { requestId: string; error: string }): Promise<void>
  setTransferActive(options: { active: boolean }): Promise<void>
  addListener(eventName: 'peersChanged', listener: (event: { peers: LanPeer[] }) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'syncRequest', listener: (event: { requestId: string; envelope: string; peerAddress?: string }) => void): Promise<PluginListenerHandle>
}

const NativeLanSync = registerPlugin<LanSyncNativePlugin>('LanSync')

function unsupportedPlatform(): never {
  throw new Error('当前运行环境不受支持，请使用 Windows、Android、iOS 或 HarmonyOS 应用')
}

class LanSyncTransport {
  private peerListeners = new Set<(peers: LanPeer[]) => void>()
  private requestListeners = new Set<(request: IncomingLanRequest) => void>()
  private nativeHandles: PluginListenerHandle[] = []
  private tauriUnlisteners: Array<() => void> = []
  private pollTimer: number | undefined
  private active = false
  private removeHarmonyListener?: () => void

  async start(alias: string, publicKey: string): Promise<LanServiceInfo> {
    if (this.active) await this.stop()
    this.active = true
    if (isHarmonyPlatform()) {
      this.removeHarmonyListener = addHarmonyEventListener((detail) => {
        if (detail.type === 'peersChanged') this.emitPeers(detail.peers as LanPeer[])
        if (detail.type === 'syncRequest') {
          this.emitRequest({
            requestId: detail.requestId,
            envelope: JSON.parse(detail.envelope) as LanEncryptedEnvelope,
            peerAddress: detail.peerAddress,
          })
        }
      })
      try {
        const info = parseHarmonyResult<LanServiceInfo>(await getHarmonyBridge().lanStart(alias, publicKey))
        this.pollTimer = window.setInterval(() => void this.pollNative(), 1500)
        await this.refresh()
        return info
      } catch (error) {
        if (this.pollTimer !== undefined) window.clearInterval(this.pollTimer)
        this.pollTimer = undefined
        await getHarmonyBridge().lanStop().catch(() => undefined)
        this.removeHarmonyListener?.()
        this.removeHarmonyListener = undefined
        this.active = false
        throw error
      }
    }
    if (Capacitor.isNativePlatform()) {
      try {
        this.nativeHandles = []
        this.nativeHandles.push(
          await NativeLanSync.addListener('peersChanged', ({ peers }) => this.emitPeers(peers)),
        )
        this.nativeHandles.push(
          await NativeLanSync.addListener('syncRequest', (request) => this.emitRequest({
            ...request,
            envelope: JSON.parse(request.envelope) as LanEncryptedEnvelope,
          })),
        )
        const info = await NativeLanSync.start({ alias, publicKey })
        this.pollTimer = window.setInterval(() => void this.pollNative(), 1500)
        await this.refresh()
        return info
      } catch (error) {
        if (this.pollTimer !== undefined) window.clearInterval(this.pollTimer)
        this.pollTimer = undefined
        await NativeLanSync.stop().catch(() => undefined)
        await Promise.all(this.nativeHandles.map((handle) => handle.remove().catch(() => undefined)))
        this.nativeHandles = []
        this.active = false
        throw error
      }
    }
    if (isTauriPlatform()) {
      try {
        this.tauriUnlisteners = []
        this.tauriUnlisteners.push(
          await tauriListen<{ peers: LanPeer[] }>('desktop://peers-changed', ({ peers }) => this.emitPeers(peers)),
        )
        this.tauriUnlisteners.push(
          await tauriListen<{ requestId: string; envelope: string; peerAddress?: string }>(
            'desktop://sync-request',
            (request) => this.emitRequest({
              requestId: request.requestId,
              envelope: JSON.parse(request.envelope) as LanEncryptedEnvelope,
              peerAddress: request.peerAddress,
            }),
          ),
        )
        const info = await tauriInvoke<LanServiceInfo>('desktop_lan_start', { alias, publicKey })
        this.pollTimer = window.setInterval(() => void this.pollNative(), 1500)
        await this.refresh()
        return info
      } catch (error) {
        if (this.pollTimer !== undefined) window.clearInterval(this.pollTimer)
        this.pollTimer = undefined
        await tauriInvoke('desktop_lan_stop').catch(() => undefined)
        await Promise.all(this.tauriUnlisteners.map((fn) => Promise.resolve().then(() => fn()).catch(() => undefined)))
        this.tauriUnlisteners = []
        this.active = false
        throw error
      }
    }

    this.active = false
    return unsupportedPlatform()
  }

  async stop() {
    this.active = false
    if (this.pollTimer !== undefined) window.clearInterval(this.pollTimer)
    this.pollTimer = undefined
    if (isHarmonyPlatform()) {
      await getHarmonyBridge().lanStop().catch(() => undefined)
      this.removeHarmonyListener?.()
      this.removeHarmonyListener = undefined
    } else if (Capacitor.isNativePlatform()) {
      await NativeLanSync.stop().catch(() => undefined)
      await Promise.all(this.nativeHandles.map((handle) => handle.remove().catch(() => undefined)))
      this.nativeHandles = []
    } else if (isTauriPlatform()) {
      await tauriInvoke('desktop_lan_stop').catch(() => undefined)
      await Promise.all(this.tauriUnlisteners.map((fn) => Promise.resolve().then(() => fn()).catch(() => undefined)))
      this.tauriUnlisteners = []
    }
  }

  async refresh() {
    if (isHarmonyPlatform()) {
      await getHarmonyBridge().lanRefresh()
      this.emitPeers(parseHarmonyResult<{ peers: LanPeer[] }>(await getHarmonyBridge().lanListPeers()).peers)
    } else if (Capacitor.isNativePlatform()) {
      await NativeLanSync.refresh()
      const { peers } = await NativeLanSync.listPeers()
      this.emitPeers(peers)
    } else if (isTauriPlatform()) {
      await tauriInvoke('desktop_lan_refresh')
      const { peers } = await tauriInvoke<{ peers: LanPeer[] }>('desktop_lan_list')
      this.emitPeers(peers)
    } else unsupportedPlatform()
  }

  async sendSync(peer: Pick<LanPeer, 'host' | 'port'>, envelope: LanEncryptedEnvelope) {
    const payload = { host: peer.host, port: peer.port, envelope: JSON.stringify(envelope) }
    const result = isHarmonyPlatform()
      ? { envelope: await getHarmonyBridge().lanSendSync(payload.host, payload.port, payload.envelope) }
      : Capacitor.isNativePlatform()
      ? await NativeLanSync.sendSync(payload)
      : isTauriPlatform()
      ? await tauriInvoke<{ envelope: string }>('desktop_lan_send', payload)
      : unsupportedPlatform()
    return JSON.parse(result.envelope) as LanEncryptedEnvelope
  }

  async completeSync(requestId: string, envelope: LanEncryptedEnvelope) {
    const payload = { requestId, envelope: JSON.stringify(envelope) }
    if (isHarmonyPlatform()) await getHarmonyBridge().lanCompleteSync(payload.requestId, payload.envelope)
    else if (Capacitor.isNativePlatform()) await NativeLanSync.completeSync(payload)
    else if (isTauriPlatform()) await tauriInvoke('desktop_lan_complete', payload)
    else unsupportedPlatform()
  }

  async rejectSync(requestId: string, error: string) {
    const payload = { requestId, error }
    if (isHarmonyPlatform()) await getHarmonyBridge().lanRejectSync(payload.requestId, payload.error)
    else if (Capacitor.isNativePlatform()) await NativeLanSync.rejectSync(payload)
    else if (isTauriPlatform()) await tauriInvoke('desktop_lan_reject', payload)
    else unsupportedPlatform()
  }

  async setTransferActive(active: boolean) {
    if (isHarmonyPlatform()) {
      await getHarmonyBridge().lanSetTransferActive(active)
    } else if (Capacitor.isNativePlatform()) {
      await NativeLanSync.setTransferActive({ active })
    } else if (isTauriPlatform()) {
      await tauriInvoke('desktop_lan_set_transfer_active', { active })
    }
  }

  onPeers(listener: (peers: LanPeer[]) => void) {
    this.peerListeners.add(listener)
    return () => this.peerListeners.delete(listener)
  }

  onRequest(listener: (request: IncomingLanRequest) => void) {
    this.requestListeners.add(listener)
    return () => this.requestListeners.delete(listener)
  }

  private async pollNative() {
    if (!this.active) return
    try {
      if (isHarmonyPlatform()) {
        const { peers } = parseHarmonyResult<{ peers: LanPeer[] }>(await getHarmonyBridge().lanListPeers())
        this.emitPeers(peers)
      } else if (Capacitor.isNativePlatform()) {
        const { peers } = await NativeLanSync.listPeers()
        this.emitPeers(peers)
      } else if (isTauriPlatform()) {
        const { peers } = await tauriInvoke<{ peers: LanPeer[] }>('desktop_lan_list')
        this.emitPeers(peers)
      }
    } catch {
      // Event delivery is still primary; polling only repairs missed callbacks.
    }
  }

  private emitPeers(peers: LanPeer[]) {
    this.peerListeners.forEach((listener) => listener(peers))
  }

  private emitRequest(request: IncomingLanRequest) {
    this.requestListeners.forEach((listener) => listener(request))
  }
}

export const lanSyncTransport = new LanSyncTransport()
