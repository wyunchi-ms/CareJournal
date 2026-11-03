import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProvider, useApp } from '../store/AppContext'
import { collectIndicatorGroups, suggestLocalIndicatorMerges } from '../services/indicatorOrganization'
import { DEFAULT_PREFERENCES, type ExamRecord } from '../types'

const { stored, putMany } = vi.hoisted(() => ({ stored: new Map<string, unknown>(), putMany: vi.fn() }))
vi.mock('../db/repository', async (importOriginal) => ({
  ...await importOriginal<typeof import('../db/repository')>(),
  repository: {
    native: false,
    removePersistedCompletedOcrJobs: vi.fn(),
    list: vi.fn(async (kind: string) => [...stored.entries()].filter(([key]) => key.startsWith(`${kind}:`)).map(([, value]) => value)),
    put: vi.fn(async (kind: string, id: string, payload: unknown) => { stored.set(`${kind}:${id}`, payload) }),
    remove: vi.fn(),
    replaceKind: vi.fn(),
    putMany,
  },
}))

function Harness({ local = false, unit, includeUnsafe = false }: { local?: boolean; unit?: string; includeUnsafe?: boolean }) {
  const { ready, records, pins, preferences, organizeIndicators } = useApp()
  return <>
    <span>{ready ? 'ready' : 'loading'}</span>
    <output data-testid="names">{records.flatMap((record) => record.indicators.map((indicator) => indicator.normalizedName)).join(',')}</output>
    <output data-testid="codes">{records.flatMap((record) => record.indicators.map((indicator) => indicator.normalizedCode)).join(',')}</output>
    <output data-testid="values">{records.flatMap((record) => record.indicators.map((indicator) => indicator.value)).join(',')}</output>
    <output data-testid="chart">{pins[0]?.title}</output>
    <output data-testid="priority">{preferences.chartPinnedIndicatorCodes.join(',')}</output>
    <button onClick={() => {
      const groups = collectIndicatorGroups(records)
      const source = groups.find((group) => group.code.startsWith('CUSTOM_'))
      const target = groups.find((group) => group.code === source?.code.replace(/^CUSTOM_/, '')) ?? groups.find((group) => group.id !== source?.id)
      const merges = local ? suggestLocalIndicatorMerges(groups) : [{
        sourceId: source!.id, targetId: target!.id, reason: '同义词', ...(unit === undefined ? {} : { unit }),
      }]
      if (includeUnsafe) merges.push({
        sourceId: groups.find((group) => group.code === 'P_A')!.id,
        targetId: groups.find((group) => group.code === 'P_B')!.id,
        reason: '统一单位', unit: 'mg/L',
      })
      void organizeIndicators(merges, groups)
        .then((result) => { document.title = result.skippedGroups ? `saved-with-skips:${result.skippedGroups}` : 'saved' })
        .catch((error: Error) => { document.title = error.message })
    }}>整理</button>
  </>
}

beforeEach(() => {
  stored.clear()
  document.title = ''
  stored.set('preferences:main', { ...DEFAULT_PREFERENCES, chartPinnedIndicatorCodes: ['CUSTOM_WBC'] })
  stored.set('record:report', {
    id: 'report', reportType: '血常规', sampleDate: '2026-10-01', images: [], linkedEventIds: [], fingerprint: 'original',
    ocrStatus: 'completed', ocrAttempts: 1, createdAt: '', updatedAt: '',
    indicators: ['CUSTOM_WBC', 'WBC'].map((normalizedCode, index) => ({
      id: `${index}`, normalizedCode, normalizedName: index ? '白细胞计数' : '白细胞总数', rawName: '原名称',
      value: 4, rawValue: '4', unit: '10^9/L', referenceLow: null, referenceHigh: null, referenceText: '', abnormalFlag: 'unknown',
    })),
  })
  stored.set('pin:chart', { id: 'chart', title: '白细胞总数趋势', mode: 'trend', indicatorCodes: ['CUSTOM_WBC'], cycleEventIds: [], createdAt: '' })
  putMany.mockReset().mockImplementation(async (writes: Array<{ kind: string; id: string; payload: unknown }>) => {
    for (const write of writes) stored.set(`${write.kind}:${write.id}`, write.payload)
  })
})

