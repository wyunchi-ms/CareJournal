import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Capacitor } from '@capacitor/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPage } from '../pages/SettingsPage'
import { BackupPasswordRequiredError, exportAndroidBackupZip, exportBackup, importBackup, downloadBlob } from '../services/backup'

const { savePreferences, restoreBackup } = vi.hoisted(() => ({
  savePreferences: vi.fn(async () => undefined),
  restoreBackup: vi.fn(async () => undefined),
}))

vi.mock('../services/backup', () => {
  class BackupPasswordRequiredError extends Error {
    constructor() {
      super('Password required')
      this.name = 'BackupPasswordRequiredError'
    }
  }
  return {
    BackupPasswordRequiredError,
    exportBackup: vi.fn(async () => new Blob(['dummy'], { type: 'application/zip' })),
    exportAndroidBackupZip: vi.fn(async () => ({ cancelled: false, filename: 'android.zip' })),
    importBackup: vi.fn(),
    downloadBlob: vi.fn(async () => 'Documents/CareJournal/test.zip'),
  }
})

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
    events: [],
    chemotherapyTemplates: [],
    records: [],
    pins: [],
    reimbursementPlans: [],
    savePreferences,
    restoreBackup,
  }),
}))

describe('SettingsPage', () => {
  afterEach(() => {
    cleanup()
    window.location.hash = ''
    vi.restoreAllMocks()
  })
  beforeEach(() => {
    savePreferences.mockClear()
    vi.mocked(exportBackup).mockClear()
    vi.mocked(exportAndroidBackupZip).mockClear()
    vi.mocked(downloadBlob).mockClear()
    vi.mocked(importBackup).mockReset()
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

  it('restores the unencrypted zip backup entry and allows export', async () => {
    render(<SettingsPage />)

    expect(screen.queryByRole('heading', { name: '本地数据与家属共享' })).not.toBeInTheDocument()

    const trigger = screen.getByRole('button', { name: /备份与恢复/ })
    fireEvent.click(trigger)

    const exportBtn = screen.getByRole('button', { name: '导出备份' })
    fireEvent.click(exportBtn)

    await waitFor(() => expect(exportBackup).toHaveBeenCalled())
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled())
    expect(exportAndroidBackupZip).not.toHaveBeenCalled()
    expect(screen.getByText(/备份已保存至/)).toBeInTheDocument()
  })

  it('uses the Android streaming ZIP path without JSZip or blob download', async () => {
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android')
    render(<SettingsPage />)

    fireEvent.click(screen.getByRole('button', { name: /备份与恢复/ }))
    fireEvent.click(screen.getByRole('button', { name: '导出备份' }))

    await waitFor(() => expect(exportAndroidBackupZip).toHaveBeenCalled())
    expect(exportBackup).not.toHaveBeenCalled()
    expect(downloadBlob).not.toHaveBeenCalled()
    expect(screen.getByText(/备份已保存至：android.zip/)).toBeInTheDocument()
  })

  it('shows password prompt if importing an encrypted backup', async () => {
    vi.mocked(importBackup).mockRejectedValueOnce(new BackupPasswordRequiredError())
    render(<SettingsPage />)

    fireEvent.click(screen.getByRole('button', { name: /备份与恢复/ }))

    // Simulate file input change
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['dummy'], 'backup.json', { type: 'application/json' })
    Object.defineProperty(fileInput, 'files', { value: [file] })
    fireEvent.change(fileInput)

    await waitFor(() => expect(screen.getByText(/该旧版备份文件需要密码才能解密/)).toBeInTheDocument())

    const passwordInput = screen.getByPlaceholderText('请输入密码')
    fireEvent.change(passwordInput, { target: { value: 'mypassword' } })

    vi.mocked(importBackup).mockResolvedValueOnce({
      version: 2,
      exportedAt: '2023-01-01',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      events: [{ id: '1' } as any],
      chemotherapyTemplates: [],
      records: [],
      pins: [],
      reimbursementPlans: [],
      assets: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      preferences: {} as any
    })

    fireEvent.click(screen.getByRole('button', { name: '重试导入' }))

    await waitFor(() => expect(importBackup).toHaveBeenCalledWith(file, { password: 'mypassword' }))

    // Should show confirm sheet
    await waitFor(() => expect(screen.getByText('确认覆盖本地数据？')).toBeInTheDocument())
    expect(screen.getByText(/即将导入 1 个事件/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认覆盖' }))
    await waitFor(() => expect(restoreBackup).toHaveBeenCalled())
    expect(screen.getByText('已成功恢复备份数据')).toBeInTheDocument()
  })

  it('blocks the interface with explicit feedback while parsing a backup', async () => {
    let finishParsing: ((payload: Awaited<ReturnType<typeof importBackup>>) => void) | undefined
    vi.mocked(importBackup).mockImplementationOnce(() => new Promise((resolve) => { finishParsing = resolve }))
    render(<SettingsPage />)

    fireEvent.click(screen.getByRole('button', { name: /备份与恢复/ }))
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['backup'], 'backup.zip', { type: 'application/zip' })
    Object.defineProperty(fileInput, 'files', { value: [file] })
    fireEvent.change(fileInput)

    const dialog = await screen.findByRole('dialog', { name: '正在解析备份' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText(/正在校验备份索引和素材/)).toBeInTheDocument()
    expect(document.querySelector('.settings-layout')).toHaveAttribute('aria-busy', 'true')

    finishParsing?.({
      version: 2,
      exportedAt: '2026-08-05T00:00:00.000Z',
      events: [],
      chemotherapyTemplates: [],
      records: [],
      pins: [],
      reimbursementPlans: [],
      assets: [],
      preferences: {
        darkMode: false,
        localPrivacyOcrEnabled: false,
        chartIndicatorOrder: [],
        chartPinnedIndicatorCodes: [],
      },
    })

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '正在解析备份' })).not.toBeInTheDocument())
    expect(screen.getByText('确认覆盖本地数据？')).toBeInTheDocument()
    expect(document.querySelector('.settings-layout')).toHaveAttribute('aria-busy', 'false')
  })
})
