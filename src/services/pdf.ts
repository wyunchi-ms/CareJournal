import type { StoredImage } from '../types'

const MAX_PDF_BYTES = 30 * 1024 * 1024
const MAX_EXTRACTED_CHARACTERS = 80_000
const PDF_WORKER_URL = new URL('../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).href

export interface ExtractedPdfText {
  text: string
  pageCount: number
  truncated: boolean
}

function dataUrlBytes(dataUrl: string) {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new Error('PDF 文件内容无效，请重新选择')
  const metadata = dataUrl.slice(0, comma)
  const payload = dataUrl.slice(comma + 1)
  if (!/;base64$/i.test(metadata)) throw new Error('PDF 文件编码不受支持，请重新选择')
  const binary = atob(payload)
  if (binary.length > MAX_PDF_BYTES) throw new Error('单个 PDF 不能超过 30 MB')
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export async function createPdfLoadingTask(source: string) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL
  return pdfjs.getDocument(source.startsWith('data:')
    ? { data: dataUrlBytes(source), useSystemFonts: true }
    : { url: source, useSystemFonts: true })
}

function textItemsToString(items: Array<{ str?: string; hasEOL?: boolean }>) {
  let text = ''
  for (const item of items) {
    const value = item.str?.trim()
    if (value) text += `${text && !text.endsWith('\n') ? ' ' : ''}${value}`
    if (item.hasEOL) text += '\n'
  }
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export async function extractPdfText(pdf: StoredImage): Promise<ExtractedPdfText> {
  if (pdf.mimeType !== 'application/pdf' && !/\.pdf$/i.test(pdf.name)) {
    throw new Error('所选文件不是 PDF')
  }
  if (!pdf.dataUrl) throw new Error('PDF 内容不可用，请重新选择原文件')

  const loadingTask = await createPdfLoadingTask(pdf.dataUrl)

  let document: Awaited<typeof loadingTask.promise> | undefined
  try {
    document = await loadingTask.promise
    const pages: string[] = []
    let characterCount = 0
    let truncated = false
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const pageText = textItemsToString(content.items as Array<{ str?: string; hasEOL?: boolean }>)
      if (!pageText) continue
      const prefix = `【第 ${pageNumber} 页】\n`
      const remaining = MAX_EXTRACTED_CHARACTERS - characterCount - prefix.length
      if (remaining <= 0) {
        truncated = true
        break
      }
      pages.push(`${prefix}${pageText.slice(0, remaining)}`)
      characterCount += prefix.length + Math.min(pageText.length, remaining)
      if (pageText.length > remaining) {
        truncated = true
        break
      }
    }
    const text = pages.join('\n\n').trim()
    if (!text) {
      throw new Error('这个 PDF 没有可提取的文字，可能是扫描版。请将页面导出为图片后再导入。')
    }
    return { text, pageCount: document.numPages, truncated }
  } finally {
    await loadingTask.destroy()
  }
}
