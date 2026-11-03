import { ListFilter, WandSparkles } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { cleanIndicatorName } from '../services/indicatorNames'
import { collectIndicatorGroups, indicatorInventorySignature, projectIndicatorGroups, suggestIndicatorMerges, suggestLocalIndicatorMerges, type IndicatorAnalysis } from '../services/indicatorOrganization'
import { useApp } from '../store/AppContext'
import { Modal } from './Modal'

export function IndicatorOrganizer() {
  const { records, preferences, organizeIndicators, getIndicatorInventory, reviewIndicatorMerges } = useApp()
  const inventory = useMemo(() => collectIndicatorGroups(records), [records])
  const sortedInventory = useMemo(() => [...inventory].sort((a, b) => b.count - a.count), [inventory])
  const localMerges = useMemo(() => suggestLocalIndicatorMerges(inventory), [inventory])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<'analyzing' | 'saving' | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [analysis, setAnalysis] = useState<IndicatorAnalysis | null>(null)
  const [saveIssues, setSaveIssues] = useState<IndicatorAnalysis['issues']>([])
  const [stopRequested, setStopRequested] = useState(false)
  const [interrupted, setInterrupted] = useState(false)
  const cancelRequested = useRef(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const requestId = useRef(0)
  const activeRequest = useRef(false)
  const currentInventory = analysis?.inventory ?? inventory
  const byId = new Map(currentInventory.map((group) => [group.id, group]))
  const sortedMerges = [...(analysis?.merges ?? [])].sort((a, b) => byId.get(b.sourceId)!.count - byId.get(a.sourceId)!.count)
  const cleanCount = inventory.filter((group) => cleanIndicatorName(group.name) && cleanIndicatorName(group.name) !== group.name).reduce((count, group) => count + group.count, 0)
  const selectedMerges = analysis?.merges.filter((merge) => selectedIds.includes(merge.sourceId)) ?? []
  const stale = analysis && indicatorInventorySignature(analysis.inventory) !== indicatorInventorySignature(inventory)
  const issues = [...(analysis?.issues ?? []), ...saveIssues]

  function defaultSelection(result: IndicatorAnalysis) {
    return result.merges.map((merge) => merge.sourceId)
  }

  function close() {
    if (busy === 'saving') return
    requestId.current += 1
    cancelRequested.current = true
    activeRequest.current = false
    setOpen(false)
    setBusy(null)
  }

  async function analyze() {
    if (activeRequest.current) return
    activeRequest.current = true
    const id = ++requestId.current
    const snapshot = getIndicatorInventory()
    cancelRequested.current = false
    setStopRequested(false)
    setInterrupted(false)
    setBusy('analyzing')
    setError('')
    setMessage('')
    setSaveIssues([])
    try {
      const result = await suggestIndicatorMerges(snapshot, preferences.llm, {
        getInventory: getIndicatorInventory,
        reviewMerges: reviewIndicatorMerges,
        isCancelled: () => cancelRequested.current || id !== requestId.current,
        onProgress: (progress) => {
          if (id !== requestId.current) return
          setAnalysis(progress)
          setSelectedIds(defaultSelection(progress))
        },
      })
      if (id !== requestId.current) return
      setAnalysis(result)
      setSelectedIds(defaultSelection(result))
      setMessage(result.stopped ? '分析已停止，保留已检查项目的建议；尚未完成全部检查。' : `逐项分析完成，已检查或归并 ${result.completed}/${result.total} 项。确认前不会修改报告。`)
    } catch (failure) {
      if (id === requestId.current) {
        setError(failure instanceof Error ? failure.message : '指标分析失败，请重试')
        setInterrupted(true)
      }
    } finally {
      if (id === requestId.current) { setBusy(null); activeRequest.current = false }
    }
  }

  async function apply() {
    if (activeRequest.current) return
    activeRequest.current = true
    setBusy('saving')
    setError('')
    setMessage('')
    try {
      const result = await organizeIndicators(selectedMerges, currentInventory)
      const updated = `更新 ${result.recordsUpdated} 份报告、${result.indicatorsUpdated} 项指标和 ${result.chartsUpdated} 个图表。`
      setMessage(result.skippedGroups
        ? result.indicatorsUpdated || result.chartsUpdated
          ? `已保存可安全整理的部分：${updated}另有 ${result.skippedGroups} 组跳过，请查看待核对项目。`
          : `本次没有可安全保存的调整，${result.skippedGroups} 组已跳过；数值与单位未修改，请查看待核对项目。`
        : analysis?.issues.length
          ? `已保存已选调整：${updated}尚有需核对项目未处理。`
          : `整理完成：${updated}`)
      setSaveIssues([...(analysis?.issues ?? []), ...(result.issues ?? [])])
      setAnalysis(null)
      setSelectedIds([])
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '保存整理结果失败，请重试')
    } finally {
      activeRequest.current = false
      setBusy(null)
    }
  }

  return <>
    <button type="button" className="icon-button" aria-label="一键整理指标" title="一键整理指标" onClick={() => {
      setOpen(true); setError(''); setMessage('')
      setSaveIssues([])
      setInterrupted(false); setStopRequested(false)
      setAnalysis(localMerges.length ? {
        inventory, merges: localMerges, issues: [], completed: inventory.length - projectIndicatorGroups(inventory, localMerges).length,
        total: inventory.length, stopped: false,
      } : null)
      setSelectedIds(localMerges.map((merge) => merge.sourceId))
    }}><WandSparkles /></button>
    {open && <Modal title="整理指标" onClose={close} wide>
      <div className="indicator-organizer">
        <p>共 {inventory.length} 种指标名称、{inventory.reduce((count, group) => count + group.count, 0)} 次记录。模型只接收名称、编码、单位和次数，不发送图片、检验值或个人信息。</p>
        <p>同名且兼容的指标由本地规则识别。AI 会逐项对照最新列表检查别名及单位，需要多次模型请求，可随时停止。所有合并、单位补全或换算均需确认后保存。</p>
        <div className="indicator-organizer-actions">
          <button type="button" className="button primary" disabled={Boolean(busy) || !inventory.length} onClick={() => void analyze()}>{busy === 'analyzing' ? <span className="spinner" /> : <WandSparkles />}{busy === 'analyzing' ? '正在分析…' : 'AI 分析重复指标'}</button>
          {busy === 'analyzing' && <button type="button" className="button secondary" disabled={stopRequested} onClick={() => {
            cancelRequested.current = true; setStopRequested(true)
          }}>{stopRequested ? '等待当前请求结束…' : '停止分析'}</button>}
          {cleanCount > 0 && <span>可清理 {cleanCount} 项名称中的装饰符号</span>}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {busy === 'analyzing' && analysis && <p role="status" aria-live="polite">逐项分析：已检查或归并 {analysis.completed}/{analysis.total} 项；建议尚未保存。</p>}
        {interrupted && <p>分析未完成，已保留此前的建议；可先核对或重新分析。</p>}
        {message && <p role="status">{message}</p>}
        {analysis && <p>建议默认全选，请展开核对医学含义和单位后再确认。缺失单位由 AI 推断，尤其需要核对原报告及数值倍率。可靠换算会同步更新结果和参考范围，保留原始测量，不删除检验结果。</p>}
        {analysis && <details key={busy === 'analyzing' ? 'analyzing' : 'review'} className="indicator-merge-review" aria-label="合并建议">
          <summary>{analysis.merges.length ? `合并建议（${analysis.merges.length}）` : busy === 'analyzing' || interrupted || analysis.stopped ? '尚无可应用的建议' : '未发现可安全合并的重复指标'}</summary>
          <div className="indicator-merge-options">{sortedMerges.map((merge) => {
            const source = byId.get(merge.sourceId)!
            const target = byId.get(merge.targetId)!
            return <label className="indicator-merge-option" key={merge.sourceId}>
              <input type="checkbox" checked={selectedIds.includes(merge.sourceId)} disabled={Boolean(busy)} onChange={(event) => setSelectedIds((ids) => event.target.checked ? [...ids, merge.sourceId] : ids.filter((id) => id !== merge.sourceId))} />
              <span><strong>{source.id === target.id ? `${source.name}：单位修正` : `${source.name} → ${cleanIndicatorName(target.name)}`}</strong>
                <small>{source.id === target.id ? `${source.count} 次记录` : `${source.count} 次并入 ${target.count} 次`} · {source.units.map((unit) => unit || '单位未记录').join('、')}</small>
                {merge.unit !== undefined && <small>来源及目标统一单位：{merge.unit}（原目标：{target.units.map((unit) => unit || '缺失').join('、')}）</small>}
                <small>{source.code} → {target.code}</small><small>{merge.reason}</small></span>
            </label>
          })}</div>
        </details>}
        {issues.length > 0 && <details className="indicator-merge-review" open={saveIssues.length > 0}>
          <summary>待核对项目（{issues.length}）</summary>
          <p>以下问题已单独跳过，不影响其他可应用建议。</p>
          {issues.map((issue, index) => <p key={index}><strong>{issue.name}</strong>：{issue.message}</p>)}
        </details>}
        {stale && <p className="form-error" role="alert">指标列表已变化，请重新分析。</p>}
        {(analysis || cleanCount > 0) && <div className="indicator-organizer-actions">
          <button type="button" className="button primary" disabled={Boolean(busy) || Boolean(stale) || (!selectedMerges.length && !cleanCount)} onClick={() => void apply()}>{busy === 'saving' ? '正在保存…' : `确认整理${selectedMerges.length ? `（${selectedMerges.length} 项${selectedMerges.some((merge) => merge.unit !== undefined) ? '调整' : '合并'}）` : '名称'}`}</button>
          <small>报告、关联图表及置顶配置会一并保存。</small>
        </div>}
        <section aria-label="指标名称与次数" className="indicator-inventory">
          <h3><ListFilter />指标名称与次数</h3>
          {sortedInventory.map((group) => <div className="indicator-inventory-row" key={group.id}>
            <span><strong>{group.name}</strong><small>{group.code} · {group.units.map((unit) => unit || '单位未记录').join('、')}</small></span><span>{group.count} 次</span>
          </div>)}
          {!inventory.length && <p>还没有可整理的指标。</p>}
        </section>
      </div>
    </Modal>}
  </>
}
