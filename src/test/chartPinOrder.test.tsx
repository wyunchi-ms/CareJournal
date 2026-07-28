import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppProvider, useApp } from '../store/AppContext'
import type { ChartPin } from '../types'

const storedPins = vi.hoisted(() => new Map<string, ChartPin>())

vi.mock('../db/repository', () => ({
  repository: {
    native: false,
    removePersistedCompletedOcrJobs: vi.fn(),
    list: vi.fn(async (kind: string) => kind === 'pin' ? [...storedPins.values()] : []),
    put: vi.fn(async (kind: string, id: string, payload: ChartPin) => {
      if (kind === 'pin') storedPins.set(id, payload)
    }),
    remove: vi.fn(),
    replaceKind: vi.fn(),
  },
}))

function ChartPinOrderHarness() {
  const { ready, pins, reorderPins } = useApp()
  return <>
    <span>{ready ? pins.map((pin) => pin.title).join('、') : '加载中'}</span>
    <button type="button" onClick={() => void reorderPins(['trend-pin', 'cycle-pin'])}>重排</button>
  </>
}

afterEach(() => {
  cleanup()
  storedPins.clear()
})

describe('saved chart ordering', () => {
  it('loads legacy pins newest-first and persists the explicit user order', async () => {
    storedPins.set('trend-pin', {
      id: 'trend-pin',
      title: '趋势图',
      mode: 'trend',
      indicatorCodes: ['WBC'],
      cycleEventIds: [],
      createdAt: '2026-07-20T00:00:00.000Z',
    })
    storedPins.set('cycle-pin', {
      id: 'cycle-pin',
      title: '周期图',
      mode: 'cycle',
      indicatorCodes: ['HGB'],
      cycleEventIds: ['cycle-1'],
      createdAt: '2026-07-21T00:00:00.000Z',
    })

    render(<AppProvider><ChartPinOrderHarness /></AppProvider>)
    await screen.findByText('周期图、趋势图')
    fireEvent.click(screen.getByRole('button', { name: '重排' }))

    await waitFor(() => expect(screen.getByText('趋势图、周期图')).toBeInTheDocument())
    expect(storedPins.get('trend-pin')?.sortOrder).toBe(0)
    expect(storedPins.get('cycle-pin')?.sortOrder).toBe(1)
  })
})
