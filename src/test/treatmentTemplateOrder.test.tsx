import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppProvider, useApp } from '../store/AppContext'
import type { ChemotherapyTemplate } from '../types'

const storedTemplates = vi.hoisted(() => new Map<string, ChemotherapyTemplate>())

vi.mock('../db/repository', () => ({
  repository: {
    native: false,
    removePersistedCompletedOcrJobs: vi.fn(),
    list: vi.fn(async (kind: string) => kind === 'chemotherapyTemplate' ? [...storedTemplates.values()] : []),
    put: vi.fn(async (kind: string, id: string, payload: ChemotherapyTemplate) => {
      if (kind === 'chemotherapyTemplate') storedTemplates.set(id, payload)
    }),
    remove: vi.fn(),
    replaceKind: vi.fn(),
  },
}))

function TemplateOrderHarness() {
  const { ready, chemotherapyTemplates, reorderChemotherapyTemplates } = useApp()
  return <>
    <span>{ready ? chemotherapyTemplates.map((template) => template.name).join('、') : '加载中'}</span>
    <button type="button" onClick={() => void reorderChemotherapyTemplates(['template-b', 'template-a'])}>重排</button>
  </>
}

afterEach(() => {
  cleanup()
  storedTemplates.clear()
})

describe('treatment template ordering', () => {
  it('loads and persists the explicit user order', async () => {
    const base = {
      cycleLengthDays: 21,
      administrationDays: [1],
      defaultCycleCount: 1,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    }
    storedTemplates.set('template-b', { ...base, id: 'template-b', name: '方案 B', sortOrder: 1 })
    storedTemplates.set('template-a', { ...base, id: 'template-a', name: '方案 A', sortOrder: 0 })

    render(<AppProvider><TemplateOrderHarness /></AppProvider>)
    await screen.findByText('方案 A、方案 B')
    fireEvent.click(screen.getByRole('button', { name: '重排' }))

    await waitFor(() => expect(screen.getByText('方案 B、方案 A')).toBeInTheDocument())
    expect(storedTemplates.get('template-b')?.sortOrder).toBe(0)
    expect(storedTemplates.get('template-a')?.sortOrder).toBe(1)
  })
})
