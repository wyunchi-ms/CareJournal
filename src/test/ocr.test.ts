import { afterEach, describe, expect, it, vi } from 'vitest'
import { recognizeReport } from '../services/ocr'
import type { AzureSettings, StoredImage } from '../types'

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
  it('每个调用只发送一张图片', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ records: [] }) } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(recognizeReport(image, settings)).resolves.toEqual({ records: [] })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const request = fetchMock.mock.calls[0]
    const proxyBody = JSON.parse(String((request[1] as RequestInit).body)) as {
      url: string
      payload: { messages: Array<{ content: string | Array<{ type: string }> }> }
    }
    expect(proxyBody.url).toBe('https://example-resource.openai.azure.com/openai/v1/chat/completions')
    const userContent = proxyBody.payload.messages[1].content
    expect(Array.isArray(userContent) ? userContent.filter((item) => item.type === 'image_url') : []).toHaveLength(1)
  })
})
