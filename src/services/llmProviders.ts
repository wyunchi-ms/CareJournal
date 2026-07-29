import {
  DEFAULT_PREFERENCES,
  LLM_PROVIDER_IDS,
  type AppPreferences,
  type LegacyAzureSettings,
  type LlmProviderId,
  type LlmProviderSettings,
  type LlmSettings,
} from '../types'

export interface LlmProviderDefinition {
  id: LlmProviderId
  label: string
  description: string
  defaultEndpoint: string
  endpointPlaceholder: string
  modelPlaceholder: string
  responseFormat: 'json-schema' | 'json-object' | 'prompt'
  tokenParameter: 'max_completion_tokens' | 'max_tokens'
}

export const LLM_PROVIDERS: LlmProviderDefinition[] = [
  {
    id: 'azure-openai',
    label: 'Azure OpenAI',
    description: 'Azure AI Foundry 中部署的 OpenAI 模型',
    defaultEndpoint: '',
    endpointPlaceholder: 'https://你的资源.services.ai.azure.com/openai/v1',
    modelPlaceholder: '例如 gpt-5.4（填写部署名称）',
    responseFormat: 'json-schema',
    tokenParameter: 'max_completion_tokens',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'OpenAI 官方 API',
    defaultEndpoint: 'https://api.openai.com/v1',
    endpointPlaceholder: 'https://api.openai.com/v1',
    modelPlaceholder: '例如 gpt-4.1-mini',
    responseFormat: 'json-schema',
    tokenParameter: 'max_completion_tokens',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'DeepSeek 官方兼容接口',
    defaultEndpoint: 'https://api.deepseek.com/v1',
    endpointPlaceholder: 'https://api.deepseek.com/v1',
    modelPlaceholder: '例如 deepseek-chat',
    responseFormat: 'json-object',
    tokenParameter: 'max_tokens',
  },
  {
    id: 'kimi',
    label: 'Kimi',
    description: '月之暗面 OpenAI 兼容接口',
    defaultEndpoint: 'https://api.moonshot.cn/v1',
    endpointPlaceholder: 'https://api.moonshot.cn/v1',
    modelPlaceholder: '填写控制台中的模型名称',
    responseFormat: 'json-object',
    tokenParameter: 'max_tokens',
  },
  {
    id: 'doubao',
    label: '豆包',
    description: '火山方舟 OpenAI 兼容接口',
    defaultEndpoint: 'https://ark.cn-beijing.volces.com/api/v3',
    endpointPlaceholder: 'https://ark.cn-beijing.volces.com/api/v3',
    modelPlaceholder: '填写方舟推理接入点或模型名称',
    responseFormat: 'prompt',
    tokenParameter: 'max_tokens',
  },
  {
    id: 'qwen',
    label: 'Qwen',
    description: '阿里云百炼 OpenAI 兼容接口',
    defaultEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    endpointPlaceholder: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelPlaceholder: '填写控制台中的模型名称',
    responseFormat: 'json-object',
    tokenParameter: 'max_tokens',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    description: 'Google Gemini OpenAI 兼容接口',
    defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    endpointPlaceholder: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelPlaceholder: '例如 gemini-2.5-flash',
    responseFormat: 'json-schema',
    tokenParameter: 'max_tokens',
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    description: 'MiniMax 开放平台兼容接口',
    defaultEndpoint: 'https://api.minimaxi.com/v1',
    endpointPlaceholder: 'https://api.minimaxi.com/v1',
    modelPlaceholder: '填写控制台中的模型名称',
    responseFormat: 'prompt',
    tokenParameter: 'max_tokens',
  },
  {
    id: 'glm',
    label: 'GLM',
    description: '智谱 AI OpenAI 兼容接口',
    defaultEndpoint: 'https://open.bigmodel.cn/api/paas/v4',
    endpointPlaceholder: 'https://open.bigmodel.cn/api/paas/v4',
    modelPlaceholder: '填写控制台中的模型名称',
    responseFormat: 'json-object',
    tokenParameter: 'max_tokens',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: '通过一个密钥使用多个兼容模型',
    defaultEndpoint: 'https://openrouter.ai/api/v1',
    endpointPlaceholder: 'https://openrouter.ai/api/v1',
    modelPlaceholder: '例如 openai/gpt-4.1-mini',
    responseFormat: 'prompt',
    tokenParameter: 'max_tokens',
  },
  {
    id: 'openai-compatible',
    label: '自定义兼容服务',
    description: 'LiteLLM、OneAPI、New API 等服务',
    defaultEndpoint: '',
    endpointPlaceholder: 'https://你的服务地址/v1',
    modelPlaceholder: '填写服务中配置的模型名称',
    responseFormat: 'prompt',
    tokenParameter: 'max_tokens',
  },
]

