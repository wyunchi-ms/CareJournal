import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IndicatorOrganizer } from '../components/IndicatorOrganizer'
import { collectIndicatorGroups, reviewIndicatorMerges, type IndicatorAnalysis, type IndicatorAnalysisOptions } from '../services/indicatorOrganization'
import { DEFAULT_PREFERENCES, type ExamRecord } from '../types'

const { suggest, organize } = vi.hoisted(() => ({ suggest: vi.fn(), organize: vi.fn() }))
let records: ExamRecord[]
vi.mock('../services/indicatorOrganization', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/indicatorOrganization')>(),
  suggestIndicatorMerges: suggest,
}))
vi.mock('../store/AppContext', () => ({
  useApp: () => ({
    records, preferences: DEFAULT_PREFERENCES, organizeIndicators: organize, getIndicatorInventory: () => collectIndicatorGroups(records),
    reviewIndicatorMerges: (merges: IndicatorAnalysis['merges']) => reviewIndicatorMerges(records, merges),
  }),
}))

const analyzed = (merges: IndicatorAnalysis['merges']): IndicatorAnalysis => ({
  inventory: collectIndicatorGroups(records), merges, issues: [], completed: 2, total: 2, stopped: false,
})

beforeEach(() => {
  records = [{
    id: 'test', reportType: '血常规', sampleDate: '2026-10-01', images: [], linkedEventIds: [], fingerprint: '',
    ocrStatus: 'completed', ocrAttempts: 1, createdAt: '', updatedAt: '',
    indicators: ['白细胞总数', '白细胞计数'].map((name, index) => ({
      id: `${index}`, rawName: name, normalizedName: name, normalizedCode: index ? 'WBC' : 'CUSTOM_WBC',
      value: 4, rawValue: '4', unit: '10^9/L', referenceLow: null, referenceHigh: null, referenceText: '', abnormalFlag: 'unknown',
    })),
  }]
  suggest.mockReset()
  organize.mockReset().mockResolvedValue({ recordsUpdated: 1, indicatorsUpdated: 1, chartsUpdated: 1 })
})

