import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPage } from '../pages/SettingsPage'

const { deduplicateImagesGlobally, importBackup, restoreBackup } = vi.hoisted(() => ({
  deduplicateImagesGlobally: vi.fn(async () => ({
    recordsScanned: 6,
    recordsUpdated: 2,
    imagesRemoved: 3,
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
      azure: {
        endpoint: '',
        apiKey: '',
        deployment: '',
        apiVersion: '2024-12-01-preview',
        maxRetries: 3,
      },
    },
    savePreferences: vi.fn(async () => undefined),
    restoreBackup,
    deduplicateImagesGlobally,
    storageLabel: 'SQLite（本机）',
  }),
}))

describe('SettingsPage image maintenance', () => {
  beforeEach(() => {
    deduplicateImagesGlobally.mockClear()
    importBackup.mockClear()
    restoreBackup.mockClear()
  })

  it('provides a global image deduplication entry and reports the cleanup result', async () => {
    render(<SettingsPage />)

    fireEvent.click(screen.getByRole('button', { name: '全局图片去重' }))

    await waitFor(() => expect(deduplicateImagesGlobally).toHaveBeenCalledOnce())
    expect(screen.getByRole('status')).toHaveTextContent('共检查 6 份记录')
    expect(screen.getByRole('status')).toHaveTextContent('移除 3 张重复图片')
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
