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
  { code: 'LYMPH_ABS', name: '淋巴细胞绝对值', aliases: ['淋巴细胞绝对值', '淋巴细胞数', 'LYMPH#', 'LYM#'], standardUnit: '10^9/L' },
  { code: 'LYMPH_PCT', name: '淋巴细胞百分比', aliases: ['淋巴细胞百分比', '淋巴细胞比率', 'LYMPH%', 'LYM%'], standardUnit: '%' },
  { code: 'MONO_ABS', name: '单核细胞绝对值', aliases: ['单核细胞绝对值', '单核细胞数', 'MONO#'], standardUnit: '10^9/L' },
  { code: 'MONO_PCT', name: '单核细胞百分比', aliases: ['单核细胞百分比', '单核细胞比率', 'MONO%'], standardUnit: '%' },
  { code: 'EOS_ABS', name: '嗜酸性粒细胞绝对值', aliases: ['嗜酸性粒细胞绝对值', '嗜酸性粒细胞数', 'EOS#'], standardUnit: '10^9/L' },
  { code: 'EOS_PCT', name: '嗜酸性粒细胞百分比', aliases: ['嗜酸性粒细胞百分比', '嗜酸性粒细胞比率', 'EOS%'], standardUnit: '%' },
  { code: 'BASO_ABS', name: '嗜碱性粒细胞绝对值', aliases: ['嗜碱性粒细胞绝对值', '嗜碱性粒细胞数', 'BASO#'], standardUnit: '10^9/L' },
  { code: 'BASO_PCT', name: '嗜碱性粒细胞百分比', aliases: ['嗜碱性粒细胞百分比', '嗜碱性粒细胞比率', 'BASO%'], standardUnit: '%' },
  { code: 'HGB', name: '血红蛋白', aliases: ['血红蛋白', '血色素', 'HGB', 'Hb'], standardUnit: 'g/L' },
  { code: 'PLT', name: '血小板计数', aliases: ['血小板', '血小板计数', 'PLT'], standardUnit: '10^9/L' },
  { code: 'RBC', name: '红细胞计数', aliases: ['红细胞', '红细胞计数', 'RBC'], standardUnit: '10^12/L' },
  { code: 'HCT', name: '红细胞压积', aliases: ['红细胞压积', '红细胞比容', 'HCT'], standardUnit: '%' },
  { code: 'MCV', name: '平均红细胞体积', aliases: ['平均红细胞体积', 'MCV'], standardUnit: 'fL' },
  { code: 'MCH', name: '平均红细胞血红蛋白量', aliases: ['平均红细胞血红蛋白量', '平均血红蛋白量', 'MCH'], standardUnit: 'pg' },
  { code: 'MCHC', name: '平均红细胞血红蛋白浓度', aliases: ['平均红细胞血红蛋白浓度', '平均血红蛋白浓度', 'MCHC'], standardUnit: 'g/L' },
  { code: 'RDW_CV', name: '红细胞分布宽度变异系数', aliases: ['红细胞分布宽度变异系数', '红细胞分布宽度CV', 'RDW-CV'], standardUnit: '%' },
  { code: 'RDW_SD', name: '红细胞分布宽度标准差', aliases: ['红细胞分布宽度标准差', '红细胞分布宽度SD', 'RDW-SD'], standardUnit: 'fL' },
  { code: 'MPV', name: '平均血小板体积', aliases: ['平均血小板体积', 'MPV'], standardUnit: 'fL' },
  { code: 'PDW', name: '血小板分布宽度', aliases: ['血小板分布宽度', 'PDW'], standardUnit: '%' },
  { code: 'PCT', name: '血小板压积', aliases: ['血小板压积', 'PCT'], standardUnit: '%' },
  { code: 'P_LCR', name: '大血小板比率', aliases: ['大血小板比率', '大型血小板比率', 'P-LCR'], standardUnit: '%' },
  { code: 'ALT', name: '丙氨酸氨基转移酶', aliases: ['谷丙转氨酶', '丙氨酸氨基转移酶', 'ALT'], standardUnit: 'U/L' },
  { code: 'AST', name: '天门冬氨酸氨基转移酶', aliases: ['谷草转氨酶', '天门冬氨酸氨基转移酶', 'AST'], standardUnit: 'U/L' },
  { code: 'ALP', name: '碱性磷酸酶', aliases: ['碱性磷酸酶', 'ALP'], standardUnit: 'U/L' },
  { code: 'GGT', name: 'γ-谷氨酰转移酶', aliases: ['γ-谷氨酰转移酶', '谷氨酰转肽酶', 'GGT'], standardUnit: 'U/L' },
  { code: 'TBIL', name: '总胆红素', aliases: ['总胆红素', 'TBIL'], standardUnit: 'μmol/L' },
  { code: 'DBIL', name: '直接胆红素', aliases: ['直接胆红素', '结合胆红素', 'DBIL'], standardUnit: 'μmol/L' },
  { code: 'TP', name: '总蛋白', aliases: ['总蛋白', 'TP'], standardUnit: 'g/L' },
  { code: 'ALB', name: '白蛋白', aliases: ['白蛋白', 'ALB'], standardUnit: 'g/L' },
  { code: 'UREA', name: '尿素', aliases: ['尿素', '尿素氮', 'UREA', 'BUN'], standardUnit: 'mmol/L' },
  { code: 'CREA', name: '肌酐', aliases: ['肌酐', '血肌酐', 'CREA', 'Cr'], standardUnit: 'μmol/L' },
  { code: 'UA', name: '尿酸', aliases: ['尿酸', 'UA'], standardUnit: 'μmol/L' },
  { code: 'GLU', name: '葡萄糖', aliases: ['葡萄糖', '血糖', 'GLU'], standardUnit: 'mmol/L' },
  { code: 'LDH', name: '乳酸脱氢酶', aliases: ['乳酸脱氢酶', 'LDH'], standardUnit: 'U/L' },
  { code: 'K', name: '钾', aliases: ['钾', '血钾', 'K+'], standardUnit: 'mmol/L' },
  { code: 'NA', name: '钠', aliases: ['钠', '血钠', 'Na+'], standardUnit: 'mmol/L' },
  { code: 'CL', name: '氯', aliases: ['氯', '血氯', 'Cl-'], standardUnit: 'mmol/L' },
  { code: 'CA', name: '钙', aliases: ['钙', '血钙', 'Ca'], standardUnit: 'mmol/L' },
  { code: 'CRP', name: 'C反应蛋白', aliases: ['C反应蛋白', '超敏C反应蛋白', 'CRP', 'hs-CRP'], standardUnit: 'mg/L' },
  { code: 'CEA', name: '癌胚抗原', aliases: ['癌胚抗原', 'CEA'], standardUnit: 'ng/mL' },
  { code: 'CA199', name: '糖类抗原19-9', aliases: ['糖类抗原19-9', 'CA19-9', 'CA199'], standardUnit: 'U/mL' },
  { code: 'CA125', name: '糖类抗原125', aliases: ['糖类抗原125', 'CA125'], standardUnit: 'U/mL' },
  { code: 'AFP', name: '甲胎蛋白', aliases: ['甲胎蛋白', 'AFP'], standardUnit: 'ng/mL' },
  { code: 'CA153', name: '糖类抗原15-3', aliases: ['糖类抗原15-3', 'CA15-3', 'CA153'], standardUnit: 'U/mL' },
  { code: 'PT', name: '凝血酶原时间', aliases: ['凝血酶原时间', 'PT'], standardUnit: 's' },
  { code: 'INR', name: '国际标准化比值', aliases: ['国际标准化比值', 'INR'] },
  { code: 'APTT', name: '活化部分凝血活酶时间', aliases: ['活化部分凝血活酶时间', 'APTT'], standardUnit: 's' },
  { code: 'FIB', name: '纤维蛋白原', aliases: ['纤维蛋白原', 'FIB'], standardUnit: 'g/L' },
  { code: 'D_DIMER', name: 'D-二聚体', aliases: ['D-二聚体', 'D二聚体', 'D-Dimer'] },
]

const clean = (value: string) => value.toLowerCase().replace(/[\s（）()·_-]/g, '')

export function normalizeIndicator(rawName: string, proposedCode?: string, proposedName?: string) {
  const normalizedProposed = proposedCode?.trim().toUpperCase()
  const target = clean(rawName)
  const byAlias = INDICATORS.find((item) => item.aliases.some((alias) => clean(alias) === target))
  if (byAlias) return byAlias
  const direct = INDICATORS.find((item) => item.code === normalizedProposed)
  if (direct) return direct
  const proposedIsOther = normalizedProposed === 'OTHER' || proposedName?.trim() === '其他指标'
  return {
    code: !proposedIsOther && normalizedProposed ? normalizedProposed : `CUSTOM_${target.slice(0, 24).toUpperCase() || 'UNKNOWN'}`,
    name: !proposedIsOther && proposedName?.trim() ? proposedName.trim() : rawName.trim() || '未命名指标',
    aliases: [rawName],
  }
}