describe('indicator organizer confirmation', () => {
  it('offers same-name and known-alias merges without an AI request, including after AI failure', async () => {
    records = [{
      ...records[0],
      indicators: ['CUSTOM_MG', 'MG', 'MAGNESIUM'].map((normalizedCode, index) => ({
        ...records[0].indicators[0], id: `${index}`, normalizedCode, normalizedName: index === 2 ? '镁(MG)' : '镁', unit: 'mmol/L',
      })),
    }]
    suggest.mockRejectedValue(new Error('模型服务不可用'))
    render(<IndicatorOrganizer />)
    fireEvent.click(screen.getByRole('button', { name: '一键整理指标' }))
    expect(screen.getByText('合并建议（2）')).toBeInTheDocument()
    fireEvent.click(screen.getByText('合并建议（2）'))
    expect(screen.getAllByRole('checkbox').every((checkbox) => (checkbox as HTMLInputElement).checked)).toBe(true)
    expect(suggest).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'AI 分析重复指标' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('模型服务不可用')
    fireEvent.click(screen.getByRole('button', { name: '确认整理（2 项合并）' }))
    await waitFor(() => expect(organize).toHaveBeenCalledTimes(1))
    expect(organize.mock.calls[0][0]).toHaveLength(2)
    expect(await screen.findByRole('status')).toHaveTextContent('整理完成')
  })

  it('shows counts and requires a separate confirmation before applying selected suggestions', async () => {
    const inventory = collectIndicatorGroups(records)
    const merge = { sourceId: inventory[0].id, targetId: inventory[1].id, reason: '同义词' }
    suggest.mockResolvedValue(analyzed([merge]))
    render(<IndicatorOrganizer />)
    fireEvent.click(screen.getByRole('button', { name: '一键整理指标' }))
    expect(screen.getByText('共 2 种指标名称、2 次记录。', { exact: false })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'AI 分析重复指标' }))
    await screen.findByText('合并建议（1）')
    expect(organize).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('合并建议（1）'))
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: '确认整理名称' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '确认整理（1 项合并）' }))
    await waitFor(() => expect(organize).toHaveBeenCalledWith([merge], inventory))
    expect(await screen.findByRole('status')).toHaveTextContent('整理完成')
  })

  it('surfaces analysis and persistence failures instead of reporting success', async () => {
    suggest.mockRejectedValueOnce(new Error('模型服务不可用'))
    const inventory = collectIndicatorGroups(records)
    suggest.mockResolvedValueOnce(analyzed([{ sourceId: inventory[0].id, targetId: inventory[1].id, reason: '同义词' }]))
    organize.mockRejectedValue(new Error('数据库写入失败'))
    render(<IndicatorOrganizer />)
    fireEvent.click(screen.getByRole('button', { name: '一键整理指标' }))
    fireEvent.click(screen.getByRole('button', { name: 'AI 分析重复指标' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('模型服务不可用')
    fireEvent.click(screen.getByRole('button', { name: 'AI 分析重复指标' }))
    await screen.findByText('合并建议（1）')
    fireEvent.click(screen.getByRole('button', { name: '确认整理（1 项合并）' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('数据库写入失败')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('disables stale suggestions after a report changes', async () => {
    const inventory = collectIndicatorGroups(records)
    suggest.mockResolvedValue(analyzed([{ sourceId: inventory[0].id, targetId: inventory[1].id, reason: '同义词' }]))
    const { rerender } = render(<IndicatorOrganizer />)
    fireEvent.click(screen.getByRole('button', { name: '一键整理指标' }))
    fireEvent.click(screen.getByRole('button', { name: 'AI 分析重复指标' }))
    await screen.findByText('合并建议（1）')
    records = [{ ...records[0], indicators: [records[0].indicators[0]] }]
    rerender(<IndicatorOrganizer />)
    expect(screen.getByRole('alert')).toHaveTextContent('指标列表已变化')
    expect(screen.getByRole('button', { name: '确认整理（1 项合并）' })).toBeDisabled()
  })

  it('shows iterative progress, unit decisions and per-item issues, then allows stopping without saving', async () => {
    const inventory = collectIndicatorGroups(records)
    const merge = { sourceId: inventory[0].id, targetId: inventory[1].id, reason: '单位补全', unit: '10^9/L' }
    let finish: (result: IndicatorAnalysis) => void = () => undefined
    let options: IndicatorAnalysisOptions
    suggest.mockImplementation((_groups, _llm, callbacks: IndicatorAnalysisOptions) => {
      options = callbacks
      callbacks.onProgress({ ...analyzed([merge]), completed: 1, issues: [{ name: '另一指标', message: '单位无法确认' }] })
      return new Promise<IndicatorAnalysis>((resolve) => { finish = resolve })
    })
    render(<IndicatorOrganizer />)
    fireEvent.click(screen.getByRole('button', { name: '一键整理指标' }))
    fireEvent.click(screen.getByRole('button', { name: 'AI 分析重复指标' }))
    expect(await screen.findByRole('status')).toHaveTextContent('1/2')
    fireEvent.click(screen.getByText('合并建议（1）'))
    expect(screen.getByText('来源及目标统一单位：10^9/L', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('待核对项目（1）')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '停止分析' }))
    expect(options!.isCancelled()).toBe(true)
    finish({ ...analyzed([merge]), stopped: true, completed: 1 })
    expect(await screen.findByText('分析已停止', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('合并建议（1）').closest('details')).not.toHaveAttribute('open')
    expect(organize).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认整理（1 项调整）' }))
    await waitFor(() => expect(organize).toHaveBeenCalledWith([merge], inventory))
  })

  it('selects all AI suggestions including missing units, collapses the review, and still requires confirmation', async () => {
    records = [{ ...records[0], indicators: records[0].indicators.map((indicator) => ({ ...indicator, unit: '' })) }]
    const inventory = collectIndicatorGroups(records)
    const merge = { sourceId: inventory[0].id, targetId: inventory[1].id, reason: '参考同项单位，需核对原报告', unit: '10^9/L' }
    suggest.mockResolvedValue(analyzed([merge]))
    render(<IndicatorOrganizer />)
    fireEvent.click(screen.getByRole('button', { name: '一键整理指标' }))
    fireEvent.click(screen.getByRole('button', { name: 'AI 分析重复指标' }))
    await screen.findByText('合并建议（1）')
    expect(screen.getByText('合并建议（1）').closest('details')).not.toHaveAttribute('open')
    expect(screen.getByText('建议默认全选', { exact: false })).toBeVisible()
    fireEvent.click(screen.getByText('合并建议（1）'))
    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(screen.getByRole('button', { name: '确认整理（1 项调整）' })).toBeEnabled()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: '确认整理名称' })).toBeDisabled()
    expect(organize).not.toHaveBeenCalled()
  })

  it('displays indicators in descending frequency without changing the inventory sent for analysis', async () => {
    records[0].indicators.push(
      { ...records[0].indicators[1], id: 'extra-1' },
      { ...records[0].indicators[1], id: 'extra-2' },
    )
    const inventory = collectIndicatorGroups(records)
    suggest.mockResolvedValue(analyzed([]))
    render(<IndicatorOrganizer />)
    fireEvent.click(screen.getByRole('button', { name: '一键整理指标' }))
    expect(Array.from(document.querySelectorAll('.indicator-inventory-row strong')).map((item) => item.textContent)).toEqual(['白细胞计数', '白细胞总数'])
    fireEvent.click(screen.getByRole('button', { name: 'AI 分析重复指标' }))
    await screen.findByText('未发现可安全合并的重复指标')
    expect(suggest.mock.calls[0][0]).toEqual(inventory)
  })

  it.each([
    { count: 1, status: '已保存可安全整理的部分' },
    { count: 0, status: '本次没有可安全保存的调整' },
  ])('reports $count safe changes and keeps skipped groups visible after confirmation', async ({ count, status }) => {
    const inventory = collectIndicatorGroups(records)
    suggest.mockResolvedValue(analyzed([{ sourceId: inventory[0].id, targetId: inventory[1].id, reason: '同项' }]))
    organize.mockResolvedValue({
      recordsUpdated: count, indicatorsUpdated: count, chartsUpdated: count, skippedGroups: 1,
      issues: [{ name: '前白蛋白', message: '参考范围需要核对，整组未修改' }],
    })
    render(<IndicatorOrganizer />)
    fireEvent.click(screen.getByRole('button', { name: '一键整理指标' }))
    fireEvent.click(screen.getByRole('button', { name: 'AI 分析重复指标' }))
    await screen.findByText('合并建议（1）')
    fireEvent.click(screen.getByRole('button', { name: '确认整理（1 项合并）' }))
    expect(await screen.findByRole('status')).toHaveTextContent(status)
    expect(screen.getByRole('status')).toHaveTextContent(/1 组(?:已)?跳过/)
    expect(screen.getByText('待核对项目（1）')).toBeVisible()
    expect(screen.getByText('前白蛋白')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('retains analysis-time conversion issues after saving the remaining suggestions', async () => {
    const inventory = collectIndicatorGroups(records)
    const result = analyzed([{ sourceId: inventory[0].id, targetId: inventory[1].id, reason: '同项' }])
    result.issues.push({ name: '前白蛋白', message: '参考范围需要核对，整组未修改' })
    suggest.mockResolvedValue(result)
    render(<IndicatorOrganizer />)
    fireEvent.click(screen.getByRole('button', { name: '一键整理指标' }))
    fireEvent.click(screen.getByRole('button', { name: 'AI 分析重复指标' }))
    await screen.findByText('合并建议（1）')
    fireEvent.click(screen.getByRole('button', { name: '确认整理（1 项合并）' }))
    expect(await screen.findByRole('status')).toHaveTextContent('尚有需核对项目未处理')
    expect(screen.getByText('前白蛋白')).toBeVisible()
  })
})
