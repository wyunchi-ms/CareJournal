import { AlertCircle, Camera, CheckCircle2, Clock3, FileImage, FileText, FolderOpen, RefreshCw, Settings2, Trash2, XCircle } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { ImagePreview } from '../components/ImagePreview'
import { PdfPreview } from '../components/PdfPreview'
import { SwipeableListItem } from '../components/SwipeableListItem'
import { canImportAndroidFolder, folderSourceToStoredImage, pickAndroidImageFolder } from '../services/folderImport'
import { isLlmConfigured } from '../services/llmProviders'
import { prepareImage, preparePdf } from '../services/images'
import { storedImageSource } from '../services/imageStorage'
import { useApp } from '../store/AppContext'
import type { OcrQueueItem } from '../types'

interface PreparationProgress {
  done: number
  total: number
  added: number
  skipped: number
  failed: number
}

const phaseLabel: Record<OcrQueueItem['phase'], string> = {
  waiting: '排队等待',
  extracting: '提取 PDF 文字',
  redacting: 'PaddleOCR 本地脱敏',
  recognizing: 'AI 识别中',
  saving: '写入本地数据库',
  done: '识别完成',
  error: '识别失败',
}

const directoryInputAttributes = { webkitdirectory: '', directory: '' }

function isImageFile(file: File) {
  return file.type.startsWith('image/') || /\.(?:jpe?g|png|webp)$/i.test(file.name)
}

function isPdfFile(file: File) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

function QueueRow({
  job,
  editMode,
  selected,
  onToggle,
  onEnterEdit,
  onRemove,
}: {
  job: OcrQueueItem
  editMode: boolean
  selected: boolean
  onToggle: () => void
  onEnterEdit: () => void
  onRemove: () => void
}) {
  const { retryOcrJob } = useApp()
  const previewSource = storedImageSource(job.image)
  const isPdf = job.image.mimeType === 'application/pdf' || /\.pdf$/i.test(job.image.name)
  return (
    <SwipeableListItem
      itemId={job.id}
      label={job.image.name}
      className={`ocr-job-row ${job.status}`}
      surfaceClassName={`ocr-job ${job.status}${editMode ? ' editing' : ''}`}
      editMode={editMode}
      onLongPress={job.status === 'processing' ? undefined : onEnterEdit}
      actions={[
        ...(job.status === 'failed' ? [{
          id: 'retry',
          label: '重试',
          accessibilityLabel: `重试 ${job.image.name}`,
          icon: <RefreshCw />,
          tone: 'primary' as const,
          onSelect: () => void retryOcrJob(job.id),
        }] : []),
        ...(job.status !== 'processing' ? [{
          id: 'remove',
          label: '移除',
          accessibilityLabel: `移除 ${job.image.name}`,
          icon: <Trash2 />,
          tone: 'danger' as const,
          onSelect: onRemove,
        }] : []),
      ]}
    >
      {editMode && <label className="ocr-job-select" aria-label={`选择 ${job.image.name}`}>
        <input type="checkbox" checked={selected} disabled={job.status === 'processing'} onChange={onToggle} />
      </label>}
      {previewSource && !isPdf
        ? <ImagePreview src={previewSource} alt={`待识别检查报告：${job.image.name}`} className="ocr-job-image" />
        : previewSource && isPdf
          ? <PdfPreview src={previewSource} name={job.image.name} className="ocr-job-image ocr-job-placeholder pdf" />
          : <div className={`ocr-job-image ocr-job-placeholder${isPdf ? ' pdf' : ''}`} aria-hidden="true">{isPdf ? <FileText /> : <FolderOpen />}</div>}
      <div className="ocr-job-body">
        <div className="ocr-job-heading">
          <span className="ocr-job-filename-wrap">
            <button
              type="button"
              className="ocr-job-filename"
              aria-label={`查看完整文件名：${job.image.name}`}
              aria-describedby={`ocr-filename-${job.id}`}
            >
              {job.image.name}
            </button>
            <span id={`ocr-filename-${job.id}`} className="ocr-job-filename-tooltip" role="tooltip">
              {job.image.name}
            </span>
          </span>
          <span className={`job-status ${job.status}`}>
            {job.status === 'processing' && <span className="spinner" />}
            {job.status === 'completed' && <CheckCircle2 />}
            {job.status === 'failed' && <XCircle />}
            {job.status === 'queued' && <Clock3 />}
            {phaseLabel[job.phase]}
          </span>
        </div>
        <div className="job-progress-line">
          <progress max="100" value={job.progress} aria-label={`${job.image.name} 处理进度`} />
          <span>{job.progress}%</span>
        </div>
        <small>
          {job.status === 'queued' ? '等待前面的文件完成' : job.attempts > 0 ? `已请求 ${job.attempts} 次` : '准备中'}
          {job.status === 'completed' && job.resultRecordIds.length > 0 ? ` · 写入 ${job.resultRecordIds.length} 份记录` : ''}
        </small>
        {job.error && <p className="job-error" role="alert">{job.error}</p>}
      </div>
    </SwipeableListItem>
  )
}

