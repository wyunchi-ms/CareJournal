export interface NormalizedReportType {
  code: string
  label: string
}

interface ReportTypeRule extends NormalizedReportType {
  patterns: RegExp[]
}

const RULES: ReportTypeRule[] = [
  { code: 'cbc', label: '血常规', patterns: [/血细胞.{0,6}(分析|计数)/i, /全血细胞计数/i, /血常规/i, /全血象/i, /^血象/i, /complete\s*blood\s*count/i, /^cbc$/i] },
  { code: 'blood_gas_electrolyte', label: '血气及电解质', patterns: [/血气.*电解质/i, /电解质.*血气/i, /血气分析/i] },
  { code: 'biochemistry', label: '生化检查', patterns: [/生化.{0,8}(套|全项|检验|检查|分析)/i, /临床生化/i, /血生化/i] },
  { code: 'laboratory', label: '实验室检查', patterns: [/^实验室(检验|检查)(报告)?$/i, /^检验报告$/i] },
  { code: 'hematology', label: '血液检查', patterns: [/^血液(检验|检查|报告)?$/i, /^血液检验报告$/i] },
  { code: 'urinalysis', label: '尿常规', patterns: [/尿常规/i, /尿液.{0,5}(分析|检验|检查)/i] },
  { code: 'coagulation', label: '凝血功能', patterns: [/凝血/i, /血凝/i] },
  { code: 'liver_kidney', label: '肝肾功能', patterns: [/肝肾功能/i] },
  { code: 'liver', label: '肝功能', patterns: [/肝功能/i] },
  { code: 'kidney', label: '肾功能', patterns: [/肾功能/i] },
  { code: 'tumor_marker', label: '肿瘤标志物', patterns: [/肿瘤标志/i, /肿瘤标记/i] },
  { code: 'thyroid', label: '甲状腺功能', patterns: [/甲状腺功能/i, /甲功/i] },
  { code: 'pathology', label: '病理检查', patterns: [/病理/i, /免疫组化/i] },
  { code: 'mri', label: '磁共振（MRI）', patterns: [/磁共振/i, /(^|[^a-z])mri([^a-z]|$)/i] },
  { code: 'pet_ct', label: 'PET-CT', patterns: [/pet[\s-]*ct/i] },
  { code: 'ct', label: 'CT', patterns: [/计算机断层/i, /计算机体层/i, /(^|[^a-z])ct([^a-z]|$)/i] },
  { code: 'ultrasound', label: '超声检查', patterns: [/超声/i, /彩超/i, /b超/i] },
  { code: 'xray', label: 'X 线检查', patterns: [/x[\s-]*线/i, /放射摄影/i, /dr检查/i] },
  { code: 'endoscopy', label: '内镜检查', patterns: [/内镜/i, /胃镜/i, /肠镜/i, /支气管镜/i] },
]

export const REPORT_TYPES: NormalizedReportType[] = [
  ...RULES.map(({ code, label }) => ({ code, label })),
  { code: 'other', label: '其他检查' },
]

function comparable(value: string) {
  return value.trim().replace(/[（]/g, '(').replace(/[）]/g, ')').replace(/[：:]/g, '').replace(/\s+/g, '')
}

export function normalizeReportType(rawType: string): NormalizedReportType {
  const raw = rawType.trim() || '其他检查'
  const normalized = comparable(raw)
  const rule = RULES.find((item) => item.patterns.some((pattern) => pattern.test(normalized)))
  return rule ? { code: rule.code, label: rule.label } : { code: `custom:${normalized.toLowerCase()}`, label: raw }
}
