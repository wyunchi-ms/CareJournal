import type { LabIndicator } from '../types'
import { numericPattern, parseReferenceRange } from './indicatorEditing'
import { resultText, stripReferenceUnit } from './recordDisplay'

const aliases: Record<string, string> = {
  秒: 's', sec: 's', 分钟: 'min',
  无量纲: '1', 无单位: '1', 比值: '1', ratio: '1',
  'ug/L': 'µg/L', 'ug/mL': 'µg/mL', 'umol/L': 'µmol/L',
  '10^3/uL': '10^3/µL', '10^6/uL': '10^6/µL',
  'IU/L': 'U/L', 'IU/mL': 'U/mL', 'kIU/L': 'kU/L', 'mIU/L': 'mU/L', 'mIU/mL': 'mU/mL',
}

export function comparableIndicatorUnit(unit: string) {
  const compact = unit.trim().replace(/\s+/g, '').replace(/μ/g, 'µ')
    .replace(/⁹/g, '^9').replace(/¹²/g, '^12').replace(/³/g, '^3').replace(/⁶/g, '^6')
    .replace(/^[×x]/, '').replace(/\/([dmµnu]?)l$/, '/$1L')
  return Object.hasOwn(aliases, compact) ? aliases[compact] : compact
}

const scales: Record<string, { family: string; scale: number }> = {
  '1': { family: 'ratio', scale: 1 }, '%': { family: 'ratio', scale: 0.01 },
  s: { family: 'time', scale: 1 }, min: { family: 'time', scale: 60 },
  'U/L': { family: 'activity', scale: 1 }, 'kU/L': { family: 'activity', scale: 1000 },
  'U/mL': { family: 'activity', scale: 1000 }, 'mU/L': { family: 'activity', scale: 0.001 },
  'mU/mL': { family: 'activity', scale: 1 },
  'mol/L': { family: 'amount', scale: 1 }, 'mmol/L': { family: 'amount', scale: 0.001 },
  'µmol/L': { family: 'amount', scale: 0.000001 }, 'nmol/L': { family: 'amount', scale: 0.000000001 },
  'g/L': { family: 'mass', scale: 1 }, 'g/dL': { family: 'mass', scale: 10 },
  'mg/L': { family: 'mass', scale: 0.001 }, 'mg/dL': { family: 'mass', scale: 0.01 },
  'µg/L': { family: 'mass', scale: 0.000001 }, 'µg/mL': { family: 'mass', scale: 0.001 },
  'ng/mL': { family: 'mass', scale: 0.000001 }, 'ng/L': { family: 'mass', scale: 0.000000001 },
  '10^9/L': { family: 'count', scale: 1e9 }, '10^3/µL': { family: 'count', scale: 1e9 },
  '10^12/L': { family: 'count', scale: 1e12 }, '10^6/µL': { family: 'count', scale: 1e12 },
}

const knownUnits = [...new Set([...Object.keys(scales), ...Object.keys(aliases)]
  .flatMap((unit) => [unit, unit.replace(/L$/, 'l')]))]
  .filter((unit) => unit !== '1').sort((a, b) => b.length - a.length)

export function indicatorUnitFactor(from: string, to: string) {
  const source = comparableIndicatorUnit(from)
  const target = comparableIndicatorUnit(to)
  if (!target) throw new Error('请明确填写统一单位；无量纲指标请使用“无量纲”')
  if (!source || source === target) return 1
  const sourceScale = Object.hasOwn(scales, source) ? scales[source] : undefined
  const targetScale = Object.hasOwn(scales, target) ? scales[target] : undefined
  if (!sourceScale || !targetScale || sourceScale.family !== targetScale.family) {
    throw new Error(`不能可靠换算单位“${from}”→“${to}”，请核对原报告；不会只修改单位文字`)
  }
  return sourceScale.scale / targetScale.scale
}

function scaled(value: number, factor: number) {
  const result = Number((value * factor).toPrecision(15))
  if (!Number.isFinite(result)) throw new Error('单位换算结果超出有效数值范围')
  return result
}

function reportedUnit(indicator: LabIndicator) {
  if (indicator.unit.trim()) return indicator.unit.trim()
  const matches = knownUnits.filter((unit) => [indicator.rawValue, indicator.referenceText]
    .some((text) => stripReferenceUnit(text, unit) !== text.trim()))
  if (new Set(matches.map(comparableIndicatorUnit)).size > 1) throw new Error(`${indicator.normalizedName}的结果和参考范围单位冲突，请先核对原报告`)
  return matches[0] ?? ''
}