export function ImportPage() {
  const {
    preferences,
    ocrJobs,
    ocrQueueStats,
    enqueueOcrImage,
    retryAllFailedOcrJobs,
    removeOcrJob,
  } = useApp()
  const inputRef = useRef<HTMLInputElement>(null)
  const directoryRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const showWebDirectoryImport = !Capacitor.isNativePlatform()
  const showAndroidDirectoryImport = canImportAndroidFolder()
  const [preparing, setPreparing] = useState<PreparationProgress | null>(null)
  const [scanning, setScanning] = useState(false)
  const [message, setMessage] = useState('')
  const [queueEditMode, setQueueEditMode] = useState(false)
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([])
  const [deletingJobIds, setDeletingJobIds] = useState<string[]>([])
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const llmConfigured = isLlmConfigured(preferences.llm)
  const activeCount = ocrQueueStats.queued + ocrQueueStats.processing
  const busy = scanning || Boolean(preparing)
  const removableJobIds = ocrJobs.filter((job) => job.status !== 'processing').map((job) => job.id)
  const allRemovableSelected = removableJobIds.length > 0 && removableJobIds.every((id) => selectedJobIds.includes(id))

  function enterQueueEditMode(id: string) {
    setQueueEditMode(true)
    setSelectedJobIds((current) => current.includes(id) ? current : [...current, id])
  }

  function exitQueueEditMode() {
    setQueueEditMode(false)
    setSelectedJobIds([])
  }

  async function confirmRemoveJobs() {
    setDeleteBusy(true)
    setDeleteError('')
    try {
      for (const id of deletingJobIds) await removeOcrJob(id)
      setDeletingJobIds([])
      exitQueueEditMode()
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : '移除任务失败，请重试')
    } finally {
      setDeleteBusy(false)
    }
  }

  async function selectFiles(files: FileList | null) {
    if (!files?.length) return
    const allFiles = Array.from(files)
    const selected = allFiles.filter((file) => isImageFile(file) || isPdfFile(file))
    const ignored = allFiles.length - selected.length
    if (!selected.length) {
      setMessage('所选位置中没有可导入的图片或 PDF。')
      return
    }
    const progress: PreparationProgress = { done: 0, total: selected.length, added: 0, skipped: 0, failed: 0 }
    setPreparing({ ...progress })
    setMessage('正在读取、校验并加入后台队列…')

    for (const file of selected) {
      try {
        const report = isPdfFile(file) ? await preparePdf(file) : await prepareImage(file)
        const added = await enqueueOcrImage(report)
        if (added) progress.added += 1
        else progress.skipped += 1
      } catch {
        progress.failed += 1
      } finally {
        progress.done += 1
        setPreparing({ ...progress })
      }
    }

    setMessage(`已加入 ${progress.added} 个文件${progress.skipped ? `，跳过 ${progress.skipped} 个重复文件` : ''}${ignored ? `，忽略 ${ignored} 个不支持的文件` : ''}${progress.failed ? `，${progress.failed} 个文件读取失败` : ''}。队列将在后台继续处理。`)
    setPreparing(null)
  }

  async function selectAndroidFolder() {
    setScanning(true)
    setMessage('正在扫描文件夹及子文件夹…')
    try {
      const result = await pickAndroidImageFolder()
      if (result.cancelled) {
        setMessage('已取消选择文件夹。')
        return
      }
      if (!result.files.length) {
        const folder = result.folderName ? `“${result.folderName}”` : '文件夹'
        setMessage(`${folder}及其子文件夹中没有可导入的图片。`)
        return
      }
      const progress: PreparationProgress = { done: 0, total: result.files.length, added: 0, skipped: 0, failed: 0 }
      setPreparing({ ...progress })
      for (const source of result.files) {
        try {
          const added = await enqueueOcrImage(folderSourceToStoredImage(source))
          if (added) progress.added += 1
          else progress.skipped += 1
        } catch {
          progress.failed += 1
        } finally {
          progress.done += 1
          setPreparing({ ...progress })
        }
      }
      const folder = result.folderName ? `“${result.folderName}”` : '文件夹'
      setMessage(`${folder}扫描到 ${result.files.length} 张图片，已加入 ${progress.added} 张${progress.skipped ? `，跳过 ${progress.skipped} 张已导入或已排队图片` : ''}${progress.failed ? `，${progress.failed} 张加入失败` : ''}。队列将在后台逐张读取和识别。`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '文件夹扫描失败，请重试。')
    } finally {
      setPreparing(null)
      setScanning(false)
    }
  }

  return (
    <>
      <div className="import-layout">
        <section className="upload-card card">
          <input ref={inputRef} className="sr-only" type="file" accept="image/*,application/pdf,.pdf" multiple onChange={(event) => { void selectFiles(event.target.files); event.target.value = '' }} />
          {showWebDirectoryImport && <input ref={directoryRef} className="sr-only" type="file" accept="image/*" multiple {...directoryInputAttributes} onChange={(event) => { void selectFiles(event.target.files); event.target.value = '' }} />}
          <input ref={cameraRef} className="sr-only" type="file" accept="image/*" capture="environment" onChange={(event) => { void selectFiles(event.target.files); event.target.value = '' }} />
          <div className="source-actions" aria-label="导入方式">
            <button className="button secondary" disabled={busy} onClick={() => cameraRef.current?.click()}><Camera />拍照导入</button>
            <button className="button secondary" disabled={busy} onClick={() => inputRef.current?.click()}><FileText />选择图片/PDF</button>
            {showWebDirectoryImport && <button className="button secondary" disabled={busy} onClick={() => directoryRef.current?.click()}><FolderOpen />导入文件夹</button>}
            {showAndroidDirectoryImport && <button className="button secondary" disabled={busy} onClick={() => void selectAndroidFolder()}><FolderOpen />扫描文件夹</button>}
          </div>

          {!llmConfigured && <div className="llm-setup-callout callout warning" role="alert">
            <AlertCircle />
            <span><strong>识别检查报告前需要配置 LLM</strong><small>你可以先加入图片或 PDF，文件会保存在本地队列，配置完成后自动开始处理。</small></span>
            <Link className="button secondary" to="/settings#llm-settings"><Settings2 />去配置 LLM</Link>
          </div>}

          {scanning && !preparing && <div className="preparation-progress" role="status"><div><span className="spinner" /><strong>正在扫描文件夹及子文件夹</strong></div></div>}

          {preparing && <div className="preparation-progress" role="status">
            <div><span className="spinner" /><strong>正在准备文件 {preparing.done}/{preparing.total}</strong><span>{Math.round(preparing.done / preparing.total * 100)}%</span></div>
            <progress max={preparing.total} value={preparing.done} aria-label="文件准备进度" />
          </div>}
          {message && <div className="status-message" role="status"><FileImage /><span>{message}</span></div>}
          {ocrQueueStats.total > 0 && <section className="queue-summary" aria-label="OCR 总体进度">
            <div className="section-heading">
              <div><p className="eyebrow">后台队列</p><h2>{activeCount > 0 ? `正在处理 ${ocrQueueStats.completed + ocrQueueStats.failed + 1}/${ocrQueueStats.total}` : '队列处理结果'}</h2></div>
              <strong>{ocrQueueStats.progress}%</strong>
            </div>
            <progress max="100" value={ocrQueueStats.progress} />
            <div className="queue-counts">
              <span><i className="queued" />等待 {ocrQueueStats.queued}</span>
              <span><i className="processing" />处理中 {ocrQueueStats.processing}</span>
              <span><i className="completed" />完成 {ocrQueueStats.completed}</span>
              <span><i className="failed" />失败 {ocrQueueStats.failed}</span>
            </div>
            <div className="queue-actions">
              {ocrQueueStats.failed > 0 && <button className="button secondary" onClick={() => void retryAllFailedOcrJobs()}><RefreshCw />重试全部失败项</button>}
            </div>
          </section>}

          {queueEditMode && <div className="list-edit-toolbar" aria-label="批量管理识别任务">
            <label className="selection-control">
              <input type="checkbox" checked={allRemovableSelected} onChange={(event) => setSelectedJobIds(event.target.checked ? removableJobIds : [])} />
              <span>全选</span>
            </label>
            <span>已选 {selectedJobIds.length} 项</span>
            <button type="button" className="button danger ghost" disabled={!selectedJobIds.length} onClick={() => setDeletingJobIds(selectedJobIds)}><Trash2 />移除</button>
            <button type="button" className="text-button" onClick={exitQueueEditMode}>完成</button>
          </div>}
          <div className="ocr-job-list" aria-live="polite">
            {ocrJobs.map((job) => <QueueRow
              key={job.id}
              job={job}
              editMode={queueEditMode}
              selected={selectedJobIds.includes(job.id)}
              onToggle={() => setSelectedJobIds((current) => current.includes(job.id) ? current.filter((id) => id !== job.id) : [...current, job.id])}
              onEnterEdit={() => enterQueueEditMode(job.id)}
              onRemove={() => setDeletingJobIds([job.id])}
            />)}
          </div>
          {ocrJobs.length === 0 && !preparing && <div className="empty-queue"><FileImage /><h2>还没有识别任务</h2><p>从上方拍照、选择图片或 PDF，文件会按顺序加入后台识别队列。</p></div>}
        </section>
      </div>
      {deletingJobIds.length > 0 && <ConfirmSheet
        title={deletingJobIds.length > 1 ? '批量移除识别任务' : '移除识别任务'}
        message={`确定移除选中的 ${deletingJobIds.length} 个任务吗？`}
        description="正在处理的任务不会进入可选范围；已写入的检查记录不会被删除。"
        busy={deleteBusy}
        error={deleteError}
        onCancel={() => { setDeletingJobIds([]); setDeleteError('') }}
        onConfirm={() => void confirmRemoveJobs()}
      />}
    </>
  )
}