const providerIds = new Set<string>(LLM_PROVIDER_IDS)

export function getLlmProvider(id: LlmProviderId) {
  return LLM_PROVIDERS.find((provider) => provider.id === id) ?? LLM_PROVIDERS[0]
}

export function createProviderSettings(id: LlmProviderId, source?: Partial<LlmProviderSettings>): LlmProviderSettings {
  const provider = getLlmProvider(id)
  return {
    endpoint: source?.endpoint?.trim() || provider.defaultEndpoint,
    apiKey: source?.apiKey ?? '',
    model: source?.model ?? '',
    maxRetries: Number.isFinite(source?.maxRetries) ? Math.min(5, Math.max(1, Number(source?.maxRetries))) : 3,
  }
}

export function getActiveLlmSettings(settings: LlmSettings) {
  const provider = getLlmProvider(settings.activeProvider)
  return {
    provider,
    settings: createProviderSettings(provider.id, settings.providers[provider.id]),
  }
}

export function isLlmConfigured(settings: LlmSettings) {
  const active = getActiveLlmSettings(settings)
  return Boolean(active.settings.endpoint.trim() && active.settings.apiKey.trim() && active.settings.model.trim())
}

function azureV1Endpoint(value: string) {
  const base = value.trim().replace(/\/+$/, '')
  if (!base) return ''
  if (/\/openai\/v1$/i.test(base)) return base
  return `${base}/openai/v1`
}

export function chatCompletionsUrl(providerId: LlmProviderId, endpoint: string) {
  const base = providerId === 'azure-openai' ? azureV1Endpoint(endpoint) : endpoint.trim().replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(base)) return base
  return `${base}/chat/completions`
}

type StoredPreferences = Partial<AppPreferences> & {
  azure?: Partial<LegacyAzureSettings>
  llm?: Partial<LlmSettings> & { providers?: Partial<Record<LlmProviderId, Partial<LlmProviderSettings>>> }
}

export function normalizeAppPreferences(value?: unknown): AppPreferences {
  const source = value && typeof value === 'object' ? value as StoredPreferences : {}
  const sourceLlm = source.llm
  let llm: LlmSettings

  if (sourceLlm?.activeProvider && providerIds.has(sourceLlm.activeProvider)) {
    const activeProvider = sourceLlm.activeProvider
    const providers: LlmSettings['providers'] = {}
    for (const id of LLM_PROVIDER_IDS) {
      const stored = sourceLlm.providers?.[id]
      if (stored) providers[id] = createProviderSettings(id, stored)
    }
    if (!providers[activeProvider]) providers[activeProvider] = createProviderSettings(activeProvider)
    llm = { activeProvider, providers }
  } else if (source.azure) {
    const legacy = source.azure
    llm = {
      activeProvider: 'azure-openai',
      providers: {
        'azure-openai': createProviderSettings('azure-openai', {
          endpoint: azureV1Endpoint(legacy.endpoint ?? ''),
          apiKey: legacy.apiKey ?? '',
          model: legacy.deployment ?? '',
          maxRetries: legacy.maxRetries,
        }),
      },
    }
  } else {
    llm = {
      activeProvider: DEFAULT_PREFERENCES.llm.activeProvider,
      providers: {
        'azure-openai': createProviderSettings('azure-openai'),
      },
    }
  }

  return {
    llm,
    localPrivacyOcrEnabled: source.localPrivacyOcrEnabled ?? DEFAULT_PREFERENCES.localPrivacyOcrEnabled,
    darkMode: source.darkMode ?? DEFAULT_PREFERENCES.darkMode,
    chartIndicatorOrder: Array.isArray(source.chartIndicatorOrder) ? source.chartIndicatorOrder : DEFAULT_PREFERENCES.chartIndicatorOrder,
    chartPinnedIndicatorCodes: Array.isArray(source.chartPinnedIndicatorCodes) ? source.chartPinnedIndicatorCodes : DEFAULT_PREFERENCES.chartPinnedIndicatorCodes,
  }
}

export function mergePortableLlmSettings(portable: unknown, local: LlmSettings) {
  const restored = normalizeAppPreferences({ llm: portable }).llm
  const providers: LlmSettings['providers'] = {}
  for (const id of LLM_PROVIDER_IDS) {
    const restoredProvider = restored.providers[id]
    const localProvider = local.providers[id]
    if (restoredProvider || localProvider) {
      providers[id] = createProviderSettings(id, {
        ...restoredProvider,
        apiKey: localProvider?.apiKey ?? '',
      })
    }
  }
  return { ...restored, providers }
}
