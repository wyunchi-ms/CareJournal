import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { LanEncryptedEnvelope } from './lanSync'
import { addHarmonyEventListener, getHarmonyBridge, isHarmonyPlatform, parseHarmonyResult } from '../platform/harmonyBridge'

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
  addListener(eventName: 'peersChanged', listener: (event: { peers: LanPeer[] }) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'syncRequest', listener: (event: { requestId: string; envelope: string; peerAddress?: string }) => void): Promise<PluginListenerHandle>
}

const NativeLanSync = registerPlugin<LanSyncNativePlugin>('LanSync')

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const body = await response.json().catch(() => ({})) as { error?: string | { message?: string } }
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : body.error?.message
    throw new Error(message || `局域网服务返回 ${response.status}`)
  }
  return body as T
}

class LanSyncTransport {
  private peerListeners = new Set<(peers: LanPeer[]) => void>()
  private requestListeners = new Set<(request: IncomingLanRequest) => void>()
  private nativeHandles: PluginListenerHandle[] = []
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
      const info = parseHarmonyResult<LanServiceInfo>(await getHarmonyBridge().lanStart(alias, publicKey))
      await this.refresh()
      return info
    }
    if (Capacitor.isNativePlatform()) {
      this.nativeHandles = [
        await NativeLanSync.addListener('peersChanged', ({ peers }) => this.emitPeers(peers)),
        await NativeLanSync.addListener('syncRequest', (request) => this.emitRequest({
          ...request,
          envelope: JSON.parse(request.envelope) as LanEncryptedEnvelope,
        })),
      ]
      const info = await NativeLanSync.start({ alias, publicKey })
      await this.refresh()
      return info
    }

    try {
      const info = await fetchJson<LanServiceInfo>('/api/lan/start', {
        method: 'POST',
        body: JSON.stringify({ alias, publicKey }),
      })
      this.pollTimer = window.setInterval(() => void this.pollWeb(), 1200)
      await this.pollWeb()
      return info
    } catch (error) {
      this.active = false
      throw new Error(`${error instanceof Error ? error.message : '无法连接'}。网页端请使用 npm run serve:web 启动本机伴侣服务。`)
    }
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
    } else {
      await fetchJson('/api/lan/stop', { method: 'POST', body: '{}' }).catch(() => undefined)
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
    } else {
      await fetchJson('/api/lan/refresh', { method: 'POST', body: '{}' })
      await this.pollWeb()
    }
  }

  async sendSync(peer: Pick<LanPeer, 'host' | 'port'>, envelope: LanEncryptedEnvelope) {
    const payload = { host: peer.host, port: peer.port, envelope: JSON.stringify(envelope) }
    const result = isHarmonyPlatform()
      ? { envelope: await getHarmonyBridge().lanSendSync(payload.host, payload.port, payload.envelope) }
      : Capacitor.isNativePlatform()
      ? await NativeLanSync.sendSync(payload)
      : await fetchJson<{ envelope: string }>('/api/lan/send', { method: 'POST', body: JSON.stringify(payload) })
    return JSON.parse(result.envelope) as LanEncryptedEnvelope
  }

  async completeSync(requestId: string, envelope: LanEncryptedEnvelope) {
    const payload = { requestId, envelope: JSON.stringify(envelope) }
    if (isHarmonyPlatform()) await getHarmonyBridge().lanCompleteSync(payload.requestId, payload.envelope)
    else if (Capacitor.isNativePlatform()) await NativeLanSync.completeSync(payload)
    else await fetchJson('/api/lan/complete', { method: 'POST', body: JSON.stringify(payload) })
  }

  async rejectSync(requestId: string, error: string) {
    const payload = { requestId, error }
    if (isHarmonyPlatform()) await getHarmonyBridge().lanRejectSync(payload.requestId, payload.error)
    else if (Capacitor.isNativePlatform()) await NativeLanSync.rejectSync(payload)
    else await fetchJson('/api/lan/reject', { method: 'POST', body: JSON.stringify(payload) })
  }

  onPeers(listener: (peers: LanPeer[]) => void) {
    this.peerListeners.add(listener)
    return () => this.peerListeners.delete(listener)
  }

  onRequest(listener: (request: IncomingLanRequest) => void) {
    this.requestListeners.add(listener)
    return () => this.requestListeners.delete(listener)
  }

  private async pollWeb() {
    if (!this.active) return
    try {
      const [{ peers }, { requests }] = await Promise.all([
        fetchJson<{ peers: LanPeer[] }>('/api/lan/peers'),
        fetchJson<{ requests: IncomingLanRequest[] }>('/api/lan/incoming'),
      ])
      this.emitPeers(peers)
      requests.forEach((request) => this.emitRequest(request))
    } catch {
      // The settings panel displays start/send failures. Transient polling errors retry.
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
