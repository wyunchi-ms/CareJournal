import type { ChartPin } from '../types'

export function sortChartPins(pins: ChartPin[]) {
  return [...pins].sort((first, second) => {
    const firstHasOrder = Number.isFinite(first.sortOrder)
    const secondHasOrder = Number.isFinite(second.sortOrder)
    if (firstHasOrder && secondHasOrder) return (first.sortOrder as number) - (second.sortOrder as number)
    if (firstHasOrder !== secondHasOrder) return firstHasOrder ? -1 : 1
    return second.createdAt.localeCompare(first.createdAt)
  })
}

export function moveChartPin(ids: string[], sourceId: string, targetId: string) {
  const sourceIndex = ids.indexOf(sourceId)
  const targetIndex = ids.indexOf(targetId)
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return ids
  const next = [...ids]
  const [moved] = next.splice(sourceIndex, 1)
  next.splice(targetIndex, 0, moved)
  return next
}
