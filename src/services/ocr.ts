import { z } from 'zod'
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { normalizeIndicator } from '../data/indicatorAliases'
import { normalizeReportType } from '../data/reportTypeAliases'
import type { AzureSettings, ExamRecord, TreatmentEvent, StoredImage, EventType } from '../types'
import { newId } from '../types'
import { sha256 } from './images'

const nullableNumber = z.number().nullable()
const aiIndicatorSchema = z.object({
  rawName: z.string(),
  normalizedCode: z.string(),
  normalizedName: z.string(),
  value: nullableNumber,
  rawValue: z.string(),
  unit: z.string(),
  referenceLow: nullableNumber,
  referenceHigh: nullableNumber,
  referenceText: z.string(),
  abnormalFlag: z.enum(['high', 'low', 'critical', 'normal', 'unknown']),
})

const aiRecordSchema = z.object({
  reportType: z.string(),
  examDate: z.string(),
  reportDate: z.string(),
  hospital: z.string(),
  department: z.string(),
  summary: z.string(),
  indicators: z.array(aiIndicatorSchema),
})

const aiResponseSchema = z.object({ records: z.array(aiRecordSchema) })

const responseJsonSchema = {
  name: 'carejournal_reports',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      records: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            reportType: { type: 'string' },
            examDate: { type: 'string', description: 'YYYY-MM-DD，无法识别时使用空字符串' },
            reportDate: { type: 'string', description: 'YYYY-MM-DD，无法识别时使用空字符串' },
            hospital: { type: 'string' },
            department: { type: 'string' },
            summary: { type: 'string' },
            indicators: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  rawName: { type: 'string' },
                  normalizedCode: { type: 'string' },
                  normalizedName: { type: 'string' },
                  value: { type: ['number', 'null'] },
                  rawValue: { type: 'string' },
                  unit: { type: 'string' },
                  referenceLow: { type: ['number', 'null'] },
                  referenceHigh: { type: ['number', 'null'] },
                  referenceText: { type: 'string' },
                  abnormalFlag: { type: 'string', enum: ['high', 'low', 'critical', 'normal', 'unknown'] },
                },
                required: ['rawName', 'normalizedCode', 'normalizedName', 'value', 'rawValue', 'unit', 'referenceLow', 'referenceHigh', 'referenceText', 'abnormalFlag'],
                additionalProperties: false,
              },
            },
          },
          required: ['reportType', 'examDate', 'reportDate', 'hospital', 'department', 'summary', 'indicators'],
          additionalProperties: false,
        },
      },
    },
    required: ['records'],
    additionalProperties: false,
  },
}

const SYSTEM_PROMPT = `你是医疗检查报告的信息录入工具。只忠实提取图片中明确出现的信息，不做诊断、预测或治疗建议。
每次只会提供一张图片；图片可能包含一份或多份报告，请按实际报告拆分 records。
日期统一为 YYYY-MM-DD；不确定或缺失的字符串使用空字符串，数值使用 null。
指标需同时保留报告原始名称，并尽量映射常见标准代码（如 WBC、NEUT_ABS、HGB、PLT、ALT、AST、CREA、CEA、CA199、CA125）；不确定时标准代码留空。
异常标记只依据报告中的箭头、H/L 或参考范围，不自行判断临床意义。`

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function endpointUrl(settings: AzureSettings) {
  const base = settings.endpoint.trim().replace(/\/+$/, '')
  if (/\/openai\/v1$/i.test(base)) return `${base}/chat/completions`
  return `${base}/openai/deployments/${encodeURIComponent(settings.deployment.trim())}/chat/completions?api-version=${encodeURIComponent(settings.apiVersion.trim())}`
}

interface AzureHttpResult {
  ok: boolean
  status: number
  data: unknown
  detail: string
}

async function azurePost(url: string, apiKey: string, body: unknown): Promise<AzureHttpResult> {
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.post({
      url,
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      data: body,
      connectTimeout: 30000,
      readTimeout: 120000,
      responseType: 'json',
    })
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      data: response.data,
      detail: typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
    }
  }
  const response = await fetch('/api/azure-openai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-azure-api-key': apiKey },
    body: JSON.stringify({ url, payload: body }),
  })
  const text = await response.text()
  let data: unknown = text
  try { data = JSON.parse(text) } catch { /* Azure may return plain text errors. */ }
  return { ok: response.ok, status: response.status, data, detail: text }
}

