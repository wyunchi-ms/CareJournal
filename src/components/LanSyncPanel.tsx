import { ArrowRightLeft, CheckCircle2, Laptop, LoaderCircle, Power, RefreshCw, ShieldCheck, Smartphone, Wifi, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { SettingsCollapsibleCard } from './SettingsCollapsibleCard'
import { useApp } from '../store/AppContext'
import {
  createLanAssetChunkSource,
  createLanCryptoIdentity,
  createLanMetadataSnapshot,
  createLanPreviewSnapshot,
  decryptLanSnapshot,
  encryptLanSnapshot,
  kindFilterFromWantedKinds,
  LanAssetChunkReceiver,
  snapshotEntityCount,
  type LanAssetChunkSource,
  type LanCryptoIdentity,
  type LanSyncKindFilter,
} from '../services/lanSync'
import { lanSyncTransport, type IncomingLanRequest, type LanPeer, type LanServiceInfo } from '../services/lanSyncTransport'
import { isHarmonyPlatform } from '../platform/harmonyBridge'
import type { LanSyncEntityKind, LanSyncPreview, LanSyncSnapshot } from '../types'

type SyncStatus = { tone: 'neutral' | 'working' | 'success' | 'error'; message: string; progress?: number }

function transferProgress(transfer: NonNullable<import('../types').LanSyncSnapshot['transfer']>) {
  if (transfer.done) return 100
  const count = transfer.assetCount ?? 0
  if (!count) return 0
  const chunk = transfer.chunk
  const withinAsset = chunk ? (chunk.index + 1) / chunk.count : 0
  return Math.max(0, Math.min(100, (((transfer.assetIndex ?? 0) + withinAsset) / count) * 100))
}

const previewKinds: Array<[keyof LanSyncPreview, LanSyncEntityKind, string]> = [
  ['events', 'event', '病程'],
  ['chemotherapyTemplates', 'chemotherapyTemplate', '方案'],
  ['records', 'record', '检查'],
  ['pins', 'pin', '图表'],
  ['reimbursementPlans', 'reimbursementPlan', '报销'],
  ['assets', 'asset', '素材'],
]

type KindSelection = Record<LanSyncEntityKind, boolean>

type SyncSelection = {
  /** Kinds the local device is willing to accept from the peer. */
  accept: KindSelection
  /** Kinds the local device is willing to send to the peer. */
  send: KindSelection
}

function fullKindSelection(): KindSelection {
  return {
    event: true,
    chemotherapyTemplate: true,
    record: true,
    pin: true,
    reimbursementPlan: true,
    asset: true,
  }
}

function defaultSyncSelection(): SyncSelection {
  return { accept: fullKindSelection(), send: fullKindSelection() }
}

function selectedKinds(selection: KindSelection): LanSyncEntityKind[] {
  return (Object.entries(selection) as Array<[LanSyncEntityKind, boolean]>)
    .filter(([, on]) => on)
    .map(([kind]) => kind)
}

function PreviewSummary({
  title,
  preview,
  selection,
  onToggle,
}: {
  title: string
  preview: LanSyncPreview
  selection: KindSelection
  onToggle: (kind: LanSyncEntityKind) => void
}) {
  const rows = previewKinds.filter(([previewKey]) => {
    const item = preview[previewKey]
    return item.added || item.updated || item.deleted
  })
  return <section className="lan-preview-device">
    <h3>{title}</h3>
    {rows.length ? <ul>{rows.map(([previewKey, kind, label]) => {
      const item = preview[previewKey]
      const checked = selection[kind]
      return <li key={kind} className={checked ? undefined : 'lan-preview-skipped'}>
        <label>
          <input type="checkbox" checked={checked} onChange={() => onToggle(kind)} aria-label={`同步${label}`} />
          <span className="lan-preview-kind">
            <strong>{label}</strong>
            <span>
              {item.added > 0 && `新增 ${item.added}`}
              {item.updated > 0 && `${item.added ? ' · ' : ''}更新 ${item.updated}`}
              {item.deleted > 0 && `${item.added || item.updated ? ' · ' : ''}删除 ${item.deleted}`}
            </span>
          </span>
          {!checked && <em className="lan-preview-skip">已跳过</em>}
        </label>
      </li>
    })}</ul> : <p>不会产生记录变化</p>}
  </section>
}

function deviceAlias() {
  const stored = localStorage.getItem('carejournal-lan-alias')
  if (stored) return stored
  const alias = isHarmonyPlatform()
    ? 'CareJournal 鸿蒙设备'
    : /Android/i.test(navigator.userAgent) ? 'CareJournal 手机' : 'CareJournal 网页'
  localStorage.setItem('carejournal-lan-alias', alias)
  return alias
}

function summaryText(summary: Awaited<ReturnType<ReturnType<typeof useApp>['mergeLanSnapshot']>>) {
  const changed = summary.added + summary.updated + summary.deleted
  return `同步完成：${changed} 项变化，处理 ${summary.conflictsMerged} 项双方修改，接收 ${summary.assetsReceived} 个素材`
}

export function LanSyncPanel() {
  const { createLanSnapshot, mergeLanSnapshot, previewLanSnapshot, storeLanAsset, finalizeLanAssets } = useApp()
  const [expanded, setExpanded] = useState(false)
  const [active, setActive] = useState(false)
  const [starting, setStarting] = useState(false)
  const [info, setInfo] = useState<LanServiceInfo | null>(null)
  const [peers, setPeers] = useState<LanPeer[]>([])
  const [selectedPeer, setSelectedPeer] = useState<LanPeer | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [pendingPreview, setPendingPreview] = useState<{
    peer: LanPeer
    local: LanSyncPreview
    remote: LanSyncPreview
    remoteSnapshot: LanSyncSnapshot
  } | null>(null)
  const [syncSelection, setSyncSelection] = useState<SyncSelection>(defaultSyncSelection)
  const [status, setStatus] = useState<SyncStatus>({ tone: 'neutral', message: '开启后，同一 Wi-Fi 下的 CareJournal 设备会在这里出现。' })
  const busyRef = useRef(false)
  const infoRef = useRef<LanServiceInfo | null>(null)
  const identityRef = useRef<LanCryptoIdentity | null>(null)
  const outboundAssetsRef = useRef<LanAssetChunkSource | null>(null)
  const inboundAssetsRef = useRef(new LanAssetChunkReceiver())

  useEffect(() => { infoRef.current = info }, [info])

  async function receiveSync(request: IncomingLanRequest) {
    const currentInfo = infoRef.current
    const identity = identityRef.current
    if (!currentInfo || !identity || busyRef.current) {
      await lanSyncTransport.rejectSync(request.requestId, '接收设备当前正忙，请稍后重试')
      return
    }
    busyRef.current = true
    try {
      const incoming = await decryptLanSnapshot(request.envelope, identity)
      if (incoming.transfer?.phase === 'preview') {
        setStatus({ tone: 'working', message: '对方正在预览同步变化…', progress: 2 })
        const preview = await previewLanSnapshot(incoming)
        const responseSnapshot = await createLanPreviewSnapshot(currentInfo.alias)
        responseSnapshot.transfer = { ...responseSnapshot.transfer!, preview }
        const response = await encryptLanSnapshot(responseSnapshot, identity, request.envelope.senderPublicKey)
        await lanSyncTransport.completeSync(request.requestId, response)
        setStatus({ tone: 'neutral', message: '已向对方发送同步变化预览，等待对方确认。' })
        return
      }
      if (incoming.transfer?.phase === 'metadata') {
        await lanSyncTransport.setTransferActive(true)
        setStatus({ tone: 'working', message: '正在同步记录并准备传输素材…', progress: 6 })
        const summary = await mergeLanSnapshot(incoming)
        // The initiator declares which kinds it is willing to accept. We honour
        // that so no bytes are wasted for kinds the user unchecked over there.
        const responderInclude = kindFilterFromWantedKinds(incoming.transfer.wantedKinds)
        outboundAssetsRef.current = await createLanAssetChunkSource(
          currentInfo.alias,
          incoming.transfer.availableAssetIds,
          { include: responderInclude },
        )
        inboundAssetsRef.current = new LanAssetChunkReceiver()
        const metadata = await createLanMetadataSnapshot(currentInfo.alias, { include: responderInclude })
        const response = await encryptLanSnapshot(metadata, identity, request.envelope.senderPublicKey)
        await lanSyncTransport.completeSync(request.requestId, response)
        setStatus({
          tone: 'working',
          message: `${summaryText(summary)}；开始交换图片和 PDF…`,
          progress: 10,
        })
        return
      }
      if (incoming.transfer?.phase === 'assets') {
        const incomingTransfer = incoming.transfer
        setStatus({
          tone: 'working',
          message: incomingTransfer.done
            ? '对方素材已发送完成，正在完成本机素材发送…'
            : `正在接收素材 ${Math.min((incomingTransfer.assetIndex ?? 0) + 1, incomingTransfer.assetCount ?? 0)}/${incomingTransfer.assetCount ?? 0}…`,
          progress: 10 + transferProgress(incomingTransfer) * .9,
        })
        const completedAsset = await inboundAssetsRef.current.accept(incoming)
        if (completedAsset?.assets[0]) await storeLanAsset(completedAsset.assets[0])
        if (!outboundAssetsRef.current) outboundAssetsRef.current = await createLanAssetChunkSource(currentInfo.alias)
        const outgoing = await outboundAssetsRef.current.next()
        const response = await encryptLanSnapshot(outgoing, identity, request.envelope.senderPublicKey)
        await lanSyncTransport.completeSync(request.requestId, response)
        const transfer = incoming.transfer
        const bothDone = Boolean(transfer.done && outgoing.transfer?.done)
        if (bothDone) {
          await finalizeLanAssets()
          await lanSyncTransport.setTransferActive(false)
        }
        setStatus({
          tone: bothDone ? 'success' : 'working',
          message: bothDone
            ? `双向同步完成，双方记录与素材已合并${(transfer.skippedAssets ?? 0) > 0 ? `；对方有 ${transfer.skippedAssets} 个原始文件已不可读取` : ''}。`
            : transfer.done
            ? '对方素材已接收完成，正在完成本机素材发送…'
            : `正在接收素材 ${Math.min((transfer.assetIndex ?? 0) + 1, transfer.assetCount ?? 0)}/${transfer.assetCount ?? 0}…`,
          progress: bothDone ? 100 : 10 + transferProgress(transfer) * .9,
        })
        return
      }

      // Compatibility with version 0.19.0 and earlier single-envelope peers.
      const summary = await mergeLanSnapshot(incoming)
      const mergedSnapshot = await createLanSnapshot(currentInfo.alias)
      const response = await encryptLanSnapshot(mergedSnapshot, identity, request.envelope.senderPublicKey)
      await lanSyncTransport.completeSync(request.requestId, response)
      setStatus({ tone: 'success', message: summaryText(summary) })
    } catch (error) {
      await lanSyncTransport.setTransferActive(false).catch(() => undefined)
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
      outboundAssetsRef.current = null
      inboundAssetsRef.current = new LanAssetChunkReceiver()
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
    await lanSyncTransport.setTransferActive(false).catch(() => undefined)
    await lanSyncTransport.stop()
    setActive(false)
    setInfo(null)
    identityRef.current = null
    outboundAssetsRef.current = null
    inboundAssetsRef.current = new LanAssetChunkReceiver()
    setPeers([])
    setStatus({ tone: 'neutral', message: '局域网同步已关闭。' })
  }

  async function prepareSyncPreview() {
    if (!selectedPeer || busyRef.current) return
    const identity = identityRef.current
    if (!identity || !selectedPeer.publicKey) {
      setStatus({ tone: 'error', message: '设备密钥尚未就绪，请刷新设备后重试' })
      return
    }
    busyRef.current = true
    setPreviewLoading(true)
    const peer = selectedPeer
    setStatus({ tone: 'working', message: `正在比较与 ${peer.alias} 同步后的变化…`, progress: 2 })
    try {
      const localAlias = info?.alias || deviceAlias()
      const snapshot = await createLanPreviewSnapshot(localAlias)
      const envelope = await encryptLanSnapshot(snapshot, identity, peer.publicKey)
      const response = await lanSyncTransport.sendSync(peer, envelope)
      const remoteSnapshot = await decryptLanSnapshot(response, identity)
      const localPreview = await previewLanSnapshot(remoteSnapshot)
      setSelectedPeer(null)
      setSyncSelection(defaultSyncSelection())
      setPendingPreview({
        peer,
        local: localPreview,
        remoteSnapshot,
        remote: remoteSnapshot.transfer?.preview ?? {
          events: { added: 0, updated: 0, deleted: 0 },
          chemotherapyTemplates: { added: 0, updated: 0, deleted: 0 },
          records: { added: 0, updated: 0, deleted: 0 },
          pins: { added: 0, updated: 0, deleted: 0 },
          reimbursementPlans: { added: 0, updated: 0, deleted: 0 },
          assets: { added: 0, updated: 0, deleted: 0 },
        },
      })
      setStatus({ tone: 'neutral', message: '同步变化预览已生成，确认后才会写入双方设备。' })
    } catch (error) {
      setStatus({ tone: 'error', message: error instanceof Error ? error.message : '无法生成同步预览' })
    } finally {
      setPreviewLoading(false)
      busyRef.current = false
    }
  }

  async function sync() {
    if (!pendingPreview || busyRef.current) return
    const identity = identityRef.current
    const peer = pendingPreview.peer
    if (!identity || !peer.publicKey) {
      setStatus({ tone: 'error', message: '设备密钥尚未就绪，请刷新设备后重试' })
      return
    }
    busyRef.current = true
    await lanSyncTransport.setTransferActive(true).catch(() => undefined)
    // Snapshot the user's kind selection before we tear down the preview state.
    const selection = syncSelection
    const sendFilter: LanSyncKindFilter = selection.send
    const acceptFilter: LanSyncKindFilter = selection.accept
    setPendingPreview(null)
    setStatus({ tone: 'working', message: `正在整理与 ${peer.alias} 同步的记录…`, progress: 3 })
    try {
      const localAlias = info?.alias || deviceAlias()
      const outboundAssets = await createLanAssetChunkSource(
        localAlias,
        pendingPreview.remoteSnapshot.transfer?.availableAssetIds,
        { include: sendFilter },
      )
      outboundAssetsRef.current = outboundAssets
      inboundAssetsRef.current = new LanAssetChunkReceiver()
      const snapshot = await createLanMetadataSnapshot(localAlias, { include: sendFilter })
      if (snapshot.transfer) snapshot.transfer.wantedKinds = selectedKinds(selection.accept)
      setStatus({ tone: 'working', message: '正在交换病程、检查、图表和报销记录…', progress: 4 })
      const encrypted = await encryptLanSnapshot(snapshot, identity, peer.publicKey)
      const response = await lanSyncTransport.sendSync(peer, encrypted)
      const mergedRemote = await decryptLanSnapshot(response, identity)
      const summary = await mergeLanSnapshot(mergedRemote, { include: acceptFilter })
      setStatus({ tone: 'working', message: `${summaryText(summary)}；正在交换图片和 PDF…`, progress: 10 })

      let localDone = false
      let remoteDone = false
      while (!localDone || !remoteDone) {
        const outgoing = await outboundAssets.next()
        localDone = Boolean(outgoing.transfer?.done)
        const transfer = outgoing.transfer
        setStatus({
          tone: 'working',
          message: localDone
            ? '本机素材已发送完成，正在接收对方剩余素材…'
            : `正在传输素材 ${Math.min((transfer?.assetIndex ?? 0) + 1, transfer?.assetCount ?? 0)}/${transfer?.assetCount ?? 0}…`,
          progress: transfer ? 10 + transferProgress(transfer) * .9 : 10,
        })
        const encryptedChunk = await encryptLanSnapshot(outgoing, identity, peer.publicKey)
        const encryptedResponse = await lanSyncTransport.sendSync(peer, encryptedChunk)
        const remoteChunk = await decryptLanSnapshot(encryptedResponse, identity)
        remoteDone = Boolean(remoteChunk.transfer?.done)
        // The user may have unchecked incoming assets for this sync. Older
        // peers still emit chunks regardless of wantedKinds, so we discard
        // them here rather than leaking them into the DB.
        if (selection.accept.asset) {
          const completedAsset = await inboundAssetsRef.current.accept(remoteChunk)
          if (completedAsset?.assets[0]) await storeLanAsset(completedAsset.assets[0])
        }
      }

      await finalizeLanAssets()
      setStatus({
        tone: 'success',
        message: `${summaryText(summary)}；本机发送 ${snapshotEntityCount(snapshot)} 项，双方素材传输完成${outboundAssets.skippedCount ? `，跳过 ${outboundAssets.skippedCount} 个已无法读取的旧素材` : ''}`,
        progress: 100,
      })
    } catch (error) {
      setStatus({ tone: 'error', message: error instanceof Error ? error.message : '局域网同步失败' })
    } finally {
      await lanSyncTransport.setTransferActive(false).catch(() => undefined)
      busyRef.current = false
    }
  }

  return <>
    <SettingsCollapsibleCard
      className="lan-sync-section"
      icon={<Wifi />}
      title="局域网同步"
      summary={active ? `已开启 · ${peers.length ? `${peers.length} 台设备可用` : '等待发现设备'}` : '未开启 · 同一 Wi-Fi 双向同步'}
      expanded={expanded}
      onToggle={() => setExpanded((value) => !value)}
    >
      <div className="callout lan-security-note">
        <ShieldCheck />
        <span>无需配对码，数据仅在当前局域网内直接传输；不会同步 LLM 配置和 API Key。请只在可信 Wi-Fi 下开启。</span>
      </div>

      {!active ? <button type="button" className="button primary lan-start-button" disabled={starting} onClick={() => void start()}>
        {starting ? <LoaderCircle className="spin" /> : <Wifi />}{starting ? '正在开启…' : '开启局域网同步'}
      </button> : <>
        <div className="lan-toolbar">
          <span><span className="lan-live-dot" />已开启，选择设备即可同步</span>
          <div>
            <button type="button" className="icon-button" aria-label="刷新设备" onClick={() => void lanSyncTransport.refresh()}><RefreshCw /></button>
            <button type="button" className="icon-button" aria-label="关闭局域网同步" title="关闭局域网同步" onClick={() => void stop()}><Power /></button>
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
      {status.tone === 'working' && <div className="lan-sync-progress">
        <progress max="100" value={status.progress} aria-label="局域网同步进度" />
        <span>{status.progress === undefined ? '准备中' : `${Math.round(status.progress)}%`}</span>
      </div>}
    </SettingsCollapsibleCard>

    {selectedPeer && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (!previewLoading && event.target === event.currentTarget) setSelectedPeer(null) }}>
      <section className="lan-sync-sheet" role="dialog" aria-modal="true" aria-labelledby="lan-sync-title">
        <button type="button" className="icon-button lan-sync-close" aria-label="关闭" disabled={previewLoading} onClick={() => setSelectedPeer(null)}><X /></button>
        <span className="lan-peer-icon large">{selectedPeer.deviceType === 'web' ? <Laptop /> : <Smartphone />}</span>
        <h2 id="lan-sync-title">与 {selectedPeer.alias} 同步</h2>
        <p>{previewLoading ? '正在比较两台设备的数据，请稍候…' : '先查看同步后双方会增加或更新哪些内容；再次确认后才会真正写入数据。'}</p>
        <button type="button" className="button primary" disabled={previewLoading} autoFocus onClick={() => void prepareSyncPreview()}>
          {previewLoading ? <LoaderCircle className="spin" /> : <ArrowRightLeft />}
          {previewLoading ? '正在准备同步内容…' : '查看同步内容'}
        </button>
      </section>
    </div>}

    {pendingPreview && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingPreview(null) }}>
      <section className="lan-sync-sheet lan-preview-sheet" role="dialog" aria-modal="true" aria-labelledby="lan-preview-title">
        <button type="button" className="icon-button lan-sync-close" aria-label="关闭" onClick={() => setPendingPreview(null)}><X /></button>
        <h2 id="lan-preview-title">确认同步内容</h2>
        <p>以下是同步后双方预计产生的变化。默认全部同步；取消勾选某一项即可跳过该类别。确认前两台设备的数据都不会被修改。</p>
        <div className="lan-preview-grid">
          <PreviewSummary
            title="本机将发生"
            preview={pendingPreview.local}
            selection={syncSelection.accept}
            onToggle={(kind) => setSyncSelection((prev) => ({ ...prev, accept: { ...prev.accept, [kind]: !prev.accept[kind] } }))}
          />
          <PreviewSummary
            title={`${pendingPreview.peer.alias} 将发生`}
            preview={pendingPreview.remote}
            selection={syncSelection.send}
            onToggle={(kind) => setSyncSelection((prev) => ({ ...prev, send: { ...prev.send, [kind]: !prev.send[kind] } }))}
          />
        </div>
        <div className="lan-preview-actions">
          <button type="button" className="button secondary" onClick={() => setPendingPreview(null)}>取消</button>
          <button type="button" className="button primary" autoFocus onClick={() => void sync()}><ArrowRightLeft />确认并开始同步</button>
        </div>
      </section>
    </div>}
  </>
}
