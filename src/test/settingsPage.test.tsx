import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPage } from '../pages/SettingsPage'

const { savePreferences } = vi.hoisted(() => ({
  savePreferences: vi.fn(async () => undefined),
}))

vi.mock('../store/AppContext', () => ({
  useApp: () => ({
    preferences: {
      darkMode: false,
      localPrivacyOcrEnabled: false,
      llm: {
        activeProvider: 'azure-openai',
        providers: {
          'azure-openai': {
            endpoint: '',
            apiKey: '',
            model: '',
            maxRetries: 3,
          },
        },
      },
      chartIndicatorOrder: [],
      chartPinnedIndicatorCodes: [],
    },
    savePreferences,
  }),
}))

describe('SettingsPage', () => {
  afterEach(() => {
    cleanup()
    window.location.hash = ''
  })
  beforeEach(() => {
    savePreferences.mockClear()
    window.location.hash = ''
  })

  it('collapses the intelligent recognition card by default', () => {
    render(<SettingsPage />)

    const trigger = screen.getByRole('button', { name: /智能识别服务/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('checkbox', { name: 'PaddleOCR 本地脱敏' })).not.toBeInTheDocument()

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('checkbox', { name: 'PaddleOCR 本地脱敏' })).toBeInTheDocument()
  })

  it('collapses all major settings cards by default and keeps a useful summary visible', () => {
    render(<SettingsPage />)

    const cardNames = [/智能识别服务/, /局域网同步/, /隐私与数据/, /显示/]
    cardNames.forEach((name) => expect(screen.getByRole('button', { name })).toHaveAttribute('aria-expanded', 'false'))
    expect(screen.getByRole('button', { name: /Azure OpenAI · 尚未配置/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /未开启 · 同一 Wi-Fi 双向同步/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /深色模式：未开启/ })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: '深色模式' })).not.toBeInTheDocument()
  })

  it('opens the intelligent recognition card when linked from the import guide', () => {
    window.location.hash = '#/settings#llm-settings'
    render(<SettingsPage />)

    expect(screen.getByRole('button', { name: /智能识别服务/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('saves the local PaddleOCR privacy option with the LLM settings', async () => {
    render(<SettingsPage />)

    fireEvent.click(screen.getByRole('button', { name: /智能识别服务/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'PaddleOCR 本地脱敏' }))
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))

    await waitFor(() => expect(savePreferences).toHaveBeenCalledWith(expect.objectContaining({
      localPrivacyOcrEnabled: true,
    })))
  })

  it('uses a simple provider-to-single-model editor without Azure API Version', () => {
    render(<SettingsPage />)

    fireEvent.click(screen.getByRole('button', { name: /智能识别服务/ }))
    fireEvent.click(screen.getByRole('button', { name: /DeepSeek/ }))

    expect(screen.getByText('当前使用').parentElement).toHaveTextContent('DeepSeek')
    expect(screen.getByPlaceholderText('例如 deepseek-chat')).toBeInTheDocument()
    expect(screen.queryByText('API Version')).not.toBeInTheDocument()
  })

  it('exposes the LAN sync entry without a pairing-code UI', () => {
    render(<SettingsPage />)

    fireEvent.click(screen.getByRole('button', { name: /局域网同步/ }))
    expect(screen.getByRole('button', { name: /开启局域网同步/ })).toBeInTheDocument()
    expect(screen.queryByLabelText(/配对码/)).not.toBeInTheDocument()
  })

  it('removes the local-data family-sharing and encrypted-backup entry', () => {
    render(<SettingsPage />)

    expect(screen.queryByRole('heading', { name: '本地数据与家属共享' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '导入备份' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '导出加密备份' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '全局素材去重' })).not.toBeInTheDocument()
  })
})
