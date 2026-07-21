import { describe, expect, it } from 'vitest'
import { normalizeReportType } from '../data/reportTypeAliases'

describe('report type normalization', () => {
  it.each([
    ['实验室检验', '实验室检查'],
    ['实验室检验报告', '实验室检查'],
    ['血细胞分析', '血常规'],
    ['血细胞分析（五分类以上）', '血常规'],
    ['生化五套', '生化检查'],
    ['血气+电解质检验报告', '血气及电解质'],
    ['MRI', '磁共振（MRI）'],
    ['PET-CT', 'PET-CT'],
  ])('maps %s to %s', (raw, expected) => {
    expect(normalizeReportType(raw).label).toBe(expected)
  })

  it('keeps unknown hospital-specific names available as their own type', () => {
    expect(normalizeReportType('循环肿瘤 DNA 检测').label).toBe('循环肿瘤 DNA 检测')
  })
})
