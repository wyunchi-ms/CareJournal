import type { DynamicVocabulary } from '../types'

interface LocationValue {
  hospital?: string
  department?: string
}

function unique(values: Array<string | undefined>) {
  const seen = new Set<string>()
  return values.map((value) => value?.trim()).filter((value): value is string => {
    if (!value) return false
    const key = value.toLocaleLowerCase('zh-CN')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

export function buildVocabulary(entries: LocationValue[]): DynamicVocabulary {
  return {
    hospitals: unique(entries.map((item) => item.hospital)),
    departments: unique(entries.map((item) => item.department)),
  }
}

export function chooseKnownValue(value: string, options: string[]) {
  const normalized = value.trim().toLocaleLowerCase('zh-CN')
  return options.find((item) => item.toLocaleLowerCase('zh-CN') === normalized) ?? value.trim()
}
