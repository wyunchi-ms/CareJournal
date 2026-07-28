import { TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Modal } from './Modal'

interface ConfirmSheetProps {
  title: string
  message: string
  description?: ReactNode
  confirmLabel?: string
  busyLabel?: string
  busy?: boolean
  error?: string
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmSheet({
  title,
  message,
  description,
  confirmLabel = '确认删除',
  busyLabel = '删除中…',
  busy = false,
  error,
  onCancel,
  onConfirm,
}: ConfirmSheetProps) {
  return <Modal title={title} bottomSheet onClose={() => { if (!busy) onCancel() }}>
    <div className="confirm-sheet">
      <div className="confirm-sheet-warning">
        <span className="confirm-sheet-icon"><TriangleAlert /></span>
        <div>
          <strong>{message}</strong>
          {description && <p>{description}</p>}
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="confirm-sheet-actions">
        <button type="button" className="button secondary" autoFocus disabled={busy} onClick={onCancel}>取消</button>
        <button type="button" className="button danger confirm-delete" disabled={busy} onClick={onConfirm}>{busy ? busyLabel : confirmLabel}</button>
      </div>
    </div>
  </Modal>
}
