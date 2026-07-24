import { format, parseISO } from 'date-fns'
import { ChevronRight, FileImage, FileUp, ListFilter, Pencil, Plus, RefreshCw, Save, Search, Trash2, TriangleAlert, X } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ChoicePicker } from '../components/ChoicePicker'
import { HistoryCombobox } from '../components/HistoryCombobox'
import { Modal } from '../components/Modal'
import { ImagePreview } from '../components/ImagePreview'
import { INDICATORS, normalizeIndicator } from '../data/indicatorAliases'
import { normalizeReportType, REPORT_TYPES } from '../data/reportTypeAliases'
import { sha256 } from '../services/images'
import { storedImageSource } from '../services/imageStorage'
import { useApp } from '../store/AppContext'
import { newId, type AbnormalFlag, type ExamRecord, type LabIndicator } from '../types'

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

const abnormalOptions = [
  { value: 'normal', label: '正常' },
  { value: 'high', label: '偏高' },
  { value: 'low', label: '偏低' },
  { value: 'critical', label: '危急' },
  { value: 'unknown', label: '未标记' },
]

function parseOptionalNumber(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  const number = Number(trimmed)
  return Number.isFinite(number) ? number : null
}

function parseResultValue(value: string) {
  const normalized = value.trim().replace(/^[<>≤≥]\s*/, '')
  if (!normalized) return null
  const number = Number(normalized)
  return Number.isFinite(number) ? number : null
}

interface IndicatorDraft {
  id: string
  rawName: string
  normalizedCode: string
  normalizedName: string
  result: string
  unit: string
  referenceLow: string
  referenceHigh: string
  referenceText: string
  abnormalFlag: AbnormalFlag
}

function indicatorDraft(item?: LabIndicator): IndicatorDraft {
  return {
    id: item?.id ?? newId(),
    rawName: item?.rawName ?? '',
    normalizedCode: item?.normalizedCode ?? 'OTHER',
    normalizedName: item?.normalizedName ?? '其他指标',
    result: item ? resultText(item) : '',
    unit: item?.unit ?? '',
    referenceLow: item?.referenceLow?.toString() ?? '',
    referenceHigh: item?.referenceHigh?.toString() ?? '',
    referenceText: item?.referenceText ?? '',
    abnormalFlag: item?.abnormalFlag ?? 'unknown',
  }
}

