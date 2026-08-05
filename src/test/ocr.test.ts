import { afterEach, describe, expect, it, vi } from 'vitest'
import { mergeRecognizedRecord, recognizeReport, recognizeReportText, toDomainRecords } from '../services/ocr'
import type { DynamicVocabulary, ExamRecord, LlmSettings, StoredImage } from '../types'

const nativePost = vi.hoisted(() => vi.fn())

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  CapacitorHttp: { post: nativePost },
}))

const image: StoredImage = {
  id: 'image-1',
  name: 'report-1.jpg',
  mimeType: 'image/jpeg',
  dataUrl: 'data:image/jpeg;base64,AA==',
  sha256: 'hash-1',
}

const settings: LlmSettings = {
  activeProvider: 'azure-openai',
  providers: {
    'azure-openai': {
      endpoint: 'https://example-resource.openai.azure.com/openai/v1',
      apiKey: 'test-key',
      model: 'test-deployment',
      maxRetries: 1,
    },
  },
}

afterEach(() => {
  vi.restoreAllMocks()
  nativePost.mockReset()
})

describe('recognizeReport', () => {
  it('每个调用只发送一张图片并携带固定与动态词表', async () => {
    nativePost.mockResolvedValue({ status: 200, data: {
      choices: [{ message: { content: JSON.stringify({ records: [] }) } }],
    } })

    const vocabulary: DynamicVocabulary = { hospitals: ['协和医院'], departments: ['肿瘤内科'] }
    await expect(recognizeReport(image, settings, undefined, vocabulary)).resolves.toEqual({ records: [] })
    expect(nativePost).toHaveBeenCalledTimes(1)

    const request = nativePost.mock.calls[0][0] as {
      url: string
      data: {
        messages: Array<{ content: string | Array<{ type: string; text?: string }> }>
        response_format: {
          json_schema: {
            schema: {
              properties: {
                records: {
                  items: {
                    properties: {
                      normalizedReportType: { enum: string[] }
                      sampleDate: { description: string }
                      hospital: { description: string }
                      department: { description: string }
                      indicators: { items: { properties: {
                        normalizedCode: { enum: string[] }
                        normalizedName: { enum: string[] }
                        unit: { description: string }
                        value: { description: string }
                      } } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    expect(request.url).toBe('https://example-resource.openai.azure.com/openai/v1/chat/completions')
    const userContent = request.data.messages[1].content
    expect(Array.isArray(userContent) ? userContent.filter((item) => item.type === 'image_url') : []).toHaveLength(1)
    expect(request.data.messages[0].content).toContain('所有指标必须统一为中国大陆临床检验常用单位')
    expect(request.data.messages[0].content).toContain('HGB/血红蛋白：g/L')
    expect(request.data.messages[0].content).toContain('13.2 g/dL 返回 value=132')
    expect(request.data.messages[0].content).toContain('即使申请日期更醒目，也不得使用申请日期')
    expect(request.data.messages[0].content).toContain('禁止使用其他日期或当天日期补全')
    expect(Array.isArray(userContent) ? userContent.find((item) => item.type === 'text')?.text : '').toContain('换算为给定的中国大陆标准单位')
    const fields = request.data.response_format.json_schema.schema.properties.records.items.properties
    expect(fields.normalizedReportType.enum).toContain('血常规')
    expect(fields.sampleDate.description).toContain('只提取采样日期')
    expect(fields.sampleDate.description).toContain('必须忽略申请日期')
    expect(fields.indicators.items.properties.normalizedCode.enum).toContain('WBC')
    expect(fields.indicators.items.properties.normalizedName.enum).toContain('白细胞计数')
    expect(fields.hospital.description).toContain('协和医院')
    expect(fields.department.description).toContain('肿瘤内科')
    expect(fields.indicators.items.properties.unit.description).toContain('HGB/血红蛋白：g/L')
    expect(fields.indicators.items.properties.unit.description).toContain('不得只改单位不改数值')
    expect(fields.indicators.items.properties.value.description).toContain('换算为中国大陆标准单位后的结果数值')
  })

  it('sends locally extracted PDF text without an image payload', async () => {
    nativePost.mockResolvedValue({ status: 200, data: {
      choices: [{ message: { content: JSON.stringify({ records: [] }) } }],
    } })

    await expect(recognizeReportText('血红蛋白 132 g/L\n参考范围 120-160 g/L', '血常规.pdf', settings)).resolves.toEqual({ records: [] })

    const request = nativePost.mock.calls[0][0] as {
      data: { messages: Array<{ content: string | Array<{ type: string }> }> }
    }
    const userContent = request.data.messages[1].content
    expect(userContent).toBeTypeOf('string')
    expect(userContent).toContain('血红蛋白 132 g/L')
    expect(userContent).toContain('<report_text>')
    expect(userContent).toContain('不得猜测或补全')
    expect(JSON.stringify(userContent)).not.toContain('image_url')
  })

  it('uses the selected OpenAI-compatible provider and its single model', async () => {
    nativePost.mockResolvedValue({ status: 200, data: {
      choices: [{ message: { content: '```json\n{"records":[]}\n```' } }],
    } })
    const deepseek: LlmSettings = {
      activeProvider: 'deepseek',
      providers: {
        deepseek: {
          endpoint: 'https://api.deepseek.com/v1',
          apiKey: 'deepseek-key',
          model: 'deepseek-chat',
          maxRetries: 1,
        },
      },
    }

    await expect(recognizeReportText('血红蛋白 132 g/L', '报告.txt', deepseek)).resolves.toEqual({ records: [] })

    const request = nativePost.mock.calls[0][0] as {
      url: string
      data: { model: string; response_format: { type: string }; max_tokens: number }
    }
    expect(request).toMatchObject({
      url: 'https://api.deepseek.com/v1/chat/completions',
      data: {
        model: 'deepseek-chat',
        response_format: { type: 'json_object' },
        max_tokens: 10000,
      },
    })
  })
})

describe('toDomainRecords', () => {
  it('keeps an unrecognized sample date empty instead of substituting today', async () => {
    const [record] = await toDomainRecords({
      records: [{
        reportType: '血常规',
        normalizedReportType: '血常规',
        sampleDate: '',
        hospital: '',
        department: '',
        summary: '',
        indicators: [],
      }],
    }, [image], 1)

    expect(record.sampleDate).toBe('')
    expect(record).not.toHaveProperty('examDate')
    expect(record).not.toHaveProperty('reportDate')
  })
})

describe('mergeRecognizedRecord', () => {
  it('replaces recognized content while preserving record identity and links', () => {
    const original: ExamRecord = {
      id: 'record-1',
      reportType: '旧报告',
      sampleDate: '2026-07-01',
      indicators: [],
      images: [image],
      linkedEventIds: ['event-1'],
      fingerprint: 'old-fingerprint',
      ocrStatus: 'completed',
      ocrAttempts: 1,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    }
    const recognized: ExamRecord = {
      ...original,
      id: 'temporary-record',
      reportType: '血常规',
      normalizedReportType: '血常规',
      summary: '识别后的结论',
      fingerprint: 'new-fingerprint',
      indicators: [{
        id: 'new-indicator',
        rawName: '白细胞',
        normalizedCode: 'WBC',
        normalizedName: '白细胞计数',
        value: 5.2,
        rawValue: '5.2',
        unit: '10^9/L',
        referenceLow: 3.5,
        referenceHigh: 9.5,
        referenceText: '3.5-9.5',
        abnormalFlag: 'normal',
      }],
      images: [],
      linkedEventIds: [],
    }

    const updated = mergeRecognizedRecord(original, [recognized, recognized], 2)

    expect(updated).toMatchObject({
      id: 'record-1',
      reportType: '血常规',
      summary: '识别后的结论',
      fingerprint: 'new-fingerprint',
      linkedEventIds: ['event-1'],
      ocrAttempts: 2,
    })
    expect(updated.images).toEqual([image])
    expect(updated.indicators).toHaveLength(1)
  })
})
