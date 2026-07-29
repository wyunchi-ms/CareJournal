import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { ImportPage } from '../pages/ImportPage'

const platform = vi.hoisted(() => ({ native: false }))
const folderImport = vi.hoisted(() => ({
  pick: vi.fn(),
}))
const appState = vi.hoisted(() => ({
  ocrJobs: [] as Array<Record<string, unknown>>,
  configured: false,
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => platform.native,
    getPlatform: () => platform.native ? 'android' : 'web',
    convertFileSrc: (value: string) => value,
  },
  registerPlugin: () => ({}),
}))

vi.mock('../services/folderImport', () => ({
  canImportAndroidFolder: () => platform.native,
  folderSourceToStoredImage: (source: { name: string; mimeType: string; uri: string; sourceKey: string; relativePath: string }) => ({
    id: source.sourceKey,
    name: source.name,
    mimeType: source.mimeType,
    dataUrl: '',
    sha256: '',
    sourceUri: source.uri,
    sourceKey: source.sourceKey,
    relativePath: source.relativePath,
  }),
  pickAndroidImageFolder: folderImport.pick,
}))

const enqueueOcrImage = vi.fn()

vi.mock('../store/AppContext', () => ({
  useApp: () => ({
    preferences: {
      llm: {
        activeProvider: 'azure-openai',
        providers: {
          'azure-openai': {
            endpoint: appState.configured ? 'https://example.openai.azure.com/openai/v1' : '',
            apiKey: appState.configured ? 'key' : '',
            model: appState.configured ? 'model' : '',
            maxRetries: 3,
          },
        },
      },
    },
    ocrJobs: appState.ocrJobs,
    ocrQueueStats: { total: appState.ocrJobs.length, queued: appState.ocrJobs.length, processing: 0, completed: 0, failed: 0, progress: 0 },
    enqueueOcrImage,
    retryOcrJob: vi.fn(),
    removeOcrJob: vi.fn(),
    retryAllFailedOcrJobs: vi.fn(),
    clearCompletedOcrJobs: vi.fn(),
  }),
}))

function renderImportPage() {
  return render(<MemoryRouter><ImportPage /></MemoryRouter>)
}

afterEach(() => {
  cleanup()
  platform.native = false
  folderImport.pick.mockReset()
  enqueueOcrImage.mockReset()
  appState.ocrJobs = []
  appState.configured = false
})

