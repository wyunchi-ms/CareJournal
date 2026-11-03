import { describe, expect, it } from 'vitest'
import { normalizeIndicator } from '../data/indicatorAliases'
import { editedIndicator, indicatorDraft, parseReferenceRange } from '../services/indicatorEditing'
import { cleanIndicatorName } from '../services/indicatorNames'
import { resultText } from '../services/recordDisplay'
import type { LabIndicator } from '../types'

const original: LabIndicator = {
  id: 'wbc', rawName: '*WBC', normalizedCode: 'WBC', normalizedName: '白细胞计数',
  value: 4, rawValue: '4.00* ↑', unit: '10^9/L', referenceLow: 3.5, referenceHigh: 9.5,
  referenceText: '3.5–9.5', abnormalFlag: 'high',
}

describe('indicator name and reference editing', () => {
  it('removes decoration without stripping clinical symbols or the original source name', () => {
    expect(normalizeIndicator(' ＊白细胞＊ ', 'OTHER', '其他指标')).toMatchObject({ code: 'WBC', name: '白细胞计数' })
    expect(normalizeIndicator('*NEUT#*', 'OTHER', '其他指标').code).toBe('NEUT_ABS')
    expect(cleanIndicatorName('※ NEUT% ↑')).toBe('NEUT%')
    expect(cleanIndicatorName('β2-微球蛋白（血清）')).toBe('β2-微球蛋白（血清）')
    expect(cleanIndicatorName('anti-HBc IgM (+)')).toBe('anti-HBc IgM (+)')
    expect(resultText(original)).toBe('4.00')
    const saved = editedIndicator({ ...indicatorDraft(original), normalizedName: '*白细胞总数*' }, original)
    expect(saved).toMatchObject({ rawName: '*WBC', normalizedName: '白细胞总数', abnormalFlag: 'normal' })
  })

  it.each([
    ['3.5～9.5', 3.5, 9.5], ['-2.5–-1', -2.5, -1], ['1e-3 to 2e-3', 0.001, 0.002],
    ['≤5', null, 5], ['>=0', 0, null], ['阴性', null, null], ['', null, null],
  ])('parses one reference field: %s', (text, low, high) => {
    expect(parseReferenceRange(String(text))).toEqual({ referenceLow: low, referenceHigh: high })
  })

  it('derives status again after range edits and handles strict and inclusive bounds', () => {
    const draft = indicatorDraft(original)
    expect(editedIndicator({ ...draft, referenceText: '1–3' }, original).abnormalFlag).toBe('high')
    expect(editedIndicator({ ...draft, referenceText: '≤4' }, original).abnormalFlag).toBe('normal')
    expect(editedIndicator({ ...draft, referenceText: '<4' }, original).abnormalFlag).toBe('high')
    expect(editedIndicator({ ...draft, referenceText: '>4' }, original).abnormalFlag).toBe('low')
    expect(editedIndicator({ ...draft, referenceText: '' }, original)).toMatchObject({
      referenceLow: null, referenceHigh: null, abnormalFlag: 'unknown',
    })
    expect(parseReferenceRange('3.5–9.5 10^9/L', '10^9/L')).toEqual({ referenceLow: 3.5, referenceHigh: 9.5 })
    expect(() => editedIndicator({ ...draft, referenceText: '9.5–3.5' }, original)).toThrow('下限不能大于上限')
  })

  it('keeps report critical alerts and structured bounds on untouched descriptive ranges', () => {
    const critical = { ...original, abnormalFlag: 'critical' as const, referenceText: '成人参考范围：3.5–9.5' }
    expect(editedIndicator(indicatorDraft(critical), critical)).toMatchObject({
      abnormalFlag: 'critical', referenceLow: 3.5, referenceHigh: 9.5,
    })
    expect(editedIndicator({ ...indicatorDraft(critical), result: '6' }, critical).abnormalFlag).toBe('normal')
  })

  it('edits and saves unit-free references while preserving unchanged critical alerts and bounds', () => {
    const withUnit = { ...original, abnormalFlag: 'critical' as const, referenceText: '成人参考范围：3.50–9.50 (10^9/L)' }
    const draft = indicatorDraft(withUnit)
    expect(draft.referenceText).toBe('成人参考范围：3.50–9.50')
    expect(editedIndicator(draft, withUnit)).toMatchObject({
      referenceText: '成人参考范围：3.50–9.50', referenceLow: 3.5, referenceHigh: 9.5, abnormalFlag: 'critical', unit: '10^9/L',
    })
    expect(editedIndicator({ ...draft, referenceText: '1–3 10^9/L' }, withUnit)).toMatchObject({
      referenceText: '1–3', referenceLow: 1, referenceHigh: 3, abnormalFlag: 'high', unit: '10^9/L',
    })
    expect(parseReferenceRange('1–2 mg/L', 'g/L')).toEqual({ referenceLow: null, referenceHigh: null })
  })
})
