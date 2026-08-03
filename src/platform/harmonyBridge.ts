export interface HarmonyBridgeApi {
  getPlatformInfo(): Promise<string>
  appReady(): Promise<void>
  exitApp(): Promise<void>
  listEntities(kind: string): Promise<string>
  putEntity(kind: string, id: string, updatedAt: string, payload: string): Promise<void>
  removeEntity(kind: string, id: string): Promise<void>
  replaceEntities(kind: string, entries: string): Promise<void>
  removeCompletedOcrJobs(): Promise<void>
  persistImage(id: string, mimeType: string, dataUrl: string, sha256: string): Promise<string>
  readImage(storagePath: string): Promise<string>
  garbageCollectImages(storagePaths: string): Promise<number>
  pickFiles(mimeTypes: string): Promise<string>
  saveFile(filename: string, mimeType: string, base64: string): Promise<string>
  httpPost(url: string, headers: string, body: string, connectTimeout: number, readTimeout: number): Promise<string>
  lanStart(alias: string, publicKey: string): Promise<string>
  lanStop(): Promise<void>
  lanRefresh(): Promise<void>
  lanListPeers(): Promise<string>
  lanSendSync(host: string, port: number, envelope: string): Promise<string>
  lanSetTransferActive(active: boolean): Promise<void>
  lanCompleteSync(requestId: string, envelope: string): Promise<void>
  lanRejectSync(requestId: string, error: string): Promise<void>
}

declare global {
  interface Window {
    CareJournalHarmony?: HarmonyBridgeApi
  }
}

export function isHarmonyPlatform() {
  return typeof window !== 'undefined' && Boolean(window.CareJournalHarmony)
}

export function getHarmonyBridge() {
  const bridge = typeof window !== 'undefined' ? window.CareJournalHarmony : undefined
  if (!bridge) throw new Error('鸿蒙平台桥接尚未就绪')
  return bridge
}

export function parseHarmonyResult<T>(value: string): T {
  return JSON.parse(value) as T
}

export type HarmonyEventDetail =
  | { type: 'peersChanged'; peers: unknown[] }
  | { type: 'syncRequest'; requestId: string; envelope: string; peerAddress?: string }
  | { type: 'backPress' }
  | { type: 'foreground' }
  | { type: 'background' }

export function addHarmonyEventListener(listener: (detail: HarmonyEventDetail) => void) {
  if (typeof window === 'undefined') return () => undefined
  const handle = (event: Event) => listener((event as CustomEvent<HarmonyEventDetail>).detail)
  window.addEventListener('carejournal:harmony', handle)
  return () => window.removeEventListener('carejournal:harmony', handle)
}