function referenceLabel(text: string, source: string, name: string, afterNumber = false) {
  let label = text
  for (const unit of [...new Set([source, ...knownUnits])].filter((unit) => unit !== '1').sort((a, b) => b.length - a.length)) {
    if (!label.includes(unit) && !label.includes(unit.replace(/µ/g, 'μ'))) continue
    const escaped = unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[µμ]/g, '[µμ]')
    const before = afterNumber && !/^\d/.test(unit) ? '[\\p{L}]' : '[\\p{L}\\p{N}]'
    const pattern = new RegExp(`(?:[（(]\\s*${escaped}\\s*[）)]|(?<!${before})${escaped}(?![\\p{L}\\p{N}]))`, 'gu')
    if (!pattern.test(label)) continue
    if (indicatorUnitFactor(unit, source) !== 1) throw new Error(`${name}的参考范围单位与指标单位不一致，请核对原报告`)
    label = label.replace(pattern, '').replace(/\s+([）)])/g, '$1')
  }
  if (/[A-Za-zµμ][A-Za-zµμ\d^]*\s*[/／]\s*(?:[dDmMcCµμnu]?[Ll]|[kKmM]?g|s|min)(?![\p{L}])/u.test(label)) {
    throw new Error(`${name}的参考范围包含无法识别的单位，请核对原报告`)
  }
  return label
}

function convertedReferenceText(text: string, source: string, factor: number, name: string) {
  return text.split(/([;；,，\n]+)/).map((segment) => {
    if (!segment || /^[;；,，\n]+$/.test(segment)) return segment
    const colon = Math.max(segment.lastIndexOf(':'), segment.lastIndexOf('：'))
    const label = colon < 0 ? '' : segment.slice(0, colon)
    const prefix = colon < 0 ? '' : `${referenceLabel(label, source, name)}${segment[colon]}`
    const body = referenceLabel(colon < 0 ? segment : segment.slice(colon + 1), source, name, true)
    if (!/\d/.test(body)) return `${prefix}${referenceLabel(body, source, name)}`
    const unitFree = body.trim()
    const note = unitFree.match(/(\s*[（(][^（）()\d]*[）)]\s*)$/u)?.[0] ?? ''
    const rangeBody = (note ? unitFree.slice(0, -note.length) : unitFree).trim()
    const heading = rangeBody.match(/^[^\d<>≤≥+.-]*/u)![0]
    const range = rangeBody.slice(heading.length)
    const parsed = parseReferenceRange(range)
    if (parsed.referenceLow === null && parsed.referenceHigh === null) {
      throw new Error(`${name}的参考范围包含无法明确识别的描述或数值，请核对原报告`)
    }
    const converted = parsed.referenceLow !== null && parsed.referenceHigh !== null
      ? `${scaled(parsed.referenceLow, factor)}–${scaled(parsed.referenceHigh, factor)}`
      : `${range.match(/^(?:<=|>=|[<>≤≥])/)![0]}${scaled((parsed.referenceLow ?? parsed.referenceHigh)!, factor)}`
    return `${prefix}${referenceLabel(heading, source, name)}${converted}${referenceLabel(note, source, name)}`
  }).join('')
}

export function convertIndicatorUnit(indicator: LabIndicator, unit: string): LabIndicator {
  const target = unit.trim()
  if (indicator.unit === target) return indicator
  const source = reportedUnit(indicator)
  const factor = indicatorUnitFactor(source, target)
  let rawValue = indicator.rawValue ? source === '1' ? indicator.rawValue.trim() : resultText({ ...indicator, unit: source }) : ''
  let referenceText = source === '1' ? indicator.referenceText.trim() : stripReferenceUnit(indicator.referenceText, source)
  if (factor !== 1) {
    if (rawValue) {
      const match = rawValue.match(new RegExp(`^((?:<=|>=|[<>≤≥])?\\s*)(${numericPattern})$`))
      if (!match) throw new Error(`${indicator.normalizedName}的结果包含无法可靠换算的文字，请核对原报告`)
      rawValue = `${match[1]}${scaled(Number(match[2]), factor)}`
    }
    if (referenceText) {
      referenceText = convertedReferenceText(referenceText, source, factor, indicator.normalizedName)
    }
  }
  const { value, unit: originalUnit, rawValue: originalRawValue, referenceLow, referenceHigh, referenceText: originalReferenceText } = indicator
  return {
    ...indicator, unit: target, rawValue, referenceText,
    value: value === null ? null : scaled(value, factor),
    referenceLow: referenceLow === null ? null : scaled(referenceLow, factor),
    referenceHigh: referenceHigh === null ? null : scaled(referenceHigh, factor),
    originalMeasurement: indicator.originalMeasurement ?? {
      value, unit: originalUnit, rawValue: originalRawValue, referenceLow, referenceHigh, referenceText: originalReferenceText,
    },
  }
}
