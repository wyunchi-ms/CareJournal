import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractPdfText } from '../services/pdf'
import type { StoredImage } from '../types'

const pdfMock = vi.hoisted(() => ({
  getDocument: vi.fn(),
  destroyDocument: vi.fn(),
  destroyLoadingTask: vi.fn(),
}))

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: pdfMock.getDocument,
}))

const pdf: StoredImage = {
  id: 'pdf-1',
  name: '检查报告.pdf',
  mimeType: 'application/pdf',
  dataUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
  sha256: 'pdf-hash',
}

afterEach(() => {
  pdfMock.getDocument.mockReset()
  pdfMock.destroyDocument.mockReset()
  pdfMock.destroyLoadingTask.mockReset()
})

describe('extractPdfText', () => {
  it('extracts text page by page before the LLM request', async () => {
    pdfMock.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: vi.fn()
          .mockResolvedValueOnce({ getTextContent: vi.fn().mockResolvedValue({ items: [{ str: '血红蛋白', hasEOL: false }, { str: '132 g/L', hasEOL: true }] }) })
          .mockResolvedValueOnce({ getTextContent: vi.fn().mockResolvedValue({ items: [{ str: '参考范围 120-160 g/L', hasEOL: true }] }) }),
        destroy: pdfMock.destroyDocument,
      }),
      destroy: pdfMock.destroyLoadingTask,
    })

    await expect(extractPdfText(pdf)).resolves.toEqual({
      text: '【第 1 页】\n血红蛋白 132 g/L\n\n【第 2 页】\n参考范围 120-160 g/L',
      pageCount: 2,
      truncated: false,
    })
  })

  it('explains how to handle scanned PDFs without a text layer', async () => {
    pdfMock.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue({ getTextContent: vi.fn().mockResolvedValue({ items: [] }) }),
        destroy: pdfMock.destroyDocument,
      }),
      destroy: pdfMock.destroyLoadingTask,
    })

    await expect(extractPdfText(pdf)).rejects.toThrow('可能是扫描版')
  })
})
