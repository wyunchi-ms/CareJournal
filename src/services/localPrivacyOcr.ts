import type { StoredImage } from '../types'
import { extractPdfText, renderPdfPagesForLocalOcr } from './pdf'

interface LocalPaddleOcr {
  predict(input: unknown, params?: unknown): Promise<Array<{ items: Array<{ text: string; score: number }> }>>
}

export interface PrivacySafeText {
  text: string
  redactedFields: number
  source: 'paddle-ocr' | 'pdf-text'
}

let paddleOcrPromise: Promise<LocalPaddleOcr> | undefined

function paddleAssetUrl(name: string) {
  return new URL(`paddleocr/${name}`, document.baseURI).toString()
}

async function getPaddleOcr(): Promise<LocalPaddleOcr> {
  if (!paddleOcrPromise) {
    paddleOcrPromise = import('@paddleocr/paddleocr-js')
      .then(({ PaddleOCR }) => PaddleOCR.create({
        worker: true,
        textDetectionModelName: 'PP-OCRv5_mobile_det',
        textDetectionModelAsset: { url: paddleAssetUrl('PP-OCRv5_mobile_det_onnx_infer.tar') },
        textRecognitionModelName: 'PP-OCRv5_mobile_rec',
        textRecognitionModelAsset: { url: paddleAssetUrl('PP-OCRv5_mobile_rec_onnx_infer.tar') },
        textDetectionBatchSize: 1,
        textRecognitionBatchSize: 6,
        ortOptions: {
          backend: 'wasm',
          wasmPaths: paddleAssetUrl(''),
          numThreads: 1,
          simd: true,
        },
      }))
      .catch((error) => {
        paddleOcrPromise = undefined
        throw new Error(`本地 PaddleOCR 模型加载失败：${error instanceof Error ? error.message : '请重试'}`)
      })
  }
  return paddleOcrPromise
}

function dataUrlToBlob(dataUrl: string) {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new Error('图片内容无效，请重新导入')
  const metadata = dataUrl.slice(0, comma)
  const payload = dataUrl.slice(comma + 1)
  const mimeType = metadata.match(/^data:([^;,]+)/i)?.[1] || 'image/jpeg'
  if (/;base64$/i.test(metadata)) {
    const binary = atob(payload)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return new Blob([bytes], { type: mimeType })
  }
  return new Blob([decodeURIComponent(payload)], { type: mimeType })
}

const labeledSensitivePatterns: RegExp[] = [
  /((?:患者|病人)?姓\s*名)\s*[:：]?\s*([^\s|，,；;]{2,12})/gi,
  /((?:病案|病历|住院|门诊|就诊卡?|医保|患者|病人)(?:编?号|ID)|身份证(?:号|号码)?|证件号码)\s*[:：]?\s*([A-Z0-9-]{3,40})/gi,
  /((?:患者|病人)?(?:手机(?:号码)?|联系电话|联系手机|电话号码|电话))\s*[:：]?\s*((?:\+?86[-\s]?)?1[3-9]\d{9}|0\d{2,3}[-\s]?\d{7,8})/gi,
  /((?:家庭住址|现住址|联系地址))\s*[:：]?\s*([^\n|；;]{4,80})/gi,
  /((?:患者|病人)?床\s*号)\s*[:：]?\s*([A-Z0-9-]{1,16})/gi,
]

const standaloneSensitivePatterns: RegExp[] = [
  /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g,
  /(?<![A-Z0-9])\d{17}[\dX](?![A-Z0-9])/gi,
]

export function redactSensitiveText(rawText: string) {
  let text = rawText.replace(/\r\n?/g, '\n')
  let redactedFields = 0
  for (const pattern of labeledSensitivePatterns) {
    text = text.replace(pattern, (_match, label: string) => {
      redactedFields += 1
      return `${label}：[已脱敏]`
    })
  }
  for (const pattern of standaloneSensitivePatterns) {
    text = text.replace(pattern, () => {
      redactedFields += 1
      return '[已脱敏]'
    })
  }
  return {
    text: text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
    redactedFields,
  }
}

async function paddleTextFromInputs(inputs: Blob[]) {
  const ocr = await getPaddleOcr()
  const pages: string[] = []
  for (let index = 0; index < inputs.length; index += 1) {
    const [result] = await ocr.predict(inputs[index], { textRecScoreThresh: 0.35 })
    const text = result?.items
      .filter((item) => item.score >= 0.35 && item.text.trim())
      .map((item) => item.text.trim())
      .join('\n')
    if (text) pages.push(inputs.length > 1 ? `【第 ${index + 1} 页】\n${text}` : text)
  }
  return pages.join('\n\n').trim()
}

export async function extractPrivacySafeText(image: StoredImage): Promise<PrivacySafeText> {
  const isPdf = image.mimeType === 'application/pdf' || /\.pdf$/i.test(image.name)
  if (isPdf) {
    try {
      const extracted = await extractPdfText(image)
      const redacted = redactSensitiveText(extracted.text)
      return { ...redacted, source: 'pdf-text' }
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('可能是扫描版')) throw error
      const pageImages = await renderPdfPagesForLocalOcr(image)
      const text = await paddleTextFromInputs(pageImages)
      if (!text) throw new Error('本地 PaddleOCR 没有从扫描版 PDF 中识别到文字')
      return { ...redactSensitiveText(text), source: 'paddle-ocr' }
    }
  }

  if (!image.dataUrl) throw new Error('图片内容不可用，请重新导入')
  const text = await paddleTextFromInputs([dataUrlToBlob(image.dataUrl)])
  if (!text) throw new Error('本地 PaddleOCR 没有从图片中识别到文字')
  return { ...redactSensitiveText(text), source: 'paddle-ocr' }
}
