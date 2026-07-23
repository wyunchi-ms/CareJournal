export interface ChartIndicatorOption {
  code: string
  name: string
  unit: string
  count: number
}

export const COMMON_CHART_INDICATOR_CODES = [
  'WBC',
  'NEUT_ABS',
  'HGB',
  'PLT',
  'ALT',
  'AST',
  'ALB',
  'CREA',
  'CRP',
  'CEA',
  'CA199',
  'CA125',
  'AFP',
] as const

export function sortChartIndicators(
  indicators: ChartIndicatorOption[],
  manualOrder: string[],
  pinnedCodes: string[],
) {
  const pinnedRank = new Map(pinnedCodes.map((code, index) => [code, index]))
  const manualRank = new Map(manualOrder.map((code, index) => [code, index]))
  const commonRank = new Map<string, number>(COMMON_CHART_INDICATOR_CODES.map((code, index) => [code, index]))
  return [...indicators].sort((first, second) => {
    const firstPinned = pinnedRank.get(first.code)
    const secondPinned = pinnedRank.get(second.code)
    if (firstPinned !== undefined || secondPinned !== undefined) {
      if (firstPinned === undefined) return 1
      if (secondPinned === undefined) return -1
      return firstPinned - secondPinned
    }

    const firstManual = manualRank.get(first.code)
    const secondManual = manualRank.get(second.code)
    if (firstManual !== undefined || secondManual !== undefined) {
      if (firstManual === undefined) return 1
      if (secondManual === undefined) return -1
      return firstManual - secondManual
    }

    const firstCommon = commonRank.get(first.code)
    const secondCommon = commonRank.get(second.code)
    if (firstCommon !== undefined || secondCommon !== undefined) {
      if (firstCommon === undefined) return 1
      if (secondCommon === undefined) return -1
      return firstCommon - secondCommon
    }

    if (first.count !== second.count) return second.count - first.count
    return first.name.localeCompare(second.name, 'zh-CN')
  })
}

export function moveChartIndicator(order: string[], sourceCode: string, targetCode: string) {
  const sourceIndex = order.indexOf(sourceCode)
  const targetIndex = order.indexOf(targetCode)
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return order
  const next = [...order]
  next.splice(sourceIndex, 1)
  next.splice(targetIndex, 0, sourceCode)
  return next
}
