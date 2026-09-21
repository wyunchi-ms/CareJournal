import { describe, expect, it } from 'vitest'
import { flagLabel, indicatorRangeFlag, resultText } from '../services/recordDisplay'
import type { AbnormalFlag, LabIndicator } from '../types'

const indicator: LabIndicator = {
  id: 'wbc', rawName: 'WBC', normalizedCode: 'WBC', normalizedName: '白细胞计数',
  value: 4, rawValue: '', unit: '10^9/L', referenceLow: 3.5, referenceHigh: 9.5,
  referenceText: '3.5–9.5', abnormalFlag: 'unknown',
}

describe('indicator result display', () => {
  it.each<{ changes: Partial<LabIndicator>; expected: AbnormalFlag }>([
    { changes: { value: 3.2, abnormalFlag: 'normal' }, expected: 'low' },
    { changes: { value: 10, abnormalFlag: 'normal' }, expected: 'high' },
    { changes: { value: 3.5, abnormalFlag: 'low' }, expected: 'normal' },
    { changes: { value: 9.5, abnormalFlag: 'high' }, expected: 'normal' },
    { changes: { value: 4 }, expected: 'normal' },
    { changes: { value: 0, referenceLow: 0, referenceHigh: 0 }, expected: 'normal' },
    { changes: { value: -1, referenceLow: 0, referenceHigh: null }, expected: 'low' },
    { changes: { value: 1, referenceLow: null, referenceHigh: 0 }, expected: 'high' },
    { changes: { referenceLow: null, referenceHigh: null, abnormalFlag: 'high' }, expected: 'high' },
    { changes: { referenceLow: null, referenceHigh: null, abnormalFlag: 'low' }, expected: 'low' },
    { changes: { referenceLow: null, referenceHigh: null }, expected: 'unknown' },
    { changes: { value: null }, expected: 'unknown' },
    { changes: { referenceLow: null, value: 4 }, expected: 'unknown' },
    { changes: { value: 1, abnormalFlag: 'critical' }, expected: 'critical' },
  ])('uses reference bounds without losing report-only or critical flags: $changes', ({ changes, expected }) => {
    expect(indicatorRangeFlag({ ...indicator, ...changes })).toBe(expected)
  })

  it.each([
    ['high', '偏高'], ['low', '偏低'], ['critical', '危急'], ['normal', '正常'], ['unknown', ''],
  ] as const)('labels %s without relying on color alone', (flag, label) => {
    expect(flagLabel(flag)).toBe(label)
  })

  it('preserves reported precision and removes duplicate units and arrows', () => {
    expect(resultText({ ...indicator, rawValue: '4.00 10^9/L ↑' })).toBe('4.00')
    expect(resultText({ ...indicator, rawValue: '<0.01 L' })).toBe('<0.01')
    expect(resultText({ ...indicator, value: 0 })).toBe('0')
  })
})
