export interface IndicatorDefinition {
  code: string
  name: string
  aliases: string[]
  standardUnit?: string
}

export const INDICATORS: IndicatorDefinition[] = [
  { code: 'WBC', name: '白细胞计数', aliases: ['白细胞', '白细胞计数', 'WBC'], standardUnit: '10^9/L' },
  { code: 'NEUT_ABS', name: '中性粒细胞绝对值', aliases: ['中性粒细胞绝对值', '中性粒细胞数', 'ANC', 'NEUT#'], standardUnit: '10^9/L' },
  { code: 'NEUT_PCT', name: '中性粒细胞百分比', aliases: ['中性粒细胞百分比', '中性粒细胞比率', 'NEUT%'], standardUnit: '%' },
  { code: 'HGB', name: '血红蛋白', aliases: ['血红蛋白', '血色素', 'HGB', 'Hb'], standardUnit: 'g/L' },
  { code: 'PLT', name: '血小板计数', aliases: ['血小板', '血小板计数', 'PLT'], standardUnit: '10^9/L' },
  { code: 'RBC', name: '红细胞计数', aliases: ['红细胞', '红细胞计数', 'RBC'], standardUnit: '10^12/L' },
  { code: 'ALT', name: '丙氨酸氨基转移酶', aliases: ['谷丙转氨酶', '丙氨酸氨基转移酶', 'ALT'], standardUnit: 'U/L' },
  { code: 'AST', name: '天门冬氨酸氨基转移酶', aliases: ['谷草转氨酶', '天门冬氨酸氨基转移酶', 'AST'], standardUnit: 'U/L' },
  { code: 'CREA', name: '肌酐', aliases: ['肌酐', '血肌酐', 'CREA', 'Cr'], standardUnit: 'μmol/L' },
  { code: 'CEA', name: '癌胚抗原', aliases: ['癌胚抗原', 'CEA'], standardUnit: 'ng/mL' },
  { code: 'CA199', name: '糖类抗原19-9', aliases: ['糖类抗原19-9', 'CA19-9', 'CA199'], standardUnit: 'U/mL' },
  { code: 'CA125', name: '糖类抗原125', aliases: ['糖类抗原125', 'CA125'], standardUnit: 'U/mL' },
]

const clean = (value: string) => value.toLowerCase().replace(/[\s（）()·_-]/g, '')

export function normalizeIndicator(rawName: string, proposedCode?: string, proposedName?: string) {
  const normalizedProposed = proposedCode?.trim().toUpperCase()
  const direct = INDICATORS.find((item) => item.code === normalizedProposed)
  if (direct) return direct
  const target = clean(rawName)
  const byAlias = INDICATORS.find((item) => item.aliases.some((alias) => clean(alias) === target))
  if (byAlias) return byAlias
  return {
    code: normalizedProposed || `CUSTOM_${target.slice(0, 24).toUpperCase() || 'UNKNOWN'}`,
    name: proposedName?.trim() || rawName.trim() || '未命名指标',
    aliases: [rawName],
  }
}
