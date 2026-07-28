import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PdfPreview } from '../components/PdfPreview'

const pdfMock = vi.hoisted(() => ({
  createPdfLoadingTask: vi.fn(),
  destroy: vi.fn(async () => undefined),
  getPage: vi.fn(),
  render: vi.fn(),
  cancel: vi.fn(),
}))

vi.mock('../services/pdf', () => ({
  createPdfLoadingTask: pdfMock.createPdfLoadingTask,
}))

beforeEach(() => {
  pdfMock.cancel.mockReset()
  pdfMock.destroy.mockReset()
  pdfMock.getPage.mockReset()
  pdfMock.render.mockReset()
  pdfMock.createPdfLoadingTask.mockReset()
  pdfMock.render.mockReturnValue({ promise: Promise.resolve(), cancel: pdfMock.cancel })
  pdfMock.getPage.mockResolvedValue({
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render: pdfMock.render,
  })
  pdfMock.createPdfLoadingTask.mockResolvedValue({
    promise: Promise.resolve({ numPages: 2, getPage: pdfMock.getPage }),
    destroy: pdfMock.destroy,
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PDF preview', () => {
  it('opens in a body-level full-screen layer with paging and zoom controls', async () => {
    const { container } = render(<div className="swipeable-list-surface"><PdfPreview src="data:application/pdf;base64,JVBERi0xLjQ=" name="检查报告.pdf" /></div>)

    fireEvent.click(screen.getByRole('button', { name: '预览 PDF：检查报告.pdf' }))
    const dialog = screen.getByRole('dialog', { name: 'PDF 预览' })

    expect(dialog.parentElement).toBe(document.body)
    expect(container).not.toContainElement(dialog)
    await waitFor(() => expect(screen.getByText('第 1 / 2 页')).toBeInTheDocument())
    await waitFor(() => expect(pdfMock.render).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect(screen.getByText('第 2 / 2 页')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '放大 PDF' }))
    expect(screen.getByText('125%')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '关闭 PDF 预览' }))
    expect(screen.queryByRole('dialog', { name: 'PDF 预览' })).not.toBeInTheDocument()
  })
})
