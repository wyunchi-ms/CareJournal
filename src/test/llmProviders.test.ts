import { describe, expect, it } from 'vitest'
import { chatCompletionsUrl, normalizeAppPreferences } from '../services/llmProviders'

describe('LLM provider settings', () => {
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
})