function RecordEditForm({ record, onCancel, onSaved }: { record: ExamRecord; onCancel: () => void; onSaved: (record: ExamRecord) => void }) {
  const { saveRecord, vocabulary } = useApp()
  const [form, setForm] = useState(() => ({
    reportType: record.reportType,
    normalizedReportType: recordType(record),
    examDate: record.examDate,
    reportDate: record.reportDate ?? '',
    hospital: record.hospital ?? '',
    department: record.department ?? '',
    summary: record.summary ?? '',
  }))
  const [indicators, setIndicators] = useState<IndicatorDraft[]>(() => record.indicators.map(indicatorDraft))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }))
  const setIndicator = (id: string, changes: Partial<IndicatorDraft>) => setIndicators((current) => current.map((item) => item.id === id ? { ...item, ...changes } : item))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    if (!form.reportType.trim()) return setError('请输入医院原报告名称')
    if (!form.examDate) return setError('请选择检查日期')
    const unnamed = indicators.find((item) => !item.rawName.trim())
    if (unnamed) return setError('请填写每一项指标的原始名称，或移除空白指标')
    setSaving(true)
    try {
      const normalizedIndicators: LabIndicator[] = indicators.map((item) => {
        const normalized = normalizeIndicator(item.rawName, item.normalizedCode, item.normalizedName)
        return {
          id: item.id,
          rawName: item.rawName.trim(),
          normalizedCode: normalized.code,
          normalizedName: normalized.name,
          value: parseResultValue(item.result),
          rawValue: item.result.trim(),
          unit: item.unit.trim(),
          referenceLow: parseOptionalNumber(item.referenceLow),
          referenceHigh: parseOptionalNumber(item.referenceHigh),
          referenceText: item.referenceText.trim(),
          abnormalFlag: item.abnormalFlag,
        }
      })
      const now = new Date().toISOString()
      const fingerprintSource = [form.hospital.trim(), form.examDate, form.normalizedReportType, ...normalizedIndicators.map((item) => `${item.normalizedCode}:${item.rawValue}`)].join('|')
      const updated: ExamRecord = {
        ...record,
        reportType: form.reportType.trim(),
        normalizedReportType: form.normalizedReportType,
        examDate: form.examDate,
        reportDate: form.reportDate || undefined,
        hospital: form.hospital.trim() || undefined,
        department: form.department.trim() || undefined,
        summary: form.summary.trim() || undefined,
        indicators: normalizedIndicators,
        fingerprint: await sha256(fingerprintSource),
        updatedAt: now,
      }
      await saveRecord(updated)
      onSaved(updated)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  return <form className="record-edit-form" onSubmit={submit}>
    <section className="edit-section">
      <div className="edit-section-heading"><div><h3>报告信息</h3><p>修改后会同步更新关联的日历检查事件。</p></div></div>
      <div className="form-grid">
        <ChoicePicker label="标准报告类型" options={REPORT_TYPES.map((item) => ({ value: item.label, label: item.label }))} value={form.normalizedReportType} onChange={(value) => set('normalizedReportType', value as string)} />
        <label>医院原报告名称<input value={form.reportType} onChange={(event) => set('reportType', event.target.value)} placeholder="例如：血细胞分析报告" /></label>
        <label>检查日期<input type="date" value={form.examDate} onChange={(event) => set('examDate', event.target.value)} required /></label>
        <label>报告日期（可选）<input type="date" value={form.reportDate} onChange={(event) => set('reportDate', event.target.value)} /></label>
        <HistoryCombobox label="医院" value={form.hospital} onChange={(value) => set('hospital', value)} options={vocabulary.hospitals} placeholder="输入或选择历史医院" />
        <HistoryCombobox label="科室" value={form.department} onChange={(value) => set('department', value)} options={vocabulary.departments} placeholder="输入或选择历史科室" />
        <label className="full-width">报告结论<textarea rows={4} value={form.summary} onChange={(event) => set('summary', event.target.value)} placeholder="填写报告中的结论或描述" /></label>
      </div>
    </section>
    <section className="edit-section">
      <div className="edit-section-heading"><div><h3>指标明细</h3><p>{indicators.length} 项，可修改结果、参考范围和异常状态。</p></div><button type="button" className="button secondary" onClick={() => setIndicators((current) => [...current, indicatorDraft()])}><Plus />添加指标</button></div>
      <div className="indicator-editor-list">
        {indicators.length === 0 && <p className="muted-text">这份报告暂时没有结构化指标。</p>}
        {indicators.map((item, index) => <fieldset className="indicator-editor" key={item.id}>
          <legend>指标 {index + 1}</legend>
          <div className="indicator-editor-heading"><strong>{item.normalizedName || item.rawName || `指标 ${index + 1}`}</strong><button type="button" className="icon-button danger" aria-label={`移除指标 ${index + 1}`} onClick={() => setIndicators((current) => current.filter((candidate) => candidate.id !== item.id))}><Trash2 /></button></div>
          <div className="form-grid indicator-fields">
            <ChoicePicker label="标准指标" options={[...INDICATORS.map((definition) => ({ value: definition.code, label: definition.name, description: definition.code })), { value: 'OTHER', label: '其他指标' }]} value={INDICATORS.some((definition) => definition.code === item.normalizedCode) ? item.normalizedCode : 'OTHER'} onChange={(value) => {
              const definition = INDICATORS.find((candidate) => candidate.code === value)
              setIndicator(item.id, definition ? { normalizedCode: definition.code, normalizedName: definition.name, unit: item.unit || definition.standardUnit || '' } : { normalizedCode: item.normalizedCode.startsWith('CUSTOM_') ? item.normalizedCode : 'OTHER', normalizedName: item.normalizedName === '其他指标' ? item.normalizedName : item.rawName || '其他指标' })
            }} />
            <label>结果（数值或文字）<input value={item.result} onChange={(event) => setIndicator(item.id, { result: event.target.value })} inputMode="decimal" placeholder="例如 4.2 或 阴性" /></label>
            <label>单位<input value={item.unit} onChange={(event) => setIndicator(item.id, { unit: event.target.value })} placeholder="例如 10^9/L" /></label>
            <label>参考下限<input value={item.referenceLow} onChange={(event) => setIndicator(item.id, { referenceLow: event.target.value })} inputMode="decimal" placeholder="可选" /></label>
            <label>参考上限<input value={item.referenceHigh} onChange={(event) => setIndicator(item.id, { referenceHigh: event.target.value })} inputMode="decimal" placeholder="可选" /></label>
            <label className="full-width">报告原始参考范围<input value={item.referenceText} onChange={(event) => setIndicator(item.id, { referenceText: event.target.value })} placeholder="例如 3.5–9.5" /></label>
            <div className="full-width"><ChoicePicker label="异常状态" options={abnormalOptions} value={item.abnormalFlag} onChange={(value) => setIndicator(item.id, { abnormalFlag: value as AbnormalFlag })} /></div>
          </div>
        </fieldset>)}
      </div>
    </section>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="form-actions record-edit-actions"><span className="spacer" /><button type="button" className="button secondary" onClick={onCancel} disabled={saving}>取消</button><button className="button primary" type="submit" disabled={saving}><Save />{saving ? '保存中…' : '保存修改'}</button></div>
  </form>
}

