import { ArrowRightLeft, CheckCircle2, Laptop, LoaderCircle, Power, RefreshCw, Smartphone, Wifi, X } from 'lucide-react'
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
  type LanAssetChunkSource,
  type LanCryptoIdentity,
  type LanSyncKindFilter,
} from '../services/lanSync'
import { lanSyncTransport, type IncomingLanRequest, type LanPeer, type LanServiceInfo } from '../services/lanSyncTransport'
import { isHarmonyPlatform } from '../platform/harmonyBridge'
import { Capacitor } from '@capacitor/core'
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
    : Capacitor.getPlatform() === 'ios' ? 'CareJournal iPhone'
    : /Android/i.test(navigator.userAgent) ? 'CareJournal 手机' : 'CareJournal 网页'
  localStorage.setItem('carejournal-lan-alias', alias)
  return alias
}

function changesText(summary: Awaited<ReturnType<ReturnType<typeof useApp>['mergeLanSnapshot']>>) {
  // Human-friendly summary that only mentions counters that are actually
  // non-zero. Callers wrap this with the appropriate prefix ("同步完成"、
  // "记录已合并" …) depending on the sync phase.
  const parts: string[] = []
  const changed = summary.added + summary.updated + summary.deleted
  if (changed > 0) parts.push(`${changed} 项变化`)
  if (summary.conflictsMerged > 0) parts.push(`处理 ${summary.conflictsMerged} 项双方修改`)
  if (summary.assetsReceived > 0) parts.push(`新增 ${summary.assetsReceived} 个素材`)
  if (parts.length === 0) return '双方数据已经一致'
  return parts.join('，')
}

/**
 * Any row of any kind that would actually add / update / delete something on
 * the target device. When both sides return false the sync is a no-op and the
 * confirm button is disabled so the user is not led to trigger a pointless
 * round trip.
 */
function hasPreviewChange(preview: LanSyncPreview) {
  return previewKinds.some(([kind]) => {
    const item = preview[kind]
    return item.added > 0 || item.updated > 0 || item.deleted > 0
  })
}

/** Renders "42 秒" / "1 分" / "2 分 15 秒" — the units the user actually thinks in. */
function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 1) return '不到 1 秒'
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds - minutes * 60
  return remainder === 0 ? `${minutes} 分` : `${minutes} 分 ${remainder} 秒`
}