describe('import page', () => {
  it('offers individual, camera, and unlimited directory imports', () => {
    const { container } = renderImportPage()

    expect(screen.getByRole('button', { name: '拍照导入' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '选择图片/PDF' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导入文件夹' })).toBeInTheDocument()
    expect(container.querySelector('input[accept="image/*,application/pdf,.pdf"]')).toHaveAttribute('multiple')
    const directoryInput = container.querySelector('input[webkitdirectory]')
    expect(directoryInput).toHaveAttribute('multiple')
    expect(directoryInput).not.toHaveAttribute('max')
    expect(screen.getAllByRole('button', { name: /拍照导入|选择图片\/PDF|导入文件夹/ }).every((button) => button.classList.contains('secondary'))).toBe(true)
    expect(screen.queryByRole('button', { name: '选择报告图片' })).not.toBeInTheDocument()
    expect(screen.queryByText('后台识别说明')).not.toBeInTheDocument()
    expect(screen.queryByText('逐文件请求')).not.toBeInTheDocument()
    expect(screen.getByText('还没有识别任务')).toBeInTheDocument()
    expect(screen.getByText(/文件会按顺序加入后台识别队列/)).toBeInTheDocument()
  })

  it('uses native recursive folder scanning instead of a web directory input on Android', () => {
    platform.native = true
    const { container } = renderImportPage()

    expect(screen.getByRole('button', { name: '拍照导入' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '选择图片/PDF' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '扫描文件夹' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '导入文件夹' })).not.toBeInTheDocument()
    expect(container.querySelector('input[webkitdirectory]')).not.toBeInTheDocument()
  })

  it('queues every image returned by the Android folder scan without loading image data', async () => {
    platform.native = true
    enqueueOcrImage.mockResolvedValue(true)
    folderImport.pick.mockResolvedValue({
      cancelled: false,
      folderName: '检查报告',
      files: [
        { uri: 'content://one', name: '1.jpg', mimeType: 'image/jpeg', relativePath: '1.jpg', size: 10, lastModified: 1, sourceKey: 'one' },
        { uri: 'content://two', name: '2.jpg', mimeType: 'image/jpeg', relativePath: '子目录/2.jpg', size: 20, lastModified: 2, sourceKey: 'two' },
      ],
    })
    renderImportPage()

    fireEvent.click(screen.getByRole('button', { name: '扫描文件夹' }))

    await waitFor(() => expect(enqueueOcrImage).toHaveBeenCalledTimes(2))
    expect(enqueueOcrImage.mock.calls[0][0]).toMatchObject({ sourceUri: 'content://one', dataUrl: '' })
    expect(enqueueOcrImage.mock.calls[1][0]).toMatchObject({ sourceUri: 'content://two', relativePath: '子目录/2.jpg', dataUrl: '' })
    expect(await screen.findByText(/扫描到 2 张图片，已加入 2 张/)).toBeInTheDocument()
  })

  it('truncates long queue filenames while exposing the full name on hover, focus, or tap', () => {
    const longName = '2026-07-23_12-28-54_e39a2c7de19f65b0683cd93e8735f348.jpg'
    appState.ocrJobs = [{
      id: 'long-file',
      image: { id: 'image-1', name: longName, mimeType: 'image/jpeg', dataUrl: '', sha256: '' },
      status: 'queued',
      phase: 'waiting',
      progress: 0,
      attempts: 0,
      resultRecordIds: [],
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z',
    }]

    renderImportPage()

    const filename = screen.getByRole('button', { name: `查看完整文件名：${longName}` })
    const tooltip = screen.getByRole('tooltip')
    expect(filename).toHaveClass('ocr-job-filename')
    expect(filename).toHaveAttribute('aria-describedby', tooltip.id)
    expect(tooltip).toHaveTextContent(longName)
  })

  it('immediately guides unconfigured users to LLM settings', () => {
    renderImportPage()

    expect(screen.getByRole('alert')).toHaveTextContent('识别检查报告前需要配置 LLM')
    expect(screen.getByRole('link', { name: '去配置 LLM' })).toHaveAttribute('href', '/settings#llm-settings')
  })

  it('accepts a PDF and adds it to the same background queue', async () => {
    enqueueOcrImage.mockResolvedValue(true)
    const { container } = renderImportPage()
    const input = container.querySelector<HTMLInputElement>('input[accept="image/*,application/pdf,.pdf"]')!
    const pdf = new File(['%PDF-1.4 test'], '检查报告.pdf', { type: 'application/pdf' })

    fireEvent.change(input, { target: { files: [pdf] } })

    await waitFor(() => expect(enqueueOcrImage).toHaveBeenCalledTimes(1))
    expect(enqueueOcrImage.mock.calls[0][0]).toMatchObject({
      name: '检查报告.pdf',
      mimeType: 'application/pdf',
    })
    expect(await screen.findByText(/已加入 1 个文件/)).toBeInTheDocument()
  })

  it('opens queued PDFs in the same in-app preview', () => {
    appState.ocrJobs = [{
      id: 'pdf-job',
      image: { id: 'pdf-1', name: '检查报告.pdf', mimeType: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0xLjQ=', sha256: 'pdf-1' },
      status: 'queued',
      phase: 'waiting',
      progress: 0,
      attempts: 0,
      resultRecordIds: [],
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z',
    }]
    renderImportPage()

    fireEvent.click(screen.getByRole('button', { name: '预览 PDF：检查报告.pdf' }))

    expect(screen.getByRole('dialog', { name: 'PDF 预览' })).toBeInTheDocument()
  })
})
