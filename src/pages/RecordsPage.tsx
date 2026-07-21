import { format, parseISO } from 'date-fns'
import { Activity, Check, ChevronRight, FileImage, ListFilter, Search, Trash2, X } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { Modal } from '../components/Modal'
import { ImagePreview } from '../components/ImagePreview'
import { PageHeader } from '../components/PageHeader'
import { normalizeReportType } from '../data/reportTypeAliases'
import { useApp } from '../store/AppContext'
import type { ExamRecord, LabIndicator } from '../types'

interface TypeGroup {
  label: string
  count: number
  aliases: string[]
}

function recordType(record: ExamRecord) {
  return record.normalizedReportType || normalizeReportType(record.reportType).label
}

function flagLabel(indicator: LabIndicator) {
  if (indicator.abnormalFlag === 'high') return '偏高'
  if (indicator.abnormalFlag === 'low') return '偏低'
  if (indicator.abnormalFlag === 'critical') return '危急'
  if (indicator.abnormalFlag === 'normal') return '正常'
  return ''
}

function resultText(indicator: LabIndicator) {
  let result = indicator.rawValue.trim()
  if (indicator.unit) {
    const escapedUnit = indicator.unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(new RegExp(escapedUnit, 'gi'), '')
  }
  result = result.replace(/[↑↓↗↘▲▼]/g, '').replace(/\s+[HL]$/i, '').trim()
  return result || String(indicator.value ?? '—')
}

function TypeFilter({ groups, selected, onToggle, onReset, onClose }: {
  groups: TypeGroup[]
  selected: string[]
  onToggle: (label: string) => void
  onReset: () => void
  onClose: () => void
}) {
  return <Modal title="筛选检查类型" onClose={onClose}>
    <div className="type-filter-intro">
      <p>可以同时选择多个类型。不同医院的同义名称已归入统一类型，原始名称仍会保留。</p>
      <button className="text-button" type="button" onClick={onReset}>查看全部</button>
    </div>
    <div className="type-option-list" role="group" aria-label="检查类型多选">
      {groups.map((group) => {
        const checked = selected.includes(group.label)
        return <button key={group.label} type="button" role="checkbox" aria-checked={checked} className={`type-option${checked ? ' selected' : ''}`} onClick={() => onToggle(group.label)}>
          <span className="type-check" aria-hidden="true">{checked && <Check />}</span>
          <span className="type-option-copy"><strong>{group.label}</strong><small>{group.count} 份记录{group.aliases.some((alias) => alias !== group.label) ? ` · ${group.aliases.join('、')}` : ''}</small></span>
        </button>
      })}
    </div>
    <div className="form-actions type-filter-footer"><span>{selected.length ? `已选 ${selected.length} 类` : '当前显示全部类型'}</span><span className="spacer" /><button className="button primary" type="button" onClick={onClose}>完成</button></div>
  </Modal>
}

function RecordDetail({ record, onClose }: { record: ExamRecord; onClose: () => void }) {
  const { deleteRecord } = useApp()
  const [deleteConfirming, setDeleteConfirming] = useState(false)
  const normalizedType = recordType(record)
  return <div className="record-detail">
    <div className="detail-summary"><div><span>检查日期</span><strong>{record.examDate}</strong></div><div><span>医院</span><strong>{record.hospital || '未记录'}</strong></div></div>
    {normalizedType !== record.reportType && <p className="record-type-source">医院原始名称：{record.reportType}</p>}
    <section><h3>指标明细 <small>{record.indicators.length} 项</small></h3>{record.indicators.length ? <div className="indicator-table-wrap"><table className="indicator-table"><thead><tr><th>指标</th><th>结果</th><th>参考范围</th></tr></thead><tbody>{record.indicators.map((item) => <tr key={item.id} className={`indicator-row ${item.abnormalFlag}`} aria-label={`${item.normalizedName}，${flagLabel(item) || '状态未标记'}`}><td title={item.rawName !== item.normalizedName ? `医院原始名称：${item.rawName}` : undefined}><strong>{item.normalizedName}{item.unit && <span className="indicator-unit">（{item.unit}）</span>}</strong></td><td><strong>{resultText(item)}</strong><span className="sr-only">{flagLabel(item)}</span></td><td>{item.referenceText || [item.referenceLow, item.referenceHigh].filter((value) => value !== null).join('–') || '—'}</td></tr>)}</tbody></table></div> : <p className="muted-text">这份报告没有结构化数值指标。</p>}</section>
    {record.images.length > 0 && <section><h3>原始图片</h3><div className="image-gallery">{record.images.map((image) => <ImagePreview key={image.id} src={image.dataUrl} alt={`检查报告：${image.name}`} />)}</div></section>}
    {record.summary && <section className="report-conclusion"><h3>报告结论</h3><p className="summary-text">{record.summary}</p></section>}
    <div className="delete-zone">
      {!deleteConfirming && <button className="button danger ghost" onClick={() => setDeleteConfirming(true)}><Trash2 />删除记录</button>}
      {deleteConfirming && <div className="delete-confirmation" role="alert"><div><strong>确认删除这份记录？</strong><p>关联的检查事件也会删除，操作无法撤销。</p></div><button className="button secondary" onClick={() => setDeleteConfirming(false)}>取消</button><button className="button danger confirm-delete" onClick={async () => { await deleteRecord(record.id); onClose() }}><Trash2 />确认删除</button></div>}
    </div>
  </div>
}

