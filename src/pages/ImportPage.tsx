import { AlertCircle, Camera, CheckCircle2, Clock3, FileImage, RefreshCw, Trash2, UploadCloud, XCircle } from 'lucide-react'
import { useRef, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { ImagePreview } from '../components/ImagePreview'
import { prepareImage } from '../services/images'
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
  recognizing: 'AI 识别中',
  saving: '写入本地数据库',
  done: '识别完成',
  error: '识别失败',
}

function QueueRow({ job }: { job: OcrQueueItem }) {
  const { retryOcrJob, removeOcrJob } = useApp()
  return (
    <article className={`ocr-job ${job.status}`}>
      <ImagePreview src={job.image.dataUrl} alt={`待识别检查报告：${job.image.name}`} className="ocr-job-image" />
      <div className="ocr-job-body">
        <div className="ocr-job-heading">
          <strong title={job.image.name}>{job.image.name}</strong>
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
      <div className="ocr-job-actions">
        {job.status === 'failed' && <button className="icon-button" aria-label={`重试 ${job.image.name}`} title="重试" onClick={() => void retryOcrJob(job.id)}><RefreshCw /></button>}
        {job.status !== 'processing' && <button className="icon-button" aria-label={`移除 ${job.image.name}`} title="从队列移除" onClick={() => void removeOcrJob(job.id)}><Trash2 /></button>}
      </div>
    </article>
  )
}

export function ImportPage() {
  const {
    preferences,
    ocrJobs,
    ocrQueueStats,
    enqueueOcrImage,
    retryAllFailedOcrJobs,
    clearCompletedOcrJobs,
  } = useApp()
  const inputRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const [preparing, setPreparing] = useState<PreparationProgress | null>(null)
  const [message, setMessage] = useState('')
  const azureConfigured = Boolean(preferences.azure.endpoint && preferences.azure.apiKey && preferences.azure.deployment && preferences.azure.apiVersion)
  const activeCount = ocrQueueStats.queued + ocrQueueStats.processing

  async function selectFiles(files: FileList | null) {
    if (!files?.length) return
    const selected = Array.from(files)
    const progress: PreparationProgress = { done: 0, total: selected.length, added: 0, skipped: 0, failed: 0 }
    setPreparing({ ...progress })
    setMessage('正在逐张压缩、校验并加入后台队列…')

    for (const file of selected) {
      try {
        const image = await prepareImage(file)
        const added = await enqueueOcrImage(image)
        if (added) progress.added += 1
        else progress.skipped += 1
      } catch {
        progress.failed += 1
      } finally {
        progress.done += 1
        setPreparing({ ...progress })
      }
    }

    setMessage(`已加入 ${progress.added} 个文件${progress.skipped ? `，跳过 ${progress.skipped} 个重复文件` : ''}${progress.failed ? `，${progress.failed} 个文件读取失败` : ''}。队列将在后台继续处理。`)
    setPreparing(null)
  }

  return (
    <>
      <PageHeader
        eyebrow="AI 结构化录入"
        title="导入检查报告"
        description="文件数量不限；每张图片使用一个独立请求，单张失败不会阻塞后续文件。"
        actions={<button className="button primary" disabled={Boolean(preparing)} onClick={() => inputRef.current?.click()}><UploadCloud />选择报告图片</button>}
      />
      <div className="import-layout">
        <section className="upload-card card">
          <input ref={inputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { void selectFiles(event.target.files); event.target.value = '' }} />
          <input ref={cameraRef} className="sr-only" type="file" accept="image/*" capture="environment" onChange={(event) => { void selectFiles(event.target.files); event.target.value = '' }} />
          <button className="drop-zone" disabled={Boolean(preparing)} onClick={() => inputRef.current?.click()}>
            <UploadCloud />
            <strong>拍照或选择任意数量的报告图片</strong>
            <span>支持 JPEG、PNG、WEBP；按本机可用存储空间保存</span>
          </button>
          <div className="source-actions">
            <button className="button secondary" disabled={Boolean(preparing)} onClick={() => cameraRef.current?.click()}><Camera />拍照导入</button>
            <button className="button secondary" disabled={Boolean(preparing)} onClick={() => inputRef.current?.click()}><FileImage />从相册或文件选择</button>
          </div>

          {preparing && <div className="preparation-progress" role="status">
            <div><span className="spinner" /><strong>正在准备文件 {preparing.done}/{preparing.total}</strong><span>{Math.round(preparing.done / preparing.total * 100)}%</span></div>
            <progress max={preparing.total} value={preparing.done} aria-label="文件准备进度" />
          </div>}
          {message && <div className="status-message" role="status"><FileImage /><span>{message}</span></div>}
          {!azureConfigured && activeCount > 0 && <div className="callout warning" role="alert"><AlertCircle /><span>文件已安全加入本地队列。请完成 Azure OpenAI 配置，队列会自动开始。</span></div>}

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
              {ocrQueueStats.completed > 0 && <button className="button secondary" onClick={() => void clearCompletedOcrJobs()}><Trash2 />清除已完成项</button>}
            </div>
          </section>}

          <div className="ocr-job-list" aria-live="polite">
            {ocrJobs.map((job) => <QueueRow key={job.id} job={job} />)}
          </div>
          {ocrJobs.length === 0 && !preparing && <div className="empty-queue"><FileImage /><h2>还没有识别任务</h2><p>选择图片后会立即加入持久化队列，可以切换到其他页面继续使用应用。</p></div>}
        </section>

        <aside className="privacy-card card">
          <h2>后台识别说明</h2>
          <ol className="step-list">
            <li><span>1</span><div><strong>逐文件请求</strong><p>每张图片独立识别、独立重试和独立入库。</p></div></li>
            <li><span>2</span><div><strong>持久化队列</strong><p>切换页面不打断；刷新或重启后从未完成项继续。</p></div></li>
            <li><span>3</span><div><strong>自动去重</strong><p>完全相同的图片不会重复进入队列。</p></div></li>
            <li><span>4</span><div><strong>本地入库</strong><p>成功后自动保存检查记录并创建日历事件。</p></div></li>
          </ol>
          <div className="callout"><FileImage /><span>AI 仅用于内容提取，不提供诊断、建议或预测。</span></div>
          <p className="background-note">“后台”指离开本页面后继续运行。若系统终止应用或浏览器标签页，未完成任务会在下次打开时自动续跑。</p>
        </aside>
      </div>
    </>
  )
}
