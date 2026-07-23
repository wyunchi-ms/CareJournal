import { z } from 'zod'
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { INDICATORS, normalizeIndicator } from '../data/indicatorAliases'
import { normalizeReportType, REPORT_TYPES } from '../data/reportTypeAliases'
import type { AzureSettings, DynamicVocabulary, ExamRecord, TreatmentEvent, StoredImage, EventType } from '../types'
import { DEFAULT_VOCABULARY, newId } from '../types'
import { sha256 } from './images'
import { chooseKnownValue } from './vocabulary'

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
  normalizedReportType: z.string(),
  examDate: z.string(),
  reportDate: z.string(),
  hospital: z.string(),
  department: z.string(),
  summary: z.string(),
  indicators: z.array(aiIndicatorSchema),
})

const aiResponseSchema = z.object({ records: z.array(aiRecordSchema) })

function knownValueDescription(kind: string, values: string[]) {
  if (!values.length) return `${kind}按图片原文返回，无法识别时使用空字符串`
  return `优先从已有${kind}列表中选择完全匹配项；图片明确出现新值时按原文返回。已有${kind}：${values.slice(0, 100).join('、')}`
}

function responseJsonSchema(vocabulary: DynamicVocabulary) {
  const reportTypeLabels = REPORT_TYPES.map((item) => item.label)
  const indicatorCodes = [...INDICATORS.map((item) => item.code), 'OTHER']
  const indicatorNames = [...INDICATORS.map((item) => item.name), '其他指标']
  return {
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
            normalizedReportType: { type: 'string', enum: reportTypeLabels, description: '必须从给定报告类型列表中选择；无法归类时选择“其他检查”' },
            examDate: { type: 'string', description: 'YYYY-MM-DD，无法识别时使用空字符串' },
            reportDate: { type: 'string', description: 'YYYY-MM-DD，无法识别时使用空字符串' },
            hospital: { type: 'string', description: knownValueDescription('医院', vocabulary.hospitals) },
            department: { type: 'string', description: knownValueDescription('科室', vocabulary.departments) },
            summary: { type: 'string' },
            indicators: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  rawName: { type: 'string' },
                  normalizedCode: { type: 'string', enum: indicatorCodes, description: '必须从标准指标代码列表选择；无法归类时选择 OTHER' },
                  normalizedName: { type: 'string', enum: indicatorNames, description: '必须从标准指标名称列表选择；无法归类时选择“其他指标”' },
                  value: { type: ['number', 'null'], description: '图片原始单位下的数值，只解析原文数字，禁止单位换算或倍率归一化；单位不清时使用 null' },
                  rawValue: { type: 'string', description: '忠实保留图片中显示的原始结果文字，不改小数点、不改变倍率' },
                  unit: { type: 'string', description: '逐字符抄录图片中的单位和倍率；禁止自行补全、替换或转换，无法确认时使用空字符串' },
                  referenceLow: { type: ['number', 'null'], description: '图片原始单位下的参考下限，禁止换算；无法确认时使用 null' },
                  referenceHigh: { type: ['number', 'null'], description: '图片原始单位下的参考上限，禁止换算；无法确认时使用 null' },
                  referenceText: { type: 'string', description: '忠实保留图片中的参考范围原文及其倍率表达' },
                  abnormalFlag: { type: 'string', enum: ['high', 'low', 'critical', 'normal', 'unknown'] },
                },
                required: ['rawName', 'normalizedCode', 'normalizedName', 'value', 'rawValue', 'unit', 'referenceLow', 'referenceHigh', 'referenceText', 'abnormalFlag'],
                additionalProperties: false,
              },
            },
          },
          required: ['reportType', 'normalizedReportType', 'examDate', 'reportDate', 'hospital', 'department', 'summary', 'indicators'],
          additionalProperties: false,
        },
      },
    },
    required: ['records'],
    additionalProperties: false,
  },
}
}

const SYSTEM_PROMPT = `你是医疗检查报告的信息录入工具。只忠实提取图片中明确出现的信息，不做诊断、预测或治疗建议。
每次只会提供一张图片；图片可能包含一份或多份报告，请按实际报告拆分 records。
日期统一为 YYYY-MM-DD；不确定或缺失的字符串使用空字符串，数值使用 null。
reportType 保留报告原文，normalizedReportType 必须从 schema 的标准报告类型中选择。
指标需保留报告原始名称；normalizedCode 和 normalizedName 必须从 schema 的标准指标词表中选择且相互对应，无法归类时分别选择 OTHER 和“其他指标”。
医院和科室如果与已有列表匹配，必须复用列表中的写法；只有图片明确出现新名称时才返回新值。
单位与数值必须作为不可分割的一组逐项核对。台湾与大陆报告可能对同一指标使用不同基础单位、倍率和小数位，例如 g/dL 与 g/L、10^3/μL 与 10^9/L、10^4/μL 与 10^12/L；严禁根据常识把一种单位换算成另一种，也严禁移动小数点、乘除 10 或补写常见单位。
rawValue、unit 和 referenceText 必须忠实抄录图片原文；value、referenceLow、referenceHigh 只能解析原文在同一原始单位下直接显示的数字。单位或倍率模糊时，unit 使用空字符串，对应数值使用 null，不得猜测。
在返回每个指标前，重新核对结果值、参考范围与单位是否来自同一行，特别检查 10 的幂次、/μL、/uL、/L、mg/dL、mmol/L、g/dL、g/L 和 %。
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

export async function recognizeReport(image: StoredImage, settings: AzureSettings, onAttempt?: (attempt: number) => void, vocabulary: DynamicVocabulary = DEFAULT_VOCABULARY) {
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
                { type: 'text', text: '提取这张图片中的检查记录，并严格按指定结构返回。先逐项核对原始数值、参考范围、单位和 10 的幂次，不做任何单位换算。' },
                { type: 'image_url', image_url: { url: image.dataUrl, detail: 'high' } },
              ],
            },
          ],
          response_format: { type: 'json_schema', json_schema: responseJsonSchema(vocabulary) },
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

export async function toDomainRecords(result: z.infer<typeof aiResponseSchema>, images: StoredImage[], attempts: number, vocabulary: DynamicVocabulary = DEFAULT_VOCABULARY) {
  const now = new Date().toISOString()
  return Promise.all(result.records.map(async (raw, index): Promise<ExamRecord> => {
    const examDate = /^\d{4}-\d{2}-\d{2}$/.test(raw.examDate) ? raw.examDate : now.slice(0, 10)
    const selectedReportType = REPORT_TYPES.find((item) => item.label === raw.normalizedReportType)
    const reportType = raw.reportType || selectedReportType?.label || '其他检查'
    const normalizedReportType = selectedReportType?.label || normalizeReportType(reportType).label
    const hospital = chooseKnownValue(raw.hospital, vocabulary.hospitals)
    const department = chooseKnownValue(raw.department, vocabulary.departments)
    const normalizedIndicators = raw.indicators.map((indicator) => {
      const normalized = normalizeIndicator(indicator.rawName, indicator.normalizedCode, indicator.normalizedName)
      return { ...indicator, id: newId(), normalizedCode: normalized.code, normalizedName: normalized.name }
    })
    const fingerprintSource = [hospital, examDate, normalizedReportType, ...normalizedIndicators.map((item) => `${item.normalizedCode}:${item.rawValue}`)].join('|')
    return {
      id: newId(),
      reportType,
      normalizedReportType,
      examDate,
      reportDate: raw.reportDate || undefined,
      hospital: hospital || undefined,
      department: department || undefined,
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
