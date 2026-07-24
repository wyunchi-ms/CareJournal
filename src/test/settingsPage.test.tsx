import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPage } from '../pages/SettingsPage'

const { deduplicateImagesGlobally } = vi.hoisted(() => ({
  deduplicateImagesGlobally: vi.fn(async () => ({
    recordsScanned: 6,
    recordsUpdated: 2,
    imagesRemoved: 3,
    filesDeleted: 2,
  })),
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
    restoreBackup: vi.fn(async () => undefined),
    deduplicateImagesGlobally,
    storageLabel: 'SQLite（本机）',
  }),
}))

describe('SettingsPage image maintenance', () => {
  beforeEach(() => deduplicateImagesGlobally.mockClear())

  it('provides a global image deduplication entry and reports the cleanup result', async () => {
    render(<SettingsPage />)

    fireEvent.click(screen.getByRole('button', { name: '全局图片去重' }))

    await waitFor(() => expect(deduplicateImagesGlobally).toHaveBeenCalledOnce())
    expect(screen.getByRole('status')).toHaveTextContent('共检查 6 份记录')
    expect(screen.getByRole('status')).toHaveTextContent('移除 3 张重复图片')
    expect(screen.getByRole('status')).toHaveTextContent('回收 2 个本地文件')
  })
})
