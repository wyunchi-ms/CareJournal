import { Maximize2, Minus, Plus, RotateCcw, X } from 'lucide-react'
import { useEffect, useState } from 'react'

export function ImagePreview({ src, alt, className = '' }: { src: string; alt: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', close)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', close)
    }
  }, [open])

  const close = () => { setOpen(false); setZoom(1) }
  const adjustZoom = (next: number) => setZoom(Math.min(4, Math.max(1, next)))

  return <>
    <button type="button" className={`image-thumbnail ${className}`.trim()} onClick={() => setOpen(true)} aria-label={`放大预览：${alt}`}>
      <img src={src} alt={alt} loading="lazy" />
      <span className="image-thumbnail-hint" aria-hidden="true"><Maximize2 /></span>
    </button>
    {open && <div className="image-preview-backdrop" role="dialog" aria-modal="true" aria-label="图片预览" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
      <div className="image-preview-toolbar">
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" className="icon-button" onClick={() => adjustZoom(zoom - .5)} disabled={zoom <= 1} aria-label="缩小图片"><Minus /></button>
        <button type="button" className="icon-button" onClick={() => adjustZoom(zoom + .5)} disabled={zoom >= 4} aria-label="放大图片"><Plus /></button>
        <button type="button" className="icon-button" onClick={() => setZoom(1)} aria-label="恢复原始缩放"><RotateCcw /></button>
        <button type="button" className="icon-button" onClick={close} aria-label="关闭图片预览"><X /></button>
      </div>
      <div className="image-preview-stage">
        <img src={src} alt={alt} style={{ transform: `scale(${zoom})` }} onClick={() => adjustZoom(zoom === 1 ? 2 : 1)} />
      </div>
      <p>点击图片可在 100% 与 200% 间切换</p>
    </div>}
  </>
}
