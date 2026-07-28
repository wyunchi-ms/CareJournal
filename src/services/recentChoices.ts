import { useCallback, useMemo, useSyncExternalStore } from 'react'

const STORAGE_KEY = 'carejournal:recent-choices:v1'
const CHANGE_EVENT = 'carejournal:recent-choices-change'

export const RECENT_CHOICE_LIMIT = 5

type RecentChoiceStore = Record<string, string[]>

function readStore(): RecentChoiceStore {
  if (typeof window === 'undefined') return {}

  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as unknown
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}

    return Object.fromEntries(Object.entries(stored).flatMap(([key, values]) => {
      if (!Array.isArray(values)) return []
      const normalized = values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      return normalized.length ? [[key, normalized.slice(0, RECENT_CHOICE_LIMIT)]] : []
    }))
  } catch {
    return {}
  }
}

function choiceStorageKey(label: string, historyKey?: string) {
  return (historyKey?.trim() || label.trim()).toLocaleLowerCase('zh-CN')
}

export function getRecentChoices(label: string, historyKey?: string) {
  return readStore()[choiceStorageKey(label, historyKey)] ?? []
}

export function rememberRecentChoice(label: string, value: string, historyKey?: string) {
  const normalizedValue = value.trim()
  if (!normalizedValue || typeof window === 'undefined') return

  const key = choiceStorageKey(label, historyKey)
  const store = readStore()
  const comparisonValue = normalizedValue.toLocaleLowerCase('zh-CN')
  store[key] = [
    normalizedValue,
    ...(store[key] ?? []).filter((item) => item.toLocaleLowerCase('zh-CN') !== comparisonValue),
  ].slice(0, RECENT_CHOICE_LIMIT)

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: key }))
  } catch {
    // Storage can be unavailable in privacy mode; the picker should still work normally.
  }
}

export function sortByRecentChoices<T>(items: T[], recentValues: string[], getValue: (item: T) => string) {
  const order = new Map(recentValues.map((value, index) => [value.toLocaleLowerCase('zh-CN'), index]))
  return items
    .map((item, index) => ({ item, index, recentIndex: order.get(getValue(item).toLocaleLowerCase('zh-CN')) }))
    .sort((left, right) => {
      if (left.recentIndex === undefined && right.recentIndex === undefined) return left.index - right.index
      if (left.recentIndex === undefined) return 1
      if (right.recentIndex === undefined) return -1
      return left.recentIndex - right.recentIndex
    })
    .map(({ item }) => item)
}

export function useRecentChoices(label: string, historyKey?: string) {
  const key = choiceStorageKey(label, historyKey)
  const subscribe = useCallback((onStoreChange: () => void) => {
    const refresh = (event: Event) => {
      if ((event as CustomEvent<string>).detail === key) onStoreChange()
    }
    window.addEventListener(CHANGE_EVENT, refresh)
    return () => window.removeEventListener(CHANGE_EVENT, refresh)
  }, [key])
  const getSnapshot = useCallback(() => JSON.stringify(getRecentChoices(label, historyKey)), [historyKey, label])
  const serializedChoices = useSyncExternalStore(subscribe, getSnapshot, () => '[]')
  const recentChoices = useMemo(() => JSON.parse(serializedChoices) as string[], [serializedChoices])

  const remember = useCallback((value: string) => rememberRecentChoice(label, value, historyKey), [historyKey, label])

  return { recentChoices, remember }
}