describe('persisting indicator organization', () => {
  it('does not write anything when every selected group is unsafe and no names require cleanup', async () => {
    const original = stored.get('record:report') as ExamRecord
    const problematic = {
      ...original, indicators: original.indicators.map((item, index) => ({
        ...item, referenceText: index ? '年龄18岁分层，详见报告' : '',
      })),
    }
    stored.set('record:report', problematic)
    render(<AppProvider><Harness unit="10^12/L" /></AppProvider>)
    await screen.findByText('ready')
    fireEvent.click(screen.getByRole('button', { name: '整理' }))
    await waitFor(() => expect(document.title).toBe('saved-with-skips:1'))
    expect(putMany).not.toHaveBeenCalled()
    expect(stored.get('record:report')).toBe(problematic)
    expect(screen.getByTestId('codes')).toHaveTextContent('CUSTOM_WBC,WBC')
    expect(screen.getByTestId('priority')).toHaveTextContent('CUSTOM_WBC')
  })

  it('saves safe adjustments transactionally even when another group has an unconvertible reference', async () => {
    stored.set('record:report', {
      id: 'report', reportType: '检查', sampleDate: '2026-10-01', images: [], linkedEventIds: [], fingerprint: 'original',
      ocrStatus: 'completed', ocrAttempts: 1, createdAt: '', updatedAt: '',
      indicators: [
        ...['CUSTOM_WBC', 'WBC'].map((normalizedCode, index) => ({
          id: `wbc-${index}`, normalizedCode, normalizedName: index ? '白细胞计数' : '白细胞总数', rawName: '白细胞',
          value: 4, rawValue: '4', unit: '10^9/L', referenceLow: 3, referenceHigh: 9, referenceText: '3–9', abnormalFlag: 'normal',
        })),
        ...['P_A', 'P_B'].map((normalizedCode, index) => ({
          id: `prealb-${index}`, normalizedCode, normalizedName: index ? '前白蛋白' : '前白蛋白缩写', rawName: '前白蛋白',
          value: 0.2, rawValue: '0.2', unit: index ? 'g/L' : 'mg/L', referenceLow: 0.1, referenceHigh: 0.3,
          referenceText: index ? '年龄18岁分层，详见报告' : '0.1–0.3', abnormalFlag: 'normal',
        })),
      ],
    })
    const view = render(<AppProvider><Harness includeUnsafe /></AppProvider>)
    await screen.findByText('ready')
    fireEvent.click(screen.getByRole('button', { name: '整理' }))
    await waitFor(() => expect(document.title).toBe('saved-with-skips:1'))
    expect(putMany).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('codes')).toHaveTextContent('WBC,WBC,P_A,P_B')
    expect(stored.get('record:report')).toMatchObject({
      indicators: [{ normalizedCode: 'WBC' }, { normalizedCode: 'WBC' }, { unit: 'mg/L', value: 0.2 }, { unit: 'g/L', value: 0.2 }],
    })
    view.unmount()
    render(<AppProvider><Harness includeUnsafe /></AppProvider>)
    await screen.findByText('ready')
    expect(screen.getByTestId('codes')).toHaveTextContent('WBC,WBC,P_A,P_B')
  })

  it('stores converted units, values and original measurements in the same transaction and restores them', async () => {
    stored.set('record:report', {
      id: 'report', reportType: '检查', sampleDate: '2026-10-01', images: [], linkedEventIds: [], fingerprint: 'original',
      ocrStatus: 'completed', ocrAttempts: 1, createdAt: '', updatedAt: '',
      indicators: ['CUSTOM_CHE', 'CHE'].map((normalizedCode, index) => ({
        id: `${index}`, normalizedCode, normalizedName: index ? '胆碱酯酶' : '胆碱酯酶(CHE)', rawName: '胆碱酯酶',
        value: 4, rawValue: '4', unit: index ? 'U/L' : 'kU/L',
        referenceLow: 1, referenceHigh: 5, referenceText: '1–5', abnormalFlag: 'normal',
      })),
    })
    stored.set('preferences:main', { ...DEFAULT_PREFERENCES, chartPinnedIndicatorCodes: ['CUSTOM_CHE'] })
    stored.set('pin:chart', { id: 'chart', title: '胆碱酯酶(CHE)趋势', mode: 'trend', indicatorCodes: ['CUSTOM_CHE'], cycleEventIds: [], createdAt: '' })
    const view = render(<AppProvider><Harness unit="U/L" /></AppProvider>)
    await screen.findByText('ready')
    fireEvent.click(screen.getByRole('button', { name: '整理' }))
    await waitFor(() => expect(document.title).toBe('saved'))
    expect(putMany).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('values')).toHaveTextContent('4000,4')
    expect(screen.getByTestId('codes')).toHaveTextContent('CHE,CHE')
    expect(stored.get('record:report')).toMatchObject({
      indicators: [{ unit: 'U/L', referenceLow: 1000, originalMeasurement: { unit: 'kU/L', value: 4 } }, { unit: 'U/L' }],
    })
    view.unmount()
    render(<AppProvider><Harness unit="U/L" /></AppProvider>)
    await screen.findByText('ready')
    expect(screen.getByTestId('values')).toHaveTextContent('4000,4')
    expect(screen.getByTestId('priority')).toHaveTextContent('CHE')
  })

  it('persists same-name code consolidation so reopening does not split the chart again', async () => {
    stored.set('record:report', {
      id: 'report', reportType: '检查', sampleDate: '2026-10-01', images: [], linkedEventIds: [], fingerprint: 'original',
      ocrStatus: 'completed', ocrAttempts: 1, createdAt: '', updatedAt: '',
      indicators: ['CUSTOM_MG', 'MG'].map((normalizedCode, index) => ({
        id: `${index}`, normalizedCode, normalizedName: '镁', rawName: '镁',
        value: 1, rawValue: '1', unit: 'mmol/L', referenceLow: null, referenceHigh: null, referenceText: '', abnormalFlag: 'unknown',
      })),
    })
    stored.set('preferences:main', { ...DEFAULT_PREFERENCES, chartPinnedIndicatorCodes: ['CUSTOM_MG'] })
    stored.set('pin:chart', { id: 'chart', title: '镁趋势', mode: 'trend', indicatorCodes: ['CUSTOM_MG'], cycleEventIds: [], createdAt: '' })
    const view = render(<AppProvider><Harness local /></AppProvider>)
    await screen.findByText('ready')
    fireEvent.click(screen.getByRole('button', { name: '整理' }))
    await waitFor(() => expect(document.title).toBe('saved'))
    expect(screen.getByTestId('codes')).toHaveTextContent('MG,MG')
    expect(screen.getByTestId('priority')).toHaveTextContent('MG')
    expect(stored.get('pin:chart')).toMatchObject({ indicatorCodes: ['MG'] })
    view.unmount()
    render(<AppProvider><Harness local /></AppProvider>)
    await screen.findByText('ready')
    expect(screen.getByTestId('codes')).toHaveTextContent('MG,MG')
    expect(screen.getByTestId('names')).toHaveTextContent('镁,镁')
  })

  it('persists reports, chart titles and chart priorities together and restores them on reopen', async () => {
    const view = render(<AppProvider><Harness /></AppProvider>)
    await screen.findByText('ready')
    fireEvent.click(screen.getByRole('button', { name: '整理' }))
    await waitFor(() => expect(document.title).toBe('saved'))
    expect(putMany).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('names')).toHaveTextContent('白细胞计数,白细胞计数')
    expect(screen.getByTestId('chart')).toHaveTextContent('白细胞计数趋势')
    expect(screen.getByTestId('priority')).toHaveTextContent('WBC')
    view.unmount()
    render(<AppProvider><Harness /></AppProvider>)
    await screen.findByText('ready')
    expect(screen.getByTestId('names')).toHaveTextContent('白细胞计数,白细胞计数')
    expect(screen.getByTestId('chart')).toHaveTextContent('白细胞计数趋势')
  })

  it('does not publish partial UI changes if the batch transaction fails', async () => {
    putMany.mockRejectedValueOnce(new Error('disk full'))
    render(<AppProvider><Harness /></AppProvider>)
    await screen.findByText('ready')
    fireEvent.click(screen.getByRole('button', { name: '整理' }))
    await waitFor(() => expect(document.title).toBe('disk full'))
    expect(screen.getByTestId('names')).toHaveTextContent('白细胞总数,白细胞计数')
    expect(screen.getByTestId('chart')).toHaveTextContent('白细胞总数趋势')
    expect(screen.getByTestId('priority')).toHaveTextContent('CUSTOM_WBC')
  })
})
