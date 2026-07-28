import { Camera, Check, Clock3, File, FileImage, FileInput, FilePlus2, FolderArchive, ListFilter, Plus, RefreshCw, Search, Trash2, Undo2, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { ChoicePicker } from '../components/ChoicePicker'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { ImagePreview } from '../components/ImagePreview'
import { Modal } from '../components/Modal'
import { PdfPreview } from '../components/PdfPreview'
import { SwipeableListItem } from '../components/SwipeableListItem'
import { downloadBlob } from '../services/backup'
import { storedImageSource } from '../services/imageStorage'
import { sameStoredImage } from '../services/images'
import {
  advanceReimbursementStatus,
  buildReimbursementZip,
  changeReimbursementCoverage,
  createReimbursementPlan,
  prepareReimbursementAttachment,
  reimbursableEvents,
  reimbursementCoverageOptions,
  reimbursementPlanStatus,
  reimbursementPlanStatusLabel,
  relatedEventsForReimbursement,
} from '../services/reimbursement'
import { useApp } from '../store/AppContext'
import { EVENT_TYPES, REIMBURSEMENT_COVERAGES, newId, type ReimbursementAttachment, type ReimbursementCoverage, type ReimbursementPlan } from '../types'

function planProgress(plan: ReimbursementPlan) {
  const required = plan.materials.filter((item) => item.required)
  const completed = required.filter((item) => item.completed).length
  return { completed, total: required.length, percent: required.length ? Math.round(completed / required.length * 100) : 100 }
}

function sourceLabel(source: ReimbursementPlan['materials'][number]['attachments'][number]['source']) {
  if (source === 'record') return '来自检查记录'
  if (source === 'camera') return '相机拍摄'
  return '本地导入'
}

const REIMBURSEMENT_COVERAGE_COLORS: Record<ReimbursementCoverage, string> = {
  public_medical: '#3568A8',
  commercial: '#7651A8',
  public_and_commercial: '#087A70',
  self_pay: '#68616C',
  international_excluded: '#A23B36',
}

export function ReimbursementPage() {
  const {
    events,
    records,
    reimbursementPlans = [],
    saveReimbursementPlan,
    deleteReimbursementPlan,
  } = useApp()
  const eligibleEvents = useMemo(() => reimbursableEvents(events), [events])
  const [creating, setCreating] = useState(false)
  const [selectedEventId, setSelectedEventId] = useState('')
  const [coverage, setCoverage] = useState<ReimbursementCoverage>('public_medical')
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedForExport, setSelectedForExport] = useState<string[]>([])
  const [revealedPlanId, setRevealedPlanId] = useState<string | null>(null)
  const [uploadMaterialId, setUploadMaterialId] = useState('')
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const [selectedCoverages, setSelectedCoverages] = useState<ReimbursementCoverage[]>([])
  const [customMaterial, setCustomMaterial] = useState('')
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  const selectedPlan = reimbursementPlans.find((plan) => plan.id === selectedPlanId) ?? null
  const sortedPlans = useMemo(() => [...reimbursementPlans].sort((a, b) =>
    b.eventDate.localeCompare(a.eventDate) || b.updatedAt.localeCompare(a.updatedAt)), [reimbursementPlans])
  const coverageFilterOptions = reimbursementCoverageOptions
    .map((option) => {
      const value = option.value as ReimbursementCoverage
      const count = sortedPlans.filter((plan) => plan.coverage === value).length
      return { ...option, value, color: REIMBURSEMENT_COVERAGE_COLORS[value], count }
    })
    .filter((option) => option.count > 0)
  const filteredPlans = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')
    return sortedPlans.filter((plan) => {
      if (selectedCoverages.length && !selectedCoverages.includes(plan.coverage)) return false
      if (!normalizedQuery) return true
      return [
        plan.eventTitle,
        plan.eventDate,
        plan.hospital,
        REIMBURSEMENT_COVERAGES[plan.coverage].label,
        reimbursementPlanStatusLabel(plan),
      ].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN').includes(normalizedQuery)
    })
  }, [query, selectedCoverages, sortedPlans])

  async function createPlan() {
    const event = eligibleEvents.find((item) => item.id === selectedEventId)
    if (!event) {
      setMessage('请先选择一个病程事件')
      return
    }
    const plan = createReimbursementPlan(event, coverage, records, events)
    await saveReimbursementPlan(plan)
    setCreating(false)
    setSelectedPlanId(plan.id)
    setMessage(plan.materials.some((item) => item.attachments.length)
      ? '计划已创建，并已从检查记录中找到可复用的材料。'
      : '计划已创建，请按清单补充材料。')
  }

  async function updatePlan(plan: ReimbursementPlan) {
    await saveReimbursementPlan({ ...plan, updatedAt: new Date().toISOString() })
  }

  async function updateCoverage(nextCoverage: ReimbursementCoverage) {
    if (!selectedPlan) return
    const event = events.find((item) => item.id === selectedPlan.eventId)
    if (!event) return updatePlan({ ...selectedPlan, coverage: nextCoverage })
    await updatePlan(changeReimbursementCoverage(selectedPlan, event, nextCoverage, records, events))
  }

  async function refreshExistingMaterials() {
    if (!selectedPlan) return
    const event = events.find((item) => item.id === selectedPlan.eventId)
    if (!event) {
      setMessage('原病程事件已不存在，无法重新匹配')
      return
    }
    const updated = changeReimbursementCoverage(selectedPlan, event, selectedPlan.coverage, records, events)
    await updatePlan(updated)
    setMessage(event.type === 'hospitalization'
      ? '已合并住院期间的治疗、检查事件，并重新搜索相关图片。'
      : '已重新搜索检查记录中的图片素材。')
  }

  async function addFiles(files: FileList | null, source: 'upload' | 'camera') {
    if (!selectedPlan || !uploadMaterialId || !files?.length) return
    setUploading(true)
    setMessage('')
    try {
      const additions: ReimbursementAttachment[] = []
      for (const file of Array.from(files)) additions.push(await prepareReimbursementAttachment(file, source))
      const updated: ReimbursementPlan = {
        ...selectedPlan,
        materials: selectedPlan.materials.map((item) => {
          if (item.id !== uploadMaterialId) return item
          const attachments = [...item.attachments]
          additions.forEach((attachment) => {
            if (!attachments.some((known) => sameStoredImage(known, attachment))) attachments.push(attachment)
          })
          return { ...item, attachments, completed: attachments.length > 0 || item.completed }
        }),
      }
      await updatePlan(updated)
      setMessage(`已添加 ${additions.length} 个文件`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '添加材料失败')
    } finally {
      setUploading(false)
    }
  }

  async function exportSelected() {
    setMessage('正在整理报销材料…')
    try {
      const selection = sortedPlans.filter((plan) => selectedForExport.includes(plan.id))
      const { blob, filename } = await buildReimbursementZip(selection)
      const location = await downloadBlob(blob, filename)
      setMessage(`已导出 ${selection.length} 个报销计划至 ${location}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导出失败')
    }
  }

  const exportAllSelected = filteredPlans.length > 0 && filteredPlans.every((plan) => selectedForExport.includes(plan.id))

  function toggleExportSelection(id: string) {
    setSelectedForExport((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  function enterSelectionMode(id: string) {
    setRevealedPlanId(null)
    setSelectionMode(true)
    setSelectedForExport((current) => current.includes(id) ? current : [...current, id])
  }

  return <>
    {sortedPlans.length > 0 && <div className="toolbar card compact reimbursement-toolbar">
      <label className="search-box">
        <Search />
        <span className="sr-only">搜索报销计划</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索病程、医院或报销类型" />
      </label>
      <ChoicePicker
        compact
        iconOnly
        label="报销类型"
        icon={<ListFilter />}
        multiple
        allLabel="全部类型"
        selectionNoun="类"
        options={coverageFilterOptions}
        value={selectedCoverages}
        onChange={(value) => setSelectedCoverages(value as ReimbursementCoverage[])}
        emptyText="暂无报销类型"
      />
      <button
        type="button"
        className="icon-button reimbursement-add-button"
        aria-label="新建报销计划"
        title="新建报销计划"
        onClick={() => { setSelectedEventId(eligibleEvents[0]?.id ?? ''); setCreating(true) }}
      ><Plus /></button>
    </div>}
    {selectedCoverages.length > 0 && <div className="active-filter-row reimbursement-active-filters" aria-label="已选报销类型">
      {selectedCoverages.map((coverage) => <button
        key={coverage}
        type="button"
        className="filter-chip reimbursement-filter-chip"
        data-coverage={coverage}
        onClick={() => setSelectedCoverages((current) => current.filter((item) => item !== coverage))}
        aria-label={`移除筛选：${REIMBURSEMENT_COVERAGES[coverage].label}`}
      >
        <span>{REIMBURSEMENT_COVERAGES[coverage].label}</span><X />
      </button>)}
      <button type="button" className="text-button" onClick={() => setSelectedCoverages([])}>清除全部</button>
    </div>}

    {selectionMode && <section className="reimbursement-export-bar card" aria-label="批量导出">
      <label className="selection-control"><input type="checkbox" checked={exportAllSelected} onChange={(event) => setSelectedForExport(event.target.checked ? filteredPlans.map((plan) => plan.id) : [])} /><span>全选</span></label>
      <span>已选 {selectedForExport.length} 项</span>
      <button type="button" className="button secondary" disabled={!selectedForExport.length} onClick={() => void exportSelected()}><FolderArchive />导出 ZIP</button>
      <button type="button" className="text-button" onClick={() => { setSelectionMode(false); setSelectedForExport([]) }}>完成</button>
    </section>}

    {message && <p className="reimbursement-message" role="status">{message}</p>}

    <section className="reimbursement-plan-list">
      {filteredPlans.map((plan) => {
        const progress = planProgress(plan)
        const coverageInfo = REIMBURSEMENT_COVERAGES[plan.coverage]
        const reimbursementStatus = reimbursementPlanStatus(plan)
        const selectedForBatch = selectedForExport.includes(plan.id)
        return <SwipeableListItem
          itemId={plan.id}
          label={plan.eventTitle}
          className={`reimbursement-plan-card card status-${reimbursementStatus}${selectionMode ? ' selection-mode' : ''}${selectedForBatch ? ' selected' : ''}`}
          surfaceClassName="reimbursement-plan-content"
          editMode={selectionMode}
          revealed={revealedPlanId === plan.id}
          onRevealedChange={(revealed) => setRevealedPlanId(revealed ? plan.id : null)}
          onLongPress={() => enterSelectionMode(plan.id)}
          actions={[
            {
              id: 'reimbursement-status',
              label: reimbursementStatus === 'pending' ? '已报销' : '待报销',
              accessibilityLabel: `${reimbursementStatus === 'unmarked' ? '标记待报销' : reimbursementStatus === 'pending' ? '标记已报销' : '改为待报销'}：${plan.eventTitle}`,
              icon: reimbursementStatus === 'unmarked' ? <Clock3 /> : reimbursementStatus === 'pending' ? <Check /> : <Undo2 />,
              tone: 'success',
              onSelect: () => void updatePlan(advanceReimbursementStatus(plan)),
            },
            {
              id: 'delete',
              label: '删除',
              accessibilityLabel: `删除报销计划：${plan.eventTitle}`,
              icon: <Trash2 />,
              tone: 'danger',
              onSelect: () => setDeletingPlanId(plan.id),
            },
          ]}
          key={plan.id}
        >
          {selectionMode && <label className="reimbursement-plan-select" aria-label={`选择导出：${plan.eventTitle}`}>
            <input type="checkbox" checked={selectedForBatch} onChange={() => toggleExportSelection(plan.id)} />
          </label>}
            <button
              type="button"
              className="reimbursement-plan-main"
              aria-label={selectionMode ? `选择报销计划：${plan.eventTitle}` : `打开报销计划：${plan.eventTitle}，左滑显示操作，长按可选择`}
              onClick={() => {
                if (selectionMode) toggleExportSelection(plan.id)
                else {
                  setRevealedPlanId(null)
                  setSelectedPlanId(plan.id)
                }
              }}
            >
              <span className="reimbursement-plan-copy">
                <strong>{plan.eventTitle}</strong>
                <small>{plan.eventDate} · {plan.hospital || '医院未记录'}</small>
                <span className="reimbursement-plan-badges">
                  <span className="coverage-badge" data-coverage={plan.coverage}>{coverageInfo.label}</span>
                  {reimbursementStatus !== 'unmarked' && <span className={`reimbursement-status-badge ${reimbursementStatus}`}>
                    {reimbursementStatus === 'pending' ? <Clock3 /> : <Check />}
                    {reimbursementPlanStatusLabel(plan)}
                  </span>}
                </span>
              </span>
              <span className="reimbursement-progress" aria-label={`必需材料完成 ${progress.completed}/${progress.total}`}><strong>{progress.completed}/{progress.total}</strong></span>
              <span className="reimbursement-progress-track"><i style={{ width: `${progress.percent}%` }} /></span>
            </button>
        </SwipeableListItem>
      })}
      {sortedPlans.length > 0 && filteredPlans.length === 0 && <div className="empty-state card filtered-empty-state">
        <Search />
        <h3>没有符合条件的报销计划</h3>
        <p>换一个病程名称、医院或报销类型再试。</p>
      </div>}
      {sortedPlans.length === 0 && <div className="empty-state card"><FolderArchive /><h2>还没有报销计划</h2><p>从住院、门诊、检查、放化疗等病程事件创建，应用会先搜索已有报告图片。</p>{eligibleEvents.length > 0
        ? <button type="button" className="button primary" onClick={() => { setSelectedEventId(eligibleEvents[0]?.id ?? ''); setCreating(true) }}><Plus />创建第一个计划</button>
        : <a className="button primary" href="#/calendar"><Plus />添加病程事件</a>}</div>}
    </section>

    {creating && <Modal title="创建报销计划" onClose={() => setCreating(false)}>
      <div className="reimbursement-create-form">
        {eligibleEvents.length ? <>
          <ChoicePicker label="关联病程事件" options={eligibleEvents.map((event) => {
            const relatedCount = relatedEventsForReimbursement(event, events).length - 1
            return { value: event.id, label: event.title || EVENT_TYPES[event.type].label, description: `${event.startDate} · ${EVENT_TYPES[event.type].label}${event.hospital ? ` · ${event.hospital}` : ''}${relatedCount > 0 ? ` · 合并期间 ${relatedCount} 项` : ''}` }
          })} value={selectedEventId} onChange={(value) => setSelectedEventId(value as string)} />
          <ChoicePicker label="报销类型" options={reimbursementCoverageOptions} value={coverage} onChange={(value) => setCoverage(value as ReimbursementCoverage)} />
          {!REIMBURSEMENT_COVERAGES[coverage].claimable && <p className="callout warning">该类型会保留材料归档，但不会计入待报销状态。</p>}
          <div className="form-actions"><span className="spacer" /><button type="button" className="button primary" onClick={() => void createPlan()}><FilePlus2 />生成材料清单</button></div>
        </> : <div className="empty-state"><File /><h3>暂无可创建的病程事件</h3><p>请先在病程页添加门诊、住院、检查或治疗事件。</p><a className="button primary" href="#/calendar"><Plus />添加病程事件</a></div>}
      </div>
    </Modal>}

    {selectedPlan && <Modal title={selectedPlan.eventTitle} onClose={() => { setSelectedPlanId(null); setCustomMaterial('') }} wide>
      <div className="reimbursement-detail">
        <div className="reimbursement-detail-meta"><strong>{selectedPlan.eventDate}</strong><span>{selectedPlan.hospital || '医院未记录'}</span></div>
        <ChoicePicker label="报销类型" options={reimbursementCoverageOptions} value={selectedPlan.coverage} onChange={(value) => void updateCoverage(value as ReimbursementCoverage)} />
        {!REIMBURSEMENT_COVERAGES[selectedPlan.coverage].claimable && <div className="callout warning">已标记为“{REIMBURSEMENT_COVERAGES[selectedPlan.coverage].label}”：材料仍可整理和导出，但不作为可报销项目。</div>}
        <button type="button" className="button secondary reimbursement-rematch" onClick={() => void refreshExistingMaterials()}><RefreshCw />重新匹配检查素材</button>

        <div className="reimbursement-materials">
          {selectedPlan.materials.map((item) => <section className={`reimbursement-material${item.completed ? ' completed' : ''}`} key={item.id}>
            <label className="material-check">
              <input type="checkbox" checked={item.completed} onChange={(event) => void updatePlan({ ...selectedPlan, materials: selectedPlan.materials.map((candidate) => candidate.id === item.id ? { ...candidate, completed: event.target.checked } : candidate) })} />
              <span className="material-check-mark"><Check /></span>
              <span><strong>{item.label}</strong><small>{item.required ? '必需材料' : '按需提供'} · {item.attachments.length} 个文件</small></span>
            </label>
            {item.attachments.length > 0 && <div className="material-attachments">{item.attachments.map((attachment) => {
              const attachmentSource = storedImageSource(attachment)
              const imageSource = attachment.mimeType.startsWith('image/') ? storedImageSource(attachment) : ''
              const isPdf = attachment.mimeType === 'application/pdf' || /\.pdf$/i.test(attachment.name)
              return <SwipeableListItem
                itemId={attachment.id}
                label={attachment.name}
                className="material-attachment-row"
                surfaceClassName="material-attachment"
                actions={[{
                  id: 'remove',
                  label: '移除',
                  accessibilityLabel: `移除附件：${attachment.name}`,
                  icon: <Trash2 />,
                  tone: 'danger',
                  onSelect: () => void updatePlan({
                    ...selectedPlan,
                    materials: selectedPlan.materials.map((candidate) => candidate.id === item.id ? {
                      ...candidate,
                      attachments: candidate.attachments.filter((known) => known.id !== attachment.id),
                      completed: candidate.attachments.length > 1 ? candidate.completed : false,
                    } : candidate),
                  }),
                }]}
                key={attachment.id}
              >
                {imageSource
                  ? <ImagePreview src={imageSource} alt={`报销材料：${attachment.name}`} className="attachment-preview" />
                  : isPdf && attachmentSource
                    ? <PdfPreview src={attachmentSource} name={attachment.name} className="attachment-preview pdf-attachment-preview" />
                    : <span className="attachment-icon">{isPdf ? <File /> : <FileImage />}</span>}
                <span><strong title={attachment.name}>{attachment.name}</strong><small>{sourceLabel(attachment.source)}</small></span>
              </SwipeableListItem>
            })}</div>}
            <div className="material-actions">
              <button type="button" className="button secondary" disabled={uploading} onClick={() => { setUploadMaterialId(item.id); fileInputRef.current?.click() }}><FileInput />导入图片/PDF</button>
              <button type="button" className="button secondary" disabled={uploading} onClick={() => { setUploadMaterialId(item.id); cameraInputRef.current?.click() }}><Camera />拍照</button>
            </div>
          </section>)}
        </div>

        <div className="custom-material-row">
          <label>其他材料<input value={customMaterial} onChange={(event) => setCustomMaterial(event.target.value)} placeholder="例如：保险公司补件通知" /></label>
          <button type="button" className="button secondary" disabled={!customMaterial.trim()} onClick={() => {
            const label = customMaterial.trim()
            if (!label) return
            void updatePlan({ ...selectedPlan, materials: [...selectedPlan.materials, { id: newId(), kind: 'other', label, required: false, completed: false, attachments: [] }] })
            setCustomMaterial('')
          }}><Plus />添加</button>
        </div>
        <input ref={fileInputRef} className="sr-only" type="file" accept="image/*,application/pdf,.pdf" multiple onChange={(event) => { void addFiles(event.target.files, 'upload'); event.target.value = '' }} />
        <input ref={cameraInputRef} className="sr-only" type="file" accept="image/*" capture="environment" onChange={(event) => { void addFiles(event.target.files, 'camera'); event.target.value = '' }} />
      </div>
    </Modal>}

    {deletingPlanId && <ConfirmSheet
      title="删除报销计划"
      message="确定删除这个报销计划吗？"
      description="计划中的材料清单会被删除；仍被检查记录使用的原始图片会保留。"
      busy={false}
      error={deleteError}
      onCancel={() => { setDeletingPlanId(null); setDeleteError('') }}
      onConfirm={() => {
        void deleteReimbursementPlan(deletingPlanId)
          .then(() => { setDeletingPlanId(null); setDeleteError('') })
          .catch((error) => setDeleteError(error instanceof Error ? error.message : '删除失败'))
      }}
    />}
  </>
}
