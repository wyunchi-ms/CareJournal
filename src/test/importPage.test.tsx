import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImportPage } from '../pages/ImportPage'

const platform = vi.hoisted(() => ({ native: false }))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => platform.native },
}))

vi.mock('../store/AppContext', () => ({
  useApp: () => ({
    preferences: { azure: { endpoint: '', apiKey: '', deployment: '', apiVersion: '2024-10-21' } },
    ocrJobs: [],
    ocrQueueStats: { total: 0, queued: 0, processing: 0, completed: 0, failed: 0, progress: 0 },
    enqueueOcrImage: vi.fn(),
    retryAllFailedOcrJobs: vi.fn(),
    clearCompletedOcrJobs: vi.fn(),
  }),
}))

afterEach(() => {
  cleanup()
  platform.native = false
})

describe('import page', () => {
  it('offers individual, camera, and unlimited directory imports', () => {
    const { container } = render(<ImportPage />)

    expect(screen.getByRole('button', { name: '拍照导入' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '选择图片' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导入文件夹' })).toBeInTheDocument()
    const directoryInput = container.querySelector('input[webkitdirectory]')
    expect(directoryInput).toHaveAttribute('multiple')
    expect(directoryInput).not.toHaveAttribute('max')
    expect(screen.getAllByRole('button', { name: /拍照导入|选择图片|导入文件夹/ }).every((button) => button.classList.contains('secondary'))).toBe(true)
    expect(screen.queryByRole('button', { name: '选择报告图片' })).not.toBeInTheDocument()
    expect(screen.queryByText('后台识别说明')).not.toBeInTheDocument()
    expect(screen.queryByText('逐文件请求')).not.toBeInTheDocument()
    expect(screen.getByText('还没有识别任务')).toBeInTheDocument()
  })

  it('hides the redundant directory import on native apps', () => {
    platform.native = true
    const { container } = render(<ImportPage />)

    expect(screen.getByRole('button', { name: '拍照导入' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '选择图片' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '导入文件夹' })).not.toBeInTheDocument()
    expect(container.querySelector('input[webkitdirectory]')).not.toBeInTheDocument()
  })
})
