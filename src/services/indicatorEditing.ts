import { normalizeIndicator } from '../data/indicatorAliases'
import type { LabIndicator } from '../types'
import { cleanIndicatorName, cleanReportResult } from './indicatorNames'
import { indicatorRangeFlag, referenceRangeText, resultText, stripReferenceUnit } from './recordDisplay'

export interface IndicatorDraft {
  id: string
  rawName: string
  normalizedCode: string
  normalizedName: string
  result: string
  unit: string
  referenceText: string
}

export function indicatorDraft(item: LabIndicator): IndicatorDraft {
  return {
    id: item.id, rawName: item.rawName, normalizedCode: item.normalizedCode,
    normalizedName: item.normalizedName || item.rawName, result: resultText(item),
    unit: item.unit, referenceText: referenceRangeText(item),
  }
}

export const numericPattern = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?'

export function parseReferenceRange(reference: string, unit = '') {
  const text = stripReferenceUnit(reference, unit)
  const range = text.match(new RegExp(`^(${numericPattern})\\s*(?:-|–|—|~|～|至|to)\\s*(${numericPattern})$`, 'i'))
  if (range) {
    const low = Number(range[1])
    const high = Number(range[2])
    if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) throw new Error('参考范围的下限不能大于上限，且必须为有限数值')
    return { referenceLow: low, referenceHigh: high }
  }
  const bound = text.match(new RegExp(`^(<=|≤|<|>=|≥|>)\\s*(${numericPattern})$`))
  if (bound) {
    const value = Number(bound[2])
    if (!Number.isFinite(value)) throw new Error('参考范围必须为有限数值')
    return bound[1].startsWith('>') || bound[1] === '≥'
      ? { referenceLow: value, referenceHigh: null }
      : { referenceLow: null, referenceHigh: value }
  }
  return { referenceLow: null, referenceHigh: null }
}

export function editedIndicator(draft: IndicatorDraft, original?: LabIndicator): LabIndicator {
  const name = cleanIndicatorName(draft.normalizedName)
  if (!name) throw new Error('请填写每一项指标的名称，或移除空白指标')
  const result = cleanReportResult(draft.result)
  const numeric = result.replace(/^(?:<=|>=|[<>≤≥])\s*/, '')
  const parsedValue = numeric && new RegExp(`^${numericPattern}$`).test(numeric) ? Number(numeric) : null
  if (parsedValue !== null && !Number.isFinite(parsedValue)) throw new Error(`${name}的结果必须为有限数值`)
  const referenceText = stripReferenceUnit(draft.referenceText, draft.unit)
  const referenceUnchanged = original && referenceText === referenceRangeText(original) && draft.unit.trim() === original.unit
  const bounds = referenceUnchanged
    ? { referenceLow: original.referenceLow, referenceHigh: original.referenceHigh }
    : parseReferenceRange(referenceText, draft.unit)
  const rawName = draft.rawName.trim() || name
  const normalized = normalizeIndicator(rawName, draft.normalizedCode, name)
  const indicator: LabIndicator = {
    id: draft.id, rawName,
    normalizedCode: draft.normalizedCode === 'OTHER' ? normalized.code : draft.normalizedCode,
    normalizedName: name, value: parsedValue, rawValue: result, unit: draft.unit.trim(),
    ...bounds, referenceText, abnormalFlag: 'unknown',
    ...(original?.originalMeasurement ? { originalMeasurement: original.originalMeasurement } : {}),
  }
  // Critical alerts are report facts, not thresholds we can infer locally.
  if (original?.abnormalFlag === 'critical' && referenceUnchanged && result === resultText(original)) {
    indicator.abnormalFlag = 'critical'
  } else {
    indicator.abnormalFlag = indicatorRangeFlag(indicator)
    if (parsedValue !== null && indicator.abnormalFlag === 'unknown' && (bounds.referenceLow !== null || bounds.referenceHigh !== null)) indicator.abnormalFlag = 'normal'
    if (parsedValue !== null && /^<(?![=])/.test(referenceText) && bounds.referenceHigh !== null && parsedValue === bounds.referenceHigh) indicator.abnormalFlag = 'high'
    if (parsedValue !== null && /^>(?![=])/.test(referenceText) && bounds.referenceLow !== null && parsedValue === bounds.referenceLow) indicator.abnormalFlag = 'low'
  }
  return indicator
}
