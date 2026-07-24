import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import App from '../App'
import { Modal } from '../components/Modal'

const nativeApp = vi.hoisted(() => ({
  backButtonListener: undefined as (() => void) | undefined,
  exitApp: vi.fn(async () => undefined),
  removeListener: vi.fn(async () => undefined),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}))

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (_event: string, listener: () => void) => {
      nativeApp.backButtonListener = listener
      return { remove: nativeApp.removeListener }
    }),
    exitApp: nativeApp.exitApp,
  },
}))

vi.mock('../store/AppContext', () => ({
  useApp: () => ({
    ready: true,
    startupMessage: '',
    storageError: null,
    ocrQueueStats: { queued: 0, processing: 0, completed: 0, failed: 0, progress: 0 },
  }),
}))

vi.mock('../pages/CalendarPage', () => ({ CalendarPage: () => <h1>病程页面</h1> }))
vi.mock('../pages/RecordsPage', () => ({ RecordsPage: () => <h1>检查页面</h1> }))
vi.mock('../pages/SettingsPage', () => ({ SettingsPage: () => <h1>设置页面</h1> }))
vi.mock('../pages/ChemotherapyTemplatesPage', () => ({ ChemotherapyTemplatesPage: () => <h1>方案页面</h1> }))
vi.mock('../pages/ChartsPage', () => ({ ChartsPage: () => <h1>图表页面</h1> }))
vi.mock('../pages/ImportPage', () => ({ ImportPage: () => <h1>导入页面</h1> }))

function AppWithModal() {
  const [open, setOpen] = useState(true)
  return <>
    <App />
    {open && <Modal title="测试弹窗" onClose={() => setOpen(false)}>弹窗内容</Modal>}
  </>
}

function AppWithHistoryControl() {
  const navigate = useNavigate()
  return <>
    <button type="button" onClick={() => navigate(-1)}>浏览器返回</button>
    <App />
  </>
}

afterEach(() => {
  cleanup()
  nativeApp.backButtonListener = undefined
  nativeApp.exitApp.mockClear()
  nativeApp.removeListener.mockClear()
})

describe('Android app back navigation', () => {
  it('closes the top modal before navigating or exiting', async () => {
    render(<MemoryRouter initialEntries={['/calendar']}><AppWithModal /></MemoryRouter>)
    await act(async () => Promise.resolve())

    expect(screen.getByRole('dialog', { name: '测试弹窗' })).toBeInTheDocument()
    act(() => nativeApp.backButtonListener?.())

    expect(screen.queryByRole('dialog', { name: '测试弹窗' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '病程页面' })).toBeInTheDocument()
    expect(nativeApp.exitApp).not.toHaveBeenCalled()
  })

  it('returns through the actual in-app route order before exiting', async () => {
    render(<MemoryRouter initialEntries={['/calendar']}><App /></MemoryRouter>)
    await act(async () => Promise.resolve())

    fireEvent.click(screen.getByRole('link', { name: '检查' }))
    fireEvent.click(screen.getByRole('link', { name: '设置' }))
    expect(screen.getByRole('heading', { name: '设置页面' })).toBeInTheDocument()

    act(() => nativeApp.backButtonListener?.())
    expect(screen.getByRole('heading', { name: '检查页面' })).toBeInTheDocument()
    expect(nativeApp.exitApp).not.toHaveBeenCalled()

    act(() => nativeApp.backButtonListener?.())
    expect(screen.getByRole('heading', { name: '病程页面' })).toBeInTheDocument()
    expect(nativeApp.exitApp).not.toHaveBeenCalled()

    act(() => nativeApp.backButtonListener?.())
    expect(nativeApp.exitApp).toHaveBeenCalledOnce()
  })

  it('keeps the Android route trail in sync after a browser-history return', async () => {
    render(<MemoryRouter initialEntries={['/calendar']}><AppWithHistoryControl /></MemoryRouter>)
    await act(async () => Promise.resolve())

    fireEvent.click(screen.getByRole('link', { name: '检查' }))
    fireEvent.click(screen.getByRole('link', { name: '设置' }))
    fireEvent.click(screen.getByRole('button', { name: '浏览器返回' }))
    expect(screen.getByRole('heading', { name: '检查页面' })).toBeInTheDocument()

    act(() => nativeApp.backButtonListener?.())
    expect(screen.getByRole('heading', { name: '病程页面' })).toBeInTheDocument()

    act(() => nativeApp.backButtonListener?.())
    expect(nativeApp.exitApp).toHaveBeenCalledOnce()
  })
})
