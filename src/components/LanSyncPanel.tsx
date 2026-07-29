import { ArrowRightLeft, CheckCircle2, Laptop, LoaderCircle, RefreshCw, ShieldCheck, Smartphone, Wifi, WifiOff, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { SettingsCollapsibleCard } from './SettingsCollapsibleCard'
import { useApp } from '../store/AppContext'
import { createLanCryptoIdentity, decryptLanSnapshot, encryptLanSnapshot, snapshotEntityCount, type LanCryptoIdentity } from '../services/lanSync'
import { lanSyncTransport, type IncomingLanRequest, type LanPeer, type LanServiceInfo } from '../services/lanSyncTransport'

type SyncStatus = { tone: 'neutral' | 'working' | 'success' | 'error'; message: string }

function deviceAlias() {
  const stored = localStorage.getItem('carejournal-lan-alias')
  if (stored) return stored
  const alias = /Android/i.test(navigator.userAgent) ? 'CareJournal 手机' : 'CareJournal 网页'
  localStorage.setItem('carejournal-lan-alias', alias)
  return alias
}

function summaryText(summary: Awaited<ReturnType<ReturnType<typeof useApp>['mergeLanSnapshot']>>) {
  const changed = summary.added + summary.updated + summary.deleted
  return `同步完成：${changed} 项变更，合并 ${summary.conflictsMerged} 项冲突，接收 ${summary.assetsReceived} 个素材`
}

export function LanSyncPanel() {
  const { createLanSnapshot, mergeLanSnapshot } = useApp()
  const [expanded, setExpanded] = useState(false)
  const [active, setActive] = useState(false)
  const [starting, setStarting] = useState(false)
  const [info, setInfo] = useState<LanServiceInfo | null>(null)
  const [peers, setPeers] = useState<LanPeer[]>([])
  const [selectedPeer, setSelectedPeer] = useState<LanPeer | null>(null)
  const [status, setStatus] = useState<SyncStatus>({ tone: 'neutral', message: '开启后，同一 Wi-Fi 下的 CareJournal 设备会在这里出现。' })
  const busyRef = useRef(false)
  const infoRef = useRef<LanServiceInfo | null>(null)
  const identityRef = useRef<LanCryptoIdentity | null>(null)

  useEffect(() => { infoRef.current = info }, [info])

  async function receiveSync(request: IncomingLanRequest) {
    const currentInfo = infoRef.current
    const identity = identityRef.current
    if (!currentInfo || !identity || busyRef.current) {
      await lanSyncTransport.rejectSync(request.requestId, '接收设备当前正忙，请稍后重试')
      return
    }
    busyRef.current = true
    setStatus({ tone: 'working', message: '正在接收并合并对方数据…' })
    try {
      const incoming = await decryptLanSnapshot(request.envelope, identity)
      const summary = await mergeLanSnapshot(incoming)
      const mergedSnapshot = await createLanSnapshot(currentInfo.alias)
      const response = await encryptLanSnapshot(mergedSnapshot, identity, request.envelope.senderPublicKey)
      await lanSyncTransport.completeSync(request.requestId, response)
      setStatus({ tone: 'success', message: summaryText(summary) })
    } catch (error) {
      const message = error instanceof Error ? error.message : '接收同步失败'
      await lanSyncTransport.rejectSync(request.requestId, message).catch(() => undefined)
      setStatus({ tone: 'error', message })
    } finally {
      busyRef.current = false
    }
  }

  useEffect(() => {
    const offPeers = lanSyncTransport.onPeers(setPeers)
    const offRequest = lanSyncTransport.onRequest((request) => void receiveSync(request))
    return () => {
      offPeers()
      offRequest()
      void lanSyncTransport.stop()
    }
    // The receiver reads fresh app data through stable context actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createLanSnapshot, mergeLanSnapshot])

  async function start() {
    setStarting(true)
    setStatus({ tone: 'working', message: '正在加入局域网…' })
    try {
      const identity = await createLanCryptoIdentity()
      identityRef.current = identity
      const service = await lanSyncTransport.start(deviceAlias(), identity.publicKey)
      setInfo(service)
      setActive(true)
      setStatus({ tone: 'neutral', message: '已可被发现。选择一台设备开始双向同步。' })
    } catch (error) {
      identityRef.current = null
      setStatus({ tone: 'error', message: error instanceof Error ? error.message : '无法开启局域网同步' })
    } finally {
      setStarting(false)
    }
  }

  async function stop() {
    await lanSyncTransport.stop()
    setActive(false)
    setInfo(null)
    identityRef.current = null
    setPeers([])
    setStatus({ tone: 'neutral', message: '局域网同步已关闭。' })
  }

  async function sync() {
    if (!selectedPeer || busyRef.current) return
    const identity = identityRef.current
    if (!identity || !selectedPeer.publicKey) {
      setStatus({ tone: 'error', message: '设备密钥尚未就绪，请刷新设备后重试' })
      return
    }
    busyRef.current = true
    setSelectedPeer(null)
    setStatus({ tone: 'working', message: `正在与 ${selectedPeer.alias} 自动加密同步…` })
    try {
      const snapshot = await createLanSnapshot(info?.alias || deviceAlias())
      const encrypted = await encryptLanSnapshot(snapshot, identity, selectedPeer.publicKey)
      const response = await lanSyncTransport.sendSync(selectedPeer, encrypted)
      const mergedRemote = await decryptLanSnapshot(response, identity)
      const summary = await mergeLanSnapshot(mergedRemote)
      setStatus({ tone: 'success', message: `${summaryText(summary)}；本机发送 ${snapshotEntityCount(snapshot)} 项` })
    } catch (error) {
      setStatus({ tone: 'error', message: error instanceof Error ? error.message : '局域网同步失败' })
    } finally {
      busyRef.current = false
    }
  }

  return <>
    <SettingsCollapsibleCard
      className="lan-sync-section"
      icon={<Wifi />}
      title="局域网同步"
      summary={active ? `已开启 · ${peers.length ? `${peers.length} 台设备可用` : '等待发现设备'}` : '未开启 · 同一 Wi-Fi 双向合并'}
      expanded={expanded}
      onToggle={() => setExpanded((value) => !value)}
    >
      <div className="lan-security-note"><ShieldCheck /><span>无需配对码，设备间会自动协商临时密钥并加密传输；不会同步 LLM 配置和 OCR 队列。</span></div>

      {!active ? <button type="button" className="button primary lan-start-button" disabled={starting} onClick={() => void start()}>
        {starting ? <LoaderCircle className="spin" /> : <Wifi />}{starting ? '正在开启…' : '开启局域网同步'}
      </button> : <>
        <div className="lan-toolbar">
          <span><span className="lan-live-dot" />已开启，选择设备即可同步</span>
          <div>
            <button type="button" className="icon-button" aria-label="刷新设备" onClick={() => void lanSyncTransport.refresh()}><RefreshCw /></button>
            <button type="button" className="icon-button" aria-label="关闭局域网同步" onClick={() => void stop()}><WifiOff /></button>
          </div>
        </div>
        <div className="lan-peer-list" aria-label="同一局域网设备">
          {peers.length === 0 ? <div className="lan-empty"><Wifi /><strong>还没发现其他设备</strong><span>请在另一台设备的设置页也开启局域网同步。</span></div> : peers.map((peer) =>
            <button type="button" className="lan-peer" key={peer.fingerprint} onClick={() => setSelectedPeer(peer)}>
              <span className="lan-peer-icon">{peer.deviceType === 'web' ? <Laptop /> : <Smartphone />}</span>
              <span><strong>{peer.alias}</strong><small>{peer.deviceType === 'web' ? '网页' : 'Android'} · {peer.host}</small></span>
              <ArrowRightLeft />
            </button>)}
        </div>
      </>}
      <p className={`lan-status ${status.tone}`} role={status.tone === 'error' ? 'alert' : status.tone === 'neutral' ? undefined : 'status'}>
        {status.tone === 'working' && <LoaderCircle className="spin" />}
        {status.tone === 'success' && <CheckCircle2 />}
        {status.message}
      </p>
    </SettingsCollapsibleCard>

    {selectedPeer && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPeer(null) }}>
      <section className="lan-sync-sheet" role="dialog" aria-modal="true" aria-labelledby="lan-sync-title">
        <button type="button" className="icon-button lan-sync-close" aria-label="关闭" onClick={() => setSelectedPeer(null)}><X /></button>
        <span className="lan-peer-icon large">{selectedPeer.deviceType === 'web' ? <Laptop /> : <Smartphone />}</span>
        <h2 id="lan-sync-title">与 {selectedPeer.alias} 同步</h2>
        <p>确认后会自动加密传输，并双向合并两台设备的数据；相同记录会合并，不会整库覆盖。</p>
        <button type="button" className="button primary" autoFocus onClick={() => void sync()}><ArrowRightLeft />确认并开始同步</button>
      </section>
    </div>}
  </>
}
