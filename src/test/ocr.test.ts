import { afterEach, describe, expect, it, vi } from 'vitest'
import { recognizeReport } from '../services/ocr'
import type { AzureSettings, DynamicVocabulary, StoredImage } from '../types'

const image: StoredImage = {
  id: 'image-1',
  name: 'report-1.jpg',
  mimeType: 'image/jpeg',
  dataUrl: 'data:image/jpeg;base64,AA==',
  sha256: 'hash-1',
}

const settings: AzureSettings = {
  endpoint: 'https://example-resource.openai.azure.com/openai/v1',
  apiKey: 'test-key',
  deployment: 'test-deployment',
  apiVersion: '2024-12-01-preview',
  maxRetries: 1,
}

afterEach(() => vi.restoreAllMocks())

describe('recognizeReport', () => {
  it('每个调用只发送一张图片并携带固定与动态词表', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ records: [] }) } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const vocabulary: DynamicVocabulary = { hospitals: ['协和医院'], departments: ['肿瘤内科'] }
    await expect(recognizeReport(image, settings, undefined, vocabulary)).resolves.toEqual({ records: [] })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const request = fetchMock.mock.calls[0]
    const proxyBody = JSON.parse(String((request[1] as RequestInit).body)) as {
      url: string
      payload: {
        messages: Array<{ content: string | Array<{ type: string; text?: string }> }>
        response_format: {
          json_schema: {
            schema: {
              properties: {
                records: {
                  items: {
                    properties: {
                      normalizedReportType: { enum: string[] }
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
    expect(proxyBody.url).toBe('https://example-resource.openai.azure.com/openai/v1/chat/completions')
    const userContent = proxyBody.payload.messages[1].content
    expect(Array.isArray(userContent) ? userContent.filter((item) => item.type === 'image_url') : []).toHaveLength(1)
    expect(proxyBody.payload.messages[0].content).toContain('台湾与大陆报告可能对同一指标使用不同基础单位')
    expect(proxyBody.payload.messages[0].content).toContain('严禁移动小数点、乘除 10')
    expect(Array.isArray(userContent) ? userContent.find((item) => item.type === 'text')?.text : '').toContain('不做任何单位换算')
    const fields = proxyBody.payload.response_format.json_schema.schema.properties.records.items.properties
    expect(fields.normalizedReportType.enum).toContain('血常规')
    expect(fields.indicators.items.properties.normalizedCode.enum).toContain('WBC')
    expect(fields.indicators.items.properties.normalizedName.enum).toContain('白细胞计数')
    expect(fields.hospital.description).toContain('协和医院')
    expect(fields.department.description).toContain('肿瘤内科')
    expect(fields.indicators.items.properties.unit.description).toContain('禁止自行补全、替换或转换')
    expect(fields.indicators.items.properties.value.description).toContain('禁止单位换算或倍率归一化')
  })
})