export function LanSyncPanel() {
  const { createLanSnapshot, mergeLanSnapshot, previewLanSnapshot, storeLanAsset, finalizeLanAssets } = useApp()
  const [expanded, setExpanded] = useState(false)
  const [active, setActive] = useState(false)
  const [starting, setStarting] = useState(false)
  const [info, setInfo] = useState<LanServiceInfo | null>(null)
  const [peers, setPeers] = useState<LanPeer[]>([])
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
  // Flag flipped to true as soon as mergeLanSnapshot commits the peer's data
  // during a receive session. Later chunk exchange / cleanup errors then know
  // to not scare the user with a red "failure" status for bytes that are
  // already safely on disk.
  const sessionMergedRef = useRef(false)
  // Wall-clock start of the current receive session so the final status can
  // tell the user how long the whole exchange actually took. Set on the first
  // meaningful phase (metadata merge or legacy compat), cleared once the sync
  // completes or errors out.
  const receiveStartedAtRef = useRef<number | null>(null)
  // Merge summary produced during the receive metadata phase — reused when
  // asset chunks finish so the final status can report record and asset
  // deltas alongside the elapsed time.
  const receiveSummaryRef = useRef<Awaited<ReturnType<typeof mergeLanSnapshot>> | null>(null)
  // Number of asset chunks fully assembled (and persisted) on this device
  // during the current receive session — used only for the final summary.
  const receiveChunkCountRef = useRef(0)

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
        if (receiveStartedAtRef.current === null) receiveStartedAtRef.current = Date.now()
        setStatus({ tone: 'working', message: '正在合并双方数据…', progress: 15 })
        const summary = await mergeLanSnapshot(incoming)
        sessionMergedRef.current = true
        receiveSummaryRef.current = summary
        // The initiator declares which kinds it is willing to accept. We honour
        // that so no bytes are wasted for kinds the user unchecked over there.
        const responderInclude = kindFilterFromWantedKinds(incoming.transfer.wantedKinds)
        outboundAssetsRef.current = await createLanAssetChunkSource(
          currentInfo.alias,
          incoming.transfer.availableAssetIds,
          { include: responderInclude },
        )
        inboundAssetsRef.current = new LanAssetChunkReceiver()
        receiveChunkCountRef.current = 0
        const metadata = await createLanMetadataSnapshot(currentInfo.alias, { include: responderInclude })
        const response = await encryptLanSnapshot(metadata, identity, request.envelope.senderPublicKey)
        await lanSyncTransport.completeSync(request.requestId, response)
        const willTransferAssets = summary.assetsReceived > 0 || (outboundAssetsRef.current?.assetCount ?? 0) > 0
        if (willTransferAssets) {
          setStatus({
            tone: 'working',
            message: `已合并（${changesText(summary)}），开始交换图片和 PDF…`,
            progress: 25,
          })
        } else {
          // Neither side has any bytes to move. Wrap up the whole session
          // here so the initiator can skip its empty drain loop and the
          // asset-phase handler below never gets to re-render "同步完成，用时
          // 不到 1 秒" on top of the real completion timestamp.
          await finalizeLanAssets().catch((error) => console.warn('finalizeLanAssets failed after successful sync:', error))
          await lanSyncTransport.setTransferActive(false).catch((error) => console.warn('setTransferActive failed after successful sync:', error))
          const elapsedMs = Date.now() - (receiveStartedAtRef.current ?? Date.now())
          receiveStartedAtRef.current = null
          receiveSummaryRef.current = null
          sessionMergedRef.current = false
          setStatus({
            tone: 'success',
            message: `同步完成：${changesText(summary)}，用时 ${formatDuration(elapsedMs)}`,
            progress: 100,
          })
        }
        return
      }
      if (incoming.transfer?.phase === 'assets') {
        // Defensive guard for peers that still drain a chunk loop even when
        // both sides agreed nothing was going to flow. If the metadata phase
        // has already reported "同步完成" we quietly acknowledge the drain
        // without stomping on the UI with a bogus "用时不到 1 秒".
        if (receiveStartedAtRef.current === null && sessionMergedRef.current === false) {
          if (!outboundAssetsRef.current) outboundAssetsRef.current = await createLanAssetChunkSource(currentInfo.alias)
          const outgoing = await outboundAssetsRef.current.next()
          const response = await encryptLanSnapshot(outgoing, identity, request.envelope.senderPublicKey)
          await lanSyncTransport.completeSync(request.requestId, response)
          return
        }
        const incomingTransfer = incoming.transfer
        setStatus({
          tone: 'working',
          message: incomingTransfer.done
            ? '对方素材已发送完成，正在完成本机素材发送…'
            : `正在接收素材 ${Math.min((incomingTransfer.assetIndex ?? 0) + 1, incomingTransfer.assetCount ?? 0)}/${incomingTransfer.assetCount ?? 0}…`,
          progress: 25 + transferProgress(incomingTransfer) * 0.67,
        })
        const completedAsset = await inboundAssetsRef.current.accept(incoming)
        if (completedAsset?.assets[0]) {
          await storeLanAsset(completedAsset.assets[0])
          receiveChunkCountRef.current += 1
        }
        if (!outboundAssetsRef.current) outboundAssetsRef.current = await createLanAssetChunkSource(currentInfo.alias)
        const outgoing = await outboundAssetsRef.current.next()
        const response = await encryptLanSnapshot(outgoing, identity, request.envelope.senderPublicKey)
        await lanSyncTransport.completeSync(request.requestId, response)
        const transfer = incoming.transfer
        const bothDone = Boolean(transfer.done && outgoing.transfer?.done)
        if (bothDone) {
          setStatus({ tone: 'working', message: '正在整理素材目录…', progress: 95 })
          // Data has already been merged and every chunk we could accept is on
          // disk. Swallow errors from these cleanup steps so the UI never shows
          // a red "failure" for a sync whose bytes are safely persisted.
          await finalizeLanAssets().catch((error) => console.warn('finalizeLanAssets failed after successful sync:', error))
          await lanSyncTransport.setTransferActive(false).catch((error) => console.warn('setTransferActive failed after successful sync:', error))
          sessionMergedRef.current = false
        }
        if (bothDone) {
          const elapsedMs = Date.now() - (receiveStartedAtRef.current ?? Date.now())
          const parts: string[] = []
          const summary = receiveSummaryRef.current
          if (summary) parts.push(changesText(summary))
          if (receiveChunkCountRef.current > 0) parts.push(`接收 ${receiveChunkCountRef.current} 个素材`)
          if ((outboundAssetsRef.current?.assetCount ?? 0) > 0) parts.push(`发送 ${outboundAssetsRef.current!.assetCount} 个素材`)
          if ((transfer.skippedAssets ?? 0) > 0) parts.push(`对方跳过 ${transfer.skippedAssets} 个已无法读取的素材`)
          parts.push(`用时 ${formatDuration(elapsedMs)}`)
          receiveStartedAtRef.current = null
          receiveSummaryRef.current = null
          receiveChunkCountRef.current = 0
          setStatus({
            tone: 'success',
            message: `同步完成：${parts.join('，')}`,
            progress: 100,
          })
        } else {
          setStatus({
            tone: 'working',
            message: transfer.done
              ? '对方素材已接收完成，正在完成本机素材发送…'
              : `正在接收素材 ${Math.min((transfer.assetIndex ?? 0) + 1, transfer.assetCount ?? 0)}/${transfer.assetCount ?? 0}…`,
            progress: 25 + transferProgress(transfer) * 0.67,
          })
        }
        return
      }

      // Compatibility with version 0.19.0 and earlier single-envelope peers.
      if (receiveStartedAtRef.current === null) receiveStartedAtRef.current = Date.now()
      const summary = await mergeLanSnapshot(incoming)
      sessionMergedRef.current = true
      const mergedSnapshot = await createLanSnapshot(currentInfo.alias)
      const response = await encryptLanSnapshot(mergedSnapshot, identity, request.envelope.senderPublicKey)
      await lanSyncTransport.completeSync(request.requestId, response)
      sessionMergedRef.current = false
      const elapsedMs = Date.now() - (receiveStartedAtRef.current ?? Date.now())
      receiveStartedAtRef.current = null
      receiveSummaryRef.current = null
      setStatus({ tone: 'success', message: `同步完成：${changesText(summary)}，用时 ${formatDuration(elapsedMs)}` })
    } catch (error) {
      await lanSyncTransport.setTransferActive(false).catch(() => undefined)
      const message = error instanceof Error ? error.message : '接收同步失败'
      // If the merge already landed in this session, refuse to override the
      // successful status with a red failure — the user's data is already on
      // disk and later cleanup / chunk errors are non-fatal.
      if (sessionMergedRef.current) {
        console.warn('LAN sync failed after data was already merged:', error)
        sessionMergedRef.current = false
      } else {
        await lanSyncTransport.rejectSync(request.requestId, message).catch(() => undefined)
        setStatus({ tone: 'error', message })
      }
      receiveStartedAtRef.current = null
      receiveSummaryRef.current = null
      receiveChunkCountRef.current = 0
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
    sessionMergedRef.current = false
    receiveStartedAtRef.current = null
    receiveSummaryRef.current = null
    receiveChunkCountRef.current = 0
    setPeers([])
    setStatus({ tone: 'neutral', message: '局域网同步已关闭。' })
  }

  async function prepareSyncPreview(peer: LanPeer) {
    if (busyRef.current) return
    const identity = identityRef.current
    if (!identity || !peer.publicKey) {
      setStatus({ tone: 'error', message: '设备密钥尚未就绪，请刷新设备后重试' })
      return
    }
    busyRef.current = true
    setPreviewLoading(true)
    setStatus({ tone: 'working', message: `正在比较与 ${peer.alias} 同步后的变化…`, progress: 2 })
    try {
      const localAlias = info?.alias || deviceAlias()
      const snapshot = await createLanPreviewSnapshot(localAlias)
      const envelope = await encryptLanSnapshot(snapshot, identity, peer.publicKey)
      const response = await lanSyncTransport.sendSync(peer, envelope)
      const remoteSnapshot = await decryptLanSnapshot(response, identity)
      const localPreview = await previewLanSnapshot(remoteSnapshot)
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
    const startedAt = Date.now()
    setStatus({ tone: 'working', message: `正在整理本机数据…`, progress: 3 })
    let mergedSummary: Awaited<ReturnType<typeof mergeLanSnapshot>> | null = null
    let receivedChunks = 0
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
      // The peer runs its own mergeLanSyncSnapshot inside the HTTP round-trip
      // below, so the user actually stares at this message while both devices
      // read and rewrite their catalogs. That is why we surface "交换数据" and
      // not "发送 X 项" — the truth is a synchronous exchange, not a one-way push.
      setStatus({ tone: 'working', message: `正在与 ${peer.alias} 交换数据…`, progress: 10 })
      const encrypted = await encryptLanSnapshot(snapshot, identity, peer.publicKey)
      const response = await lanSyncTransport.sendSync(peer, encrypted)
      const mergedRemote = await decryptLanSnapshot(response, identity)
      setStatus({ tone: 'working', message: '正在合并双方数据…', progress: 18 })
      const summary = await mergeLanSnapshot(mergedRemote, { include: acceptFilter })
      mergedSummary = summary
      const willTransferAssets = summary.assetsReceived > 0 || outboundAssets.assetCount > 0
      if (willTransferAssets) {
        setStatus({
          tone: 'working',
          message: `已合并（${changesText(summary)}），开始交换图片和 PDF…`,
          progress: 25,
        })

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
            progress: transfer ? 25 + transferProgress(transfer) * 0.67 : 25,
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
            if (completedAsset?.assets[0]) {
              await storeLanAsset(completedAsset.assets[0])
              receivedChunks += 1
            }
          }
        }

        setStatus({ tone: 'working', message: '正在整理素材目录…', progress: 95 })
      }
      // Cleanup on the happy path — reconcile catalog and release the native
      // foreground service. Both are best-effort; failure here does not
      // invalidate the sync that already happened. We deliberately do NOT
      // run an empty chunk loop when both sides agree there is nothing to
      // move: doing so would poke the receiver's asset-phase handler which
      // in turn would render a duplicate "同步完成，用时不到 1 秒" on top of
      // the receiver's real completion timestamp.
      await finalizeLanAssets().catch((error) => console.warn('finalizeLanAssets failed after successful sync:', error))
      const elapsedMs = Date.now() - startedAt
      const finalParts = [changesText(summary)]
      if (receivedChunks > 0) finalParts.push(`接收 ${receivedChunks} 个素材`)
      if (outboundAssets.assetCount > 0) finalParts.push(`发送 ${outboundAssets.assetCount} 个素材`)
      if (outboundAssets.skippedCount > 0) finalParts.push(`跳过 ${outboundAssets.skippedCount} 个已无法读取的旧素材`)
      finalParts.push(`用时 ${formatDuration(elapsedMs)}`)
      setStatus({
        tone: 'success',
        message: `同步完成：${finalParts.join('，')}`,
        progress: 100,
      })
    } catch (error) {
      if (mergedSummary) {
        // The peer's data landed on our disk before the transport / chunk
        // stream failed. Treat this as a partial success so the user is not
        // pushed to redo a sync whose structured records have already been
        // merged; missing asset bytes will be picked up on the next attempt
        // via the pendingSync mechanism.
        console.warn('LAN sync post-merge step failed:', error)
        await finalizeLanAssets().catch(() => undefined)
        const elapsedMs = Date.now() - startedAt
        const interruptedParts = [changesText(mergedSummary)]
        if (receivedChunks > 0) interruptedParts.push(`已接收 ${receivedChunks} 个素材`)
        interruptedParts.push(`用时 ${formatDuration(elapsedMs)}`)
        interruptedParts.push('素材传输被中断，下次同步会自动补齐')
        setStatus({
          tone: 'success',
          message: `同步完成：${interruptedParts.join('，')}`,
          progress: 100,
        })
      } else {
        setStatus({ tone: 'error', message: error instanceof Error ? error.message : '局域网同步失败' })
      }
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
            <button type="button" className="lan-peer" key={peer.fingerprint} disabled={previewLoading || pendingPreview !== null} onClick={() => void prepareSyncPreview(peer)}>
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

    {previewLoading && !pendingPreview && <div className="modal-backdrop" role="presentation">
      <section className="lan-sync-sheet lan-preview-loading" role="status" aria-live="polite">
        <LoaderCircle className="spin" aria-hidden />
        <p>正在准备同步内容…</p>
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
          {(() => {
            // Both sides showing "不会产生记录变化" means the merge would write
            // literally nothing on either device. Disable the confirm button so
            // the user is not led to trigger a pointless round trip; the intent
            // is already conveyed by the two "不会产生记录变化" lines above.
            const nothingToSync = !hasPreviewChange(pendingPreview.local) && !hasPreviewChange(pendingPreview.remote)
            return <button
              type="button"
              className="button primary"
              autoFocus
              disabled={nothingToSync}
              onClick={() => void sync()}
              title={nothingToSync ? '双方数据已经一致，无需同步' : undefined}
            ><ArrowRightLeft />{nothingToSync ? '无需同步' : '确认并开始同步'}</button>
          })()}
        </div>
      </section>
    </div>}
  </>
}