export function RecordsPage() {
  const { records } = useApp()
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [filterOpen, setFilterOpen] = useState(false)
  const [abnormalOnly, setAbnormalOnly] = useState(false)
  const [selected, setSelected] = useState<ExamRecord | null>(null)

  const typeGroups = useMemo<TypeGroup[]>(() => {
    const groups = new Map<string, { count: number; aliases: Set<string> }>()
    records.forEach((record) => {
      const label = recordType(record)
      const current = groups.get(label) ?? { count: 0, aliases: new Set<string>() }
      current.count += 1
      current.aliases.add(record.reportType)
      groups.set(label, current)
    })
    return [...groups.entries()].map(([label, value]) => ({ label, count: value.count, aliases: [...value.aliases].sort() })).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
  }, [records])

  const filtered = useMemo(() => records.filter((record) => {
    const normalizedType = recordType(record)
    if (selectedTypes.length && !selectedTypes.includes(normalizedType)) return false
    if (abnormalOnly && !record.indicators.some((item) => ['high', 'low', 'critical'].includes(item.abnormalFlag))) return false
    if (deferredQuery && ![normalizedType, record.reportType, record.hospital, record.department, record.summary, ...record.indicators.map((item) => item.rawName)].filter(Boolean).join(' ').toLowerCase().includes(deferredQuery)) return false
    return true
  }).sort((a, b) => b.examDate.localeCompare(a.examDate)), [records, selectedTypes, abnormalOnly, deferredQuery])

  const toggleType = (label: string) => setSelectedTypes((current) => current.includes(label) ? current.filter((item) => item !== label) : [...current, label])

  return <>
    <PageHeader eyebrow="检查档案" title="检查记录" description="查看原始报告、结构化指标和异常标记。" />
    <section className="toolbar card compact records-toolbar">
      <label className="search-box"><Search /><span className="sr-only">搜索记录</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索医院、报告或指标" /></label>
      <button type="button" className={`button secondary type-filter-button${selectedTypes.length ? ' active' : ''}`} onClick={() => setFilterOpen(true)} aria-haspopup="dialog"><ListFilter /><span>{selectedTypes.length ? `已选 ${selectedTypes.length} 类` : '全部类型'}</span><small>{typeGroups.length}</small></button>
      <label className="check-control"><input type="checkbox" checked={abnormalOnly} onChange={(e) => setAbnormalOnly(e.target.checked)} />只看异常</label>
    </section>
    {selectedTypes.length > 0 && <div className="active-filter-row" aria-label="已选检查类型">{selectedTypes.map((type) => <button key={type} type="button" className="filter-chip" onClick={() => toggleType(type)} aria-label={`移除筛选：${type}`}><span>{type}</span><X /></button>)}<button type="button" className="text-button" onClick={() => setSelectedTypes([])}>清除全部</button></div>}
    <div className="records-grid">
      <section className="stat-card card"><Activity /><div><strong>{records.length}</strong><span>检查记录</span></div></section>
      <section className="stat-card card"><FileImage /><div><strong>{records.reduce((sum, item) => sum + item.images.length, 0)}</strong><span>原始图片</span></div></section>
      <section className="stat-card card"><span className="status-dot abnormal" /><div><strong>{records.filter((record) => record.indicators.some((item) => ['high', 'low', 'critical'].includes(item.abnormalFlag))).length}</strong><span>含异常标记</span></div></section>
    </div>
    <section className="record-list card">
      <div className="section-heading"><h2>记录列表</h2><small>显示 {filtered.length} 条</small></div>
      {filtered.length === 0 && <div className="empty-state"><FileImage /><h3>暂无符合条件的记录</h3><p>可以调整筛选条件，或通过“导入”页面添加检查报告。</p></div>}
      {filtered.map((record) => {
        const abnormalCount = record.indicators.filter((item) => ['high', 'low', 'critical'].includes(item.abnormalFlag)).length
        const normalizedType = recordType(record)
        return <button className="record-row" key={record.id} onClick={() => setSelected(record)}><span className="record-date"><strong>{format(parseISO(record.examDate), 'dd')}</strong><small>{format(parseISO(record.examDate), 'yyyy.MM')}</small></span><span className="record-main"><strong>{normalizedType}</strong>{normalizedType !== record.reportType && <small className="raw-type-label">原报告：{record.reportType}</small>}<small>{record.hospital || '医院未记录'} · {record.indicators.length} 项指标 · {record.images.length} 张图片</small></span>{abnormalCount > 0 && <span className="abnormal-badge">{abnormalCount} 项异常</span>}<ChevronRight /></button>
      })}
    </section>
    {filterOpen && <TypeFilter groups={typeGroups} selected={selectedTypes} onToggle={toggleType} onReset={() => setSelectedTypes([])} onClose={() => setFilterOpen(false)} />}
    {selected && <Modal title={recordType(selected)} onClose={() => setSelected(null)} wide swipeToClose><RecordDetail record={selected} onClose={() => setSelected(null)} /></Modal>}
  </>
}