export async function recognizeReport(image: StoredImage, settings: AzureSettings, onAttempt?: (attempt: number) => void) {
  if (!settings.endpoint || !settings.apiKey || !settings.deployment || !settings.apiVersion) {
    throw new Error('请先在设置中填写完整的 Azure OpenAI 配置')
  }
  let lastError: unknown
  for (let attempt = 1; attempt <= Math.max(1, settings.maxRetries); attempt += 1) {
    onAttempt?.(attempt)
    try {
      const response = await azurePost(endpointUrl(settings), settings.apiKey, {
          model: settings.deployment.trim(),
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                { type: 'text', text: '提取这张图片中的检查记录，并严格按指定结构返回。' },
                { type: 'image_url', image_url: { url: image.dataUrl, detail: 'high' } },
              ],
            },
          ],
          response_format: { type: 'json_schema', json_schema: responseJsonSchema },
          max_completion_tokens: 10000,
        })
      if (!response.ok) {
        const error = new Error(`Azure 请求失败（${response.status}）：${response.detail.slice(0, 300)}`)
        if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) throw error
        throw Object.assign(error, { retryable: true })
      }
      const body = response.data as { choices?: Array<{ message?: { content?: string } }> }
      const content = body.choices?.[0]?.message?.content
      if (!content) throw Object.assign(new Error('Azure 返回内容为空'), { retryable: true })
      return aiResponseSchema.parse(JSON.parse(content))
    } catch (error) {
      lastError = error
      const retryable = (error as { retryable?: boolean }).retryable !== false
      if (!retryable || attempt >= settings.maxRetries) break
      await wait(600 * 2 ** (attempt - 1))
    }
  }
  throw lastError instanceof Error ? lastError : new Error('OCR 识别失败')
}

export async function toDomainRecords(result: z.infer<typeof aiResponseSchema>, images: StoredImage[], attempts: number) {
  const now = new Date().toISOString()
  return Promise.all(result.records.map(async (raw, index): Promise<ExamRecord> => {
    const examDate = /^\d{4}-\d{2}-\d{2}$/.test(raw.examDate) ? raw.examDate : now.slice(0, 10)
    const reportType = raw.reportType || '其他检查'
    const normalizedReportType = normalizeReportType(reportType).label
    const normalizedIndicators = raw.indicators.map((indicator) => {
      const normalized = normalizeIndicator(indicator.rawName, indicator.normalizedCode, indicator.normalizedName)
      return { ...indicator, id: newId(), normalizedCode: normalized.code, normalizedName: normalized.name }
    })
    const fingerprintSource = [raw.hospital, examDate, normalizedReportType, ...normalizedIndicators.map((item) => `${item.normalizedCode}:${item.rawValue}`)].join('|')
    return {
      id: newId(),
      reportType,
      normalizedReportType,
      examDate,
      reportDate: raw.reportDate || undefined,
      hospital: raw.hospital || undefined,
      department: raw.department || undefined,
      summary: raw.summary || undefined,
      indicators: normalizedIndicators,
      images: index === 0 ? images : [],
      linkedEventIds: [],
      fingerprint: await sha256(fingerprintSource),
      ocrStatus: 'completed',
      ocrAttempts: attempts,
      createdAt: now,
      updatedAt: now,
    }
  }))
}

export function eventForRecord(record: ExamRecord): TreatmentEvent {
  const now = new Date().toISOString()
  return {
    id: newId(),
    type: 'examination' as EventType,
    title: record.normalizedReportType || normalizeReportType(record.reportType).label,
    startDate: record.examDate,
    endDate: record.examDate,
    allDay: true,
    hospital: record.hospital,
    department: record.department,
    notes: record.summary,
    tags: [],
    linkedRecordIds: [record.id],
    createdAt: now,
    updatedAt: now,
  }
}

export async function testAzureConnection(settings: AzureSettings) {
  if (!settings.endpoint || !settings.apiKey || !settings.deployment) throw new Error('请填写完整配置')
  const response = await azurePost(endpointUrl(settings), settings.apiKey, {
      model: settings.deployment.trim(),
      messages: [{ role: 'user', content: '只回复 OK' }],
      max_completion_tokens: 16,
  })
  if (!response.ok) throw new Error(`连接失败（${response.status}）`)
}