function RecordDetail({ record, onClose, onEdit, onRecognized }: { record: ExamRecord; onClose: () => void; onEdit: () => void; onRecognized: (record: ExamRecord) => void }) {
  const { deleteRecord, rerecognizeRecord } = useApp()
  const [deleteConfirming, setDeleteConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [recognizing, setRecognizing] = useState(false)
  const [recognizeError, setRecognizeError] = useState('')

  async function confirmDelete() {
    setDeleting(true)
    setDeleteError('')
    try {
      await deleteRecord(record.id)
      onClose()
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : '删除失败，请重试')
      setDeleting(false)
    }
  }

  async function recognizeAgain() {
    setRecognizing(true)
    setRecognizeError('')
    try {
      const updated = await rerecognizeRecord(record.id)
      onRecognized(updated)
    } catch (error) {
      setRecognizeError(error instanceof Error ? error.message : '重新识别失败，请重试')
    } finally {
      setRecognizing(false)
    }
  }

  return <div className="record-detail">
    <div className="detail-summary"><div><span>检查日期</span><strong>{record.examDate}</strong></div><div><span>医院</span><strong title={record.hospital || '未记录'}>{record.hospital || '未记录'}</strong></div></div>
    <section><div className="record-section-heading"><h3>指标明细 <small>{record.indicators.length} 项</small></h3><button type="button" className="icon-button edit-report-button" onClick={onEdit} aria-label="编辑报告" title="编辑报告"><Pencil /></button></div>{record.indicators.length ? <div className="indicator-table-wrap"><table className="indicator-table"><thead><tr><th>指标</th><th>结果</th><th>参考范围</th></tr></thead><tbody>{record.indicators.map((item) => <tr key={item.id} className={`indicator-row ${item.abnormalFlag}`} aria-label={`${item.normalizedName}，${flagLabel(item) || '状态未标记'}`}><td title={item.rawName !== item.normalizedName ? `医院原始名称：${item.rawName}` : undefined}><strong>{item.normalizedName}{item.unit && <span className="indicator-unit">（{item.unit}）</span>}</strong></td><td><strong>{resultText(item)}</strong><span className="sr-only">{flagLabel(item)}</span></td><td>{item.referenceText || [item.referenceLow, item.referenceHigh].filter((value) => value !== null).join('–') || '—'}</td></tr>)}</tbody></table></div> : <p className="muted-text">这份报告没有结构化数值指标。</p>}</section>
    {record.images.length > 0 && <section><h3>原始图片</h3><div className="image-gallery">{record.images.map((image) => {
      const source = storedImageSource(image)
      return source ? <ImagePreview key={image.id} src={source} alt={`检查报告：${image.name}`} /> : null
    })}</div></section>}
    {record.summary && <section className="report-conclusion"><h3>报告结论</h3><p className="summary-text">{record.summary}</p></section>}
    {recognizeError && <p className="form-error record-detail-action-error" role="alert">{recognizeError}</p>}
    <div className="record-detail-actions">
      <button className="button danger ghost" onClick={() => setDeleteConfirming(true)}><Trash2 />删除记录</button>
      <button type="button" className="button secondary" disabled={recognizing || record.images.length === 0} onClick={() => void recognizeAgain()} title={record.images.length === 0 ? '这份记录没有原始图片' : '用原始图片重新识别并更新当前记录'}>
        {recognizing ? <span className="spinner" /> : <RefreshCw />}
        {recognizing ? '重新识别中…' : '重新识别'}
      </button>
    </div>
    {deleteConfirming && <Modal title="删除检查记录" onClose={() => { if (!deleting) setDeleteConfirming(false) }}>
      <div className="delete-dialog">
        <div className="delete-dialog-warning"><span className="delete-dialog-icon"><TriangleAlert /></span><div><strong>确定删除这份记录吗？</strong><p>关联的检查事件也会一并删除，此操作无法撤销。</p></div></div>
        {deleteError && <p className="form-error" role="alert">{deleteError}</p>}
        <div className="delete-dialog-actions"><button type="button" className="button secondary" autoFocus disabled={deleting} onClick={() => setDeleteConfirming(false)}>取消</button><button type="button" className="button danger confirm-delete" disabled={deleting} onClick={() => void confirmDelete()}><Trash2 />{deleting ? '删除中…' : '确认删除'}</button></div>
      </div>
    </Modal>}
  </div>
}

