import { describe, expect, it } from 'vitest'
import { moveChartIndicator, sortChartIndicators, type ChartIndicatorOption } from '../services/chartIndicators'

const option = (code: string, name: string, count: number): ChartIndicatorOption => ({ code, name, count, unit: '' })

describe('chart indicator priority', () => {
  it('puts pins first, then manual order, common presets, occurrence count and name', () => {
    const indicators = [
      option('CUSTOM_A', '自定义甲', 2),
      option('CUSTOM_B', '自定义乙', 20),
      option('WBC', '白细胞计数', 1),
      option('HGB', '血红蛋白', 1),
      option('CUSTOM_C', '自定义丙', 5),
    ]

    expect(sortChartIndicators(indicators, [], []).map((item) => item.code)).toEqual(['WBC', 'HGB', 'CUSTOM_B', 'CUSTOM_C', 'CUSTOM_A'])
    expect(sortChartIndicators(indicators, ['CUSTOM_A', 'WBC'], ['CUSTOM_C', 'HGB']).map((item) => item.code)).toEqual(['CUSTOM_C', 'HGB', 'CUSTOM_A', 'WBC', 'CUSTOM_B'])
  })

  it('moves one stable code without losing any options', () => {
    expect(moveChartIndicator(['WBC', 'HGB', 'PLT'], 'PLT', 'WBC')).toEqual(['PLT', 'WBC', 'HGB'])
    expect(moveChartIndicator(['WBC', 'HGB'], 'missing', 'WBC')).toEqual(['WBC', 'HGB'])
  })
})
