import { ChevronLeft, ChevronRight, FileText, Maximize2, Minus, Plus, RotateCcw, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist/types/src/display/api'
import { createPdfLoadingTask } from '../services/pdf'
import { isTopModal, registerModal, unregisterModal } from './modalStack'

const MIN_ZOOM = .75
const MAX_ZOOM = 2.5
const ZOOM_STEP = .25

interface PdfPreviewProps {
  src: string
  name: string
  className?: string
  description?: string
}

export function PdfPreview({ src, name, className = '', description }: PdfPreviewProps) {
  const [open, setOpen] = useState(false)
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [renderVersion, setRenderVersion] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const stackId = useRef(Symbol('pdf-preview'))

  const close = useCallback(() => {
    setOpen(false)
    setPdfDocument(null)
    setPageNumber(1)
    setZoom(1)
    setLoading(false)
    setError('')
  }, [])

  const openPreview = () => {
    setLoading(true)
    setError('')
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const id = stackId.current
    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopModal(id)) return
      if (event.key === 'Escape') close()
      if (event.key === 'ArrowLeft') setPageNumber((current) => Math.max(1, current - 1))
      if (event.key === 'ArrowRight') setPageNumber((current) => Math.min(pdfDocument?.numPages ?? 1, current + 1))
    }
    const handleResize = () => setRenderVersion((current) => current + 1)
    registerModal(id, close)
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', handleResize)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', handleResize)
      unregisterModal(id)
    }
  }, [close, open, pdfDocument?.numPages])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    let loadingTask: Awaited<ReturnType<typeof createPdfLoadingTask>> | null = null
    void createPdfLoadingTask(src)
      .then((task) => {
        loadingTask = task
        return task.promise
      })
      .then((pdfDocument) => {
        if (cancelled) return
        setPdfDocument(pdfDocument)
        setPageNumber(1)
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'PDF 加载失败，请重试')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      if (loadingTask) void loadingTask.destroy()
    }
  }, [open, src])

  useEffect(() => {
    if (!open || !pdfDocument) return
    let cancelled = false
    let renderTask: RenderTask | null = null
    void pdfDocument.getPage(pageNumber).then((page) => {
      if (cancelled) return
      const canvas = canvasRef.current
      const stage = stageRef.current
      const context = canvas?.getContext('2d')
      if (!canvas || !stage || !context) throw new Error('当前设备无法显示 PDF')

      const initialViewport = page.getViewport({ scale: 1 })
      const availableWidth = Math.max(1, stage.clientWidth - 24)
      const availableHeight = Math.max(1, stage.clientHeight - 24)
      const fitScale = Math.min(availableWidth / initialViewport.width, availableHeight / initialViewport.height)
      const viewport = page.getViewport({ scale: fitScale * zoom })
      const pixelRatio = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.max(1, Math.floor(viewport.width * pixelRatio))
      canvas.height = Math.max(1, Math.floor(viewport.height * pixelRatio))
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`
      renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
      })
      return renderTask.promise
    }).catch((renderError) => {
      if (cancelled || renderError instanceof Error && renderError.name === 'RenderingCancelledException') return
      setError(renderError instanceof Error ? renderError.message : 'PDF 页面渲染失败')
    })
    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [open, pageNumber, pdfDocument, renderVersion, zoom])

  const changeZoom = (nextZoom: number) => setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom)))
  const previousPage = () => setPageNumber((current) => Math.max(1, current - 1))
  const nextPage = () => setPageNumber((current) => Math.min(pdfDocument?.numPages ?? 1, current + 1))

  return <>
    <button type="button" className={`pdf-preview-trigger ${className}`.trim()} onClick={openPreview} aria-label={`预览 PDF：${name}`}>
      <FileText />
      {description && <span><strong>{name}</strong><small>{description}</small></span>}
      <span className="pdf-thumbnail-hint" aria-hidden="true"><Maximize2 /></span>
    </button>
    {open && createPortal(<div className="pdf-preview-backdrop" role="dialog" aria-modal="true" aria-label="PDF 预览" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
      <div className="pdf-preview-toolbar">
        <strong title={name}>{name}</strong>
        <div>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" className="icon-button" disabled={zoom <= MIN_ZOOM} onClick={() => changeZoom(zoom - ZOOM_STEP)} aria-label="缩小 PDF" title="缩小 PDF"><Minus /></button>
          <button type="button" className="icon-button" disabled={zoom >= MAX_ZOOM} onClick={() => changeZoom(zoom + ZOOM_STEP)} aria-label="放大 PDF" title="放大 PDF"><Plus /></button>
          <button type="button" className="icon-button" onClick={() => setZoom(1)} aria-label="恢复适合窗口" title="恢复适合窗口"><RotateCcw /></button>
          <button type="button" className="icon-button" onClick={close} aria-label="关闭 PDF 预览" title="关闭 PDF 预览"><X /></button>
        </div>
      </div>
      <div ref={stageRef} className="pdf-preview-stage">
        {loading && <span className="pdf-preview-status"><span className="spinner" />正在加载 PDF…</span>}
        {error && <span className="pdf-preview-status error" role="alert">{error}</span>}
        <canvas ref={canvasRef} hidden={!pdfDocument || Boolean(error)} aria-label={`${name} 第 ${pageNumber} 页`} />
      </div>
      <div className="pdf-preview-pagination">
        <button type="button" className="icon-button" disabled={pageNumber <= 1 || loading} onClick={previousPage} aria-label="上一页" title="上一页"><ChevronLeft /></button>
        <span>第 {pageNumber} / {pdfDocument?.numPages ?? '—'} 页</span>
        <button type="button" className="icon-button" disabled={!pdfDocument || pageNumber >= pdfDocument.numPages || loading} onClick={nextPage} aria-label="下一页" title="下一页"><ChevronRight /></button>
      </div>
    </div>, document.body)}
  </>
}
