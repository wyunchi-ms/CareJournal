import { INDICATORS } from '../data/indicatorAliases'
import type { AppLanguage, AppRegion, LocalePreferences } from '../types'

export const APP_LANGUAGES: Array<{ value: AppLanguage; label: string; nativeLabel: string }> = [
  { value: 'zh-CN', label: '简体中文', nativeLabel: '简体中文' },
  { value: 'zh-TW', label: '繁體中文', nativeLabel: '繁體中文' },
  { value: 'en', label: '英语', nativeLabel: 'English' },
]

export const APP_REGIONS: Array<{ value: AppRegion; labels: Record<AppLanguage, string> }> = [
  { value: 'CN', labels: { 'zh-CN': '中国大陆', 'zh-TW': '中國大陸', en: 'Mainland China' } },
  { value: 'HK', labels: { 'zh-CN': '中国香港', 'zh-TW': '中國香港', en: 'Hong Kong' } },
  { value: 'MO', labels: { 'zh-CN': '中国澳门', 'zh-TW': '中國澳門', en: 'Macao' } },
  { value: 'TW', labels: { 'zh-CN': '中国台湾', 'zh-TW': '中國台灣', en: 'Taiwan' } },
  { value: 'SG', labels: { 'zh-CN': '新加坡', 'zh-TW': '新加坡', en: 'Singapore' } },
  { value: 'US', labels: { 'zh-CN': '美国', 'zh-TW': '美國', en: 'United States' } },
  { value: 'GB', labels: { 'zh-CN': '英国', 'zh-TW': '英國', en: 'United Kingdom' } },
  { value: 'CA', labels: { 'zh-CN': '加拿大', 'zh-TW': '加拿大', en: 'Canada' } },
  { value: 'AU', labels: { 'zh-CN': '澳大利亚', 'zh-TW': '澳洲', en: 'Australia' } },
  { value: 'OTHER', labels: { 'zh-CN': '其他地区', 'zh-TW': '其他地區', en: 'Other region' } },
]

export const localeText = {
  'zh-CN': {
    welcome: '欢迎使用病程记', intro: '先选择常用地区和语言。地区会决定检查指标的单位规范，之后可在设置中修改。',
    language: '语言', region: '地区', continue: '开始使用', settingsTitle: '地区与语言',
    settingsSummary: '用于界面语言和智能识别单位规范', save: '保存地区与语言', saved: '地区与语言已更新',
  },
  'zh-TW': {
    welcome: '歡迎使用病程記', intro: '請先選擇常用地區和語言。地區會決定檢查指標的單位規範，之後可在設定中修改。',
    language: '語言', region: '地區', continue: '開始使用', settingsTitle: '地區與語言',
    settingsSummary: '用於介面語言和智慧辨識單位規範', save: '儲存地區與語言', saved: '地區與語言已更新',
  },
  en: {
    welcome: 'Welcome to CareJournal', intro: 'Choose your usual region and language. Your region controls the lab-unit conventions used by smart recognition. You can change this later in Settings.',
    language: 'Language', region: 'Region', continue: 'Continue', settingsTitle: 'Region & language',
    settingsSummary: 'Controls display language and recognition unit conventions', save: 'Save region & language', saved: 'Region and language updated',
  },
} as const

const AMERICAN_UNIT_OVERRIDES: Record<string, string> = {
  WBC: '10^3/μL', NEUT_ABS: '10^3/μL', LYMPH_ABS: '10^3/μL', MONO_ABS: '10^3/μL', EOS_ABS: '10^3/μL', BASO_ABS: '10^3/μL',
  HGB: 'g/dL', PLT: '10^3/μL', RBC: '10^6/μL', MCHC: 'g/dL', TBIL: 'mg/dL', DBIL: 'mg/dL', TP: 'g/dL', ALB: 'g/dL',
  UREA: 'mg/dL', CREA: 'mg/dL', UA: 'mg/dL', GLU: 'mg/dL', CA: 'mg/dL', FIB: 'mg/dL',
}

const TAIWAN_UNIT_OVERRIDES: Record<string, string> = {
  WBC: '10^3/μL', NEUT_ABS: '10^3/μL', LYMPH_ABS: '10^3/μL', MONO_ABS: '10^3/μL', EOS_ABS: '10^3/μL', BASO_ABS: '10^3/μL',
  HGB: 'g/dL', PLT: '10^3/μL', RBC: '10^6/μL', MCHC: 'g/dL', TBIL: 'mg/dL', DBIL: 'mg/dL', TP: 'g/dL', ALB: 'g/dL', UREA: 'mg/dL', CREA: 'mg/dL', UA: 'mg/dL', GLU: 'mg/dL', CA: 'mg/dL', CRP: 'mg/dL', FIB: 'mg/dL',
}

const ASIAN_MIXED_UNIT_OVERRIDES: Record<string, string> = { HGB: 'g/dL', MCHC: 'g/dL' }

function targetUnits(region: AppRegion) {
  if (region === 'OTHER') return []
  const overrides = region === 'US'
    ? AMERICAN_UNIT_OVERRIDES
    : region === 'TW'
      ? TAIWAN_UNIT_OVERRIDES
      : ['HK', 'MO', 'SG'].includes(region)
        ? ASIAN_MIXED_UNIT_OVERRIDES
        : {}
  return INDICATORS.filter((indicator) => indicator.standardUnit).map((indicator) => ({
    ...indicator,
    targetUnit: overrides[indicator.code] ?? indicator.standardUnit!,
  }))
}

export function regionLabel(region: AppRegion, language: AppLanguage) {
  return APP_REGIONS.find((item) => item.value === region)?.labels[language] ?? APP_REGIONS[0].labels[language]
}

export function buildClinicalLocaleGuidance(locale: LocalePreferences) {
  const region = regionLabel(locale.region, locale.language)
  const units = targetUnits(locale.region)
  const targetUnitGuide = units.map((indicator) => `${indicator.code}/${indicator.name}：${indicator.targetUnit}`).join('；')
  const outputLanguage = locale.language === 'en' ? 'English' : locale.language === 'zh-TW' ? '繁體中文' : '简体中文'
  const unitPolicy = locale.region === 'OTHER'
    ? `用户选择的是“${region}”，没有指定统一的地区单位表。忠实保留报告原始单位和值；不得仅为了统一格式而换算单位。`
    : `用户选择的医疗地区是“${region}”。所有指标必须统一为${region}临床检验常用单位。已知指标严格使用以下目标单位表：${targetUnitGuide}。`
  return { region, outputLanguage, targetUnitGuide, unitPolicy, preservesOriginalUnits: locale.region === 'OTHER' }
}