export function RecordsPage() {
  const { records } = useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedRecordId = searchParams.get('recordId')
  const recordDetailOrigin = typeof location.state?.recordDetailOrigin === 'string'
    ? location.state.recordDetailOrigin
    : null
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [selected, setSelected] = useState<ExamRecord | null>(() =>
    requestedRecordId ? records.find((record) => record.id === requestedRecordId) ?? null : null)
  const [editing, setEditing] = useState(false)

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
    if (deferredQuery && ![normalizedType, record.reportType, record.hospital, record.department, record.summary, ...record.indicators.map((item) => item.rawName)].filter(Boolean).join(' ').toLowerCase().includes(deferredQuery)) return false
    return true
  }).sort((a, b) => b.examDate.localeCompare(a.examDate)), [records, selectedTypes, deferredQuery])

  const toggleType = (label: string) => setSelectedTypes((current) => current.includes(label) ? current.filter((item) => item !== label) : [...current, label])

  function closeRecordDetail() {
    setSelected(null)
    setEditing(false)
    if (requestedRecordId && recordDetailOrigin) {
      navigate(-1)
      return
    }
    if (!requestedRecordId) return
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete('recordId')
    setSearchParams(nextSearchParams, { replace: true })
  }

  return <>
    <section className="toolbar card compact records-toolbar">
      <label className="search-box"><Search /><span className="sr-only">搜索记录</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索医院、报告或指标" /></label>
      <ChoicePicker compact iconOnly label="检查类型" icon={<ListFilter />} multiple allLabel="全部类型" selectionNoun="类" options={typeGroups.map((group) => ({ value: group.label, label: group.label, description: `${group.count} 份记录${group.aliases.some((alias) => alias !== group.label) ? ` · 原名称：${group.aliases.join('、')}` : ''}` }))} value={selectedTypes} onChange={(value) => setSelectedTypes(value as string[])} emptyText="暂无检查类型" />
      <Link className="icon-button records-import-button" to="/import" aria-label="导入报告" title="导入报告"><FileUp /></Link>
    </section>
    {selectedTypes.length > 0 && <div className="active-filter-row" aria-label="已选检查类型">{selectedTypes.map((type) => <button key={type} type="button" className="filter-chip" onClick={() => toggleType(type)} aria-label={`移除筛选：${type}`}><span>{type}</span><X /></button>)}<button type="button" className="text-button" onClick={() => setSelectedTypes([])}>清除全部</button></div>}
    <section className="record-list card">
      <div className="section-heading"><h2>记录列表</h2><small>显示 {filtered.length} 条</small></div>
      {filtered.length === 0 && <div className="empty-state"><FileImage /><h3>暂无符合条件的记录</h3><p>可以调整筛选条件，或通过“导入”页面添加检查报告。</p></div>}
      {filtered.map((record) => {
        const abnormalCount = record.indicators.filter((item) => ['high', 'low', 'critical'].includes(item.abnormalFlag)).length
        const normalizedType = recordType(record)
        return <button className="record-row" key={record.id} onClick={() => { setSelected(record); setEditing(false) }}><span className="record-date"><strong>{format(parseISO(record.examDate), 'dd')}</strong><small>{format(parseISO(record.examDate), 'yyyy.MM')}</small></span><span className="record-main"><strong>{normalizedType}</strong><small>{record.hospital || '医院未记录'} · {record.indicators.length} 项指标</small></span>{abnormalCount > 0 && <span className="abnormal-badge">{abnormalCount} 项异常</span>}<ChevronRight /></button>
      })}
    </section>
    {selected && <Modal title={editing ? '编辑检查报告' : recordType(selected)} onClose={closeRecordDetail} wide swipeToClose={!editing}>{editing ? <RecordEditForm record={selected} onCancel={() => setEditing(false)} onSaved={(updated) => { setSelected(updated); setEditing(false) }} /> : <RecordDetail record={selected} onClose={closeRecordDetail} onEdit={() => setEditing(true)} onRecognized={setSelected} />}</Modal>}
  </>
}
