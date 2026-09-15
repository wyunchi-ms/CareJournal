import { describe, expect, it } from 'vitest'
import { chatCompletionsUrl, LLM_PROVIDERS, normalizeAppPreferences } from '../services/llmProviders'

describe('LLM provider settings', () => {
  it('migrates old preferences to an unfinished default locale setup', () => {
    const preferences = normalizeAppPreferences({ darkMode: true })
    expect(preferences.locale).toEqual({ region: 'CN', language: 'zh-CN', setupCompleted: false })
  })

  it('keeps a completed region and language selection', () => {
    const preferences = normalizeAppPreferences({ locale: { region: 'US', language: 'en', setupCompleted: true } })
    expect(preferences.locale).toEqual({ region: 'US', language: 'en', setupCompleted: true })
  })
  it('migrates the existing Azure settings to the v1 provider format without losing the key', () => {
    const preferences = normalizeAppPreferences({
      azure: {
        endpoint: 'https://carejournal.services.ai.azure.com',
        apiKey: 'existing-key',
        deployment: 'gpt-5.4',
        apiVersion: '2024-12-01-preview',
        maxRetries: 4,
      },
      darkMode: true,
    })

    expect(preferences.llm).toEqual({
      activeProvider: 'azure-openai',
      providers: {
        'azure-openai': {
          endpoint: 'https://carejournal.services.ai.azure.com/openai/v1',
          apiKey: 'existing-key',
          model: 'gpt-5.4',
          maxRetries: 4,
        },
      },
    })
    expect(preferences.darkMode).toBe(true)
    expect(preferences).not.toHaveProperty('azure')
  })

  it('uses the Azure v1 and standard compatible chat completion paths', () => {
    expect(chatCompletionsUrl('azure-openai', 'https://carejournal.openai.azure.com'))
      .toBe('https://carejournal.openai.azure.com/openai/v1/chat/completions')
    expect(chatCompletionsUrl('openrouter', 'https://openrouter.ai/api/v1/'))
      .toBe('https://openrouter.ai/api/v1/chat/completions')
  })

  it('includes domestic OpenAI-compatible providers with their official endpoints', () => {
    expect(LLM_PROVIDERS).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'siliconflow', defaultEndpoint: 'https://api.siliconflow.cn/v1' }),
      expect.objectContaining({ id: 'tencent-hunyuan', defaultEndpoint: 'https://api.hunyuan.cloud.tencent.com/v1' }),
      expect.objectContaining({ id: 'stepfun', defaultEndpoint: 'https://api.stepfun.com/v1' }),
      expect.objectContaining({ id: 'baichuan', defaultEndpoint: 'https://api.baichuan-ai.com/v1' }),
      expect.objectContaining({ id: 'iflytek-spark', defaultEndpoint: 'https://spark-api-open.xf-yun.com/v1' }),
      expect.objectContaining({ id: 'kimi', defaultEndpoint: 'https://api.moonshot.cn/v1' }),
      expect.objectContaining({ id: 'minimax', tokenParameter: 'max_completion_tokens', maxOutputTokens: 2048 }),
      expect.objectContaining({ id: 'glm', defaultEndpoint: 'https://open.bigmodel.cn/api/paas/v4' }),
    ]))
    expect(chatCompletionsUrl('iflytek-spark', 'https://spark-api-open.xf-yun.com/v1/'))
      .toBe('https://spark-api-open.xf-yun.com/v1/chat/completions')
  })
})
