import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPage } from '../pages/SettingsPage'

const { deduplicateImagesGlobally, importBackup, restoreBackup, savePreferences } = vi.hoisted(() => ({
  deduplicateImagesGlobally: vi.fn(async () => ({
    recordsScanned: 6,
    reimbursementPlansScanned: 4,
    recordsUpdated: 2,
    reimbursementPlansUpdated: 1,
    imagesRemoved: 3,
    attachmentsRemoved: 2,
    filesDeleted: 2,
  })),
  importBackup: vi.fn(async () => ({
    version: 1 as const,
    exportedAt: '2026-07-27T00:00:00.000Z',
    events: [{ id: 'event-1' }],
    chemotherapyTemplates: [{ id: 'template-1' }],
    records: [{ id: 'record-1' }, { id: 'record-2' }],
    pins: [],
    preferences: {},
  })),
  restoreBackup: vi.fn(async () => undefined),
  savePreferences: vi.fn(async () => undefined),
}))

vi.mock('../services/backup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/backup')>()),
  importBackup,
}))

vi.mock('../store/AppContext', () => ({
  useApp: () => ({
    events: [],
    chemotherapyTemplates: [],
    records: [],
    pins: [],
    preferences: {
      darkMode: false,
      localPrivacyOcrEnabled: false,
      azure: {
        endpoint: '',
        apiKey: '',
        deployment: '',
        apiVersion: '2024-12-01-preview',
        maxRetries: 3,
      },
    },
    savePreferences,
    restoreBackup,
    deduplicateImagesGlobally,
    storageLabel: 'SQLite（本机）',
  }),
}))

describe('SettingsPage image maintenance', () => {
  afterEach(cleanup)
  beforeEach(() => {
    deduplicateImagesGlobally.mockClear()
    importBackup.mockClear()
    restoreBackup.mockClear()
    savePreferences.mockClear()
  })

  it('saves the local PaddleOCR privacy option with the LLM settings', async () => {
    render(<SettingsPage />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'PaddleOCR 本地脱敏' }))
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))

    await waitFor(() => expect(savePreferences).toHaveBeenCalledWith(expect.objectContaining({
      localPrivacyOcrEnabled: true,
    })))
  })

  it('explains that LAN sync no longer needs a pairing code', () => {
    render(<SettingsPage />)

    expect(screen.getByText(/无需配对码，设备间会自动协商临时密钥/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/配对码/)).not.toBeInTheDocument()
  })

  it('provides a global image deduplication entry and reports the cleanup result', async () => {
    render(<SettingsPage />)

    fireEvent.click(screen.getByRole('button', { name: '全局素材去重' }))

    await waitFor(() => expect(deduplicateImagesGlobally).toHaveBeenCalledOnce())
    expect(screen.getByRole('status')).toHaveTextContent('检查 6 份记录和 4 个报销计划')
    expect(screen.getByRole('status')).toHaveTextContent('移除 3 张重复检查图片及 2 个重复报销附件')
    expect(screen.getByRole('status')).toHaveTextContent('回收 2 个本地文件')
  })

  it('uses the shared bottom sheet instead of a system confirm before restoring data', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    render(<SettingsPage />)
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!

    fireEvent.change(fileInput, { target: { files: [new File(['backup'], 'carejournal.carejournal')] } })

    const confirmation = await screen.findByRole('dialog', { name: '恢复备份' })
    expect(confirmation).toHaveClass('bottom-sheet')
    expect(confirmation).toHaveTextContent('1 个事件、2 份检查、1 个治疗方案和 0 个报销计划')
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(restoreBackup).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '继续恢复' }))
    await waitFor(() => expect(restoreBackup).toHaveBeenCalledOnce())
    confirmSpy.mockRestore()
  })
})
