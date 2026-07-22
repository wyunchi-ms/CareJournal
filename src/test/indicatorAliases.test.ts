import { describe, expect, it } from 'vitest'
import { normalizeIndicator } from '../data/indicatorAliases'

describe('normalizeIndicator', () => {
  it('将医院常用缩写归一化为标准指标', () => {
    expect(normalizeIndicator('NEUT#')).toMatchObject({ code: 'NEUT_ABS', name: '中性粒细胞绝对值' })
    expect(normalizeIndicator('血色素')).toMatchObject({ code: 'HGB', name: '血红蛋白' })
  })

  it('保留无法识别的原始指标', () => {
    expect(normalizeIndicator('某院特殊指标')).toMatchObject({ name: '某院特殊指标' })
    expect(normalizeIndicator('某院特殊指标').code).toMatch(/^CUSTOM_/)
  })

  it('医院原始名称优先于模型提出的错误标准代码', () => {
    expect(normalizeIndicator('血色素', 'PLT', '血小板计数')).toMatchObject({ code: 'HGB', name: '血红蛋白' })
    expect(normalizeIndicator('某院特殊指标', 'OTHER', '其他指标')).toMatchObject({ name: '某院特殊指标' })
  })
})
