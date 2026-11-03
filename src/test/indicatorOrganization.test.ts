import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildIndicatorOrganizationPlan, collectIndicatorGroups, projectIndicatorGroups, resolveIndicatorMerges, reviewIndicatorMerges, suggestIndicatorMerges, suggestLocalIndicatorMerges, type IndicatorGroup, type IndicatorMerge } from '../services/indicatorOrganization'
import { collectChartMetrics } from '../services/chartMetrics'
import { convertIndicatorUnit, indicatorUnitFactor } from '../services/indicatorUnits'
import { editedIndicator, indicatorDraft } from '../services/indicatorEditing'
import { DEFAULT_PREFERENCES, type ChartPin, type ExamRecord, type LabIndicator } from '../types'

const post = vi.hoisted(() => vi.fn())
vi.mock('../services/ocr', () => ({
  llmPost: post,
  parseJsonResponse: (value: string) => JSON.parse(value),
}))

const indicator = (code: string, name: string, unit = '10^9/L'): LabIndicator => ({
  id: `${code}-${name}`, rawName: `*${name}`, normalizedCode: code, normalizedName: name,
  value: 4.25, rawValue: '4.25', unit, referenceLow: 3.5, referenceHigh: 9.5,
  referenceText: '3.5–9.5', abnormalFlag: 'normal',
})
const record = (id: string, indicators: LabIndicator[]): ExamRecord => ({
  id, indicators, reportType: '血常规', normalizedReportType: '血常规', sampleDate: '2026-10-01',
  hospital: '仅本地医院', summary: '仅本地结论', images: [], linkedEventIds: ['event-1'],
  fingerprint: 'original-fingerprint', ocrStatus: 'completed', ocrAttempts: 1,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
})
const source = indicator('CUSTOM_WBC', '*白细胞总数*')
const target = indicator('WBC', '白细胞计数')
const records = [record('one', [source, target]), record('two', [{ ...source, id: 'source-two' }])]
const inventory = collectIndicatorGroups(records)
const merge: IndicatorMerge = {
  sourceId: inventory.find((group) => group.code === source.normalizedCode)!.id,
  targetId: inventory.find((group) => group.code === target.normalizedCode)!.id,
  reason: '同一检查指标的别名',
}
const pin: ChartPin = { id: 'pin', title: '*白细胞总数*趋势', mode: 'trend', indicatorCodes: ['CUSTOM_WBC'], cycleEventIds: [], createdAt: '2026-10-01T00:00:00Z' }

const llm = {
  activeProvider: 'openai-compatible' as const,
  providers: { 'openai-compatible': { endpoint: 'https://example.test/v1', apiKey: 'test', model: 'test', maxRetries: 1 } },
}
type ModelRequest = { indicator: IndicatorGroup; indicators: IndicatorGroup[] }
const modelRequest = (body: { messages: Array<{ content: string }> }): ModelRequest => JSON.parse(body.messages[1].content)
const reply = (merges: Array<{ sourceId: string; targetId: string; reason: string; unit: string | null }> = [], issue: string | null = null) => ({
  ok: true, status: 200, data: { choices: [{ message: { content: JSON.stringify({ merges, issue }) } }] },
})

beforeEach(() => { post.mockReset() })

describe('indicator organization', () => {
  it('merges identical names and magnesium aliases with different codes into one chart without losing history', async () => {
    const magnesiumRecords = [record('magnesium', [
      indicator('CUSTOM_镁', '镁', 'mmol/L'),
      indicator('MAGNESIUM', '镁(MG)', 'mmol/L'),
      indicator('CUSTOM_镁MG', '镁(MG)', 'mmol/L'),
      indicator('MG', '镁', 'mmol/L'),
    ])]
    const groups = collectIndicatorGroups(magnesiumRecords)
    const merges = suggestLocalIndicatorMerges(groups)
    expect(merges).toHaveLength(3)
    const preferences = { ...DEFAULT_PREFERENCES, chartPinnedIndicatorCodes: ['MAGNESIUM', 'CUSTOM_镁'], chartIndicatorOrder: ['CUSTOM_镁MG', 'MG'] }
    const magnesiumPin = { ...pin, title: '镁(MG)趋势', indicatorCodes: ['MAGNESIUM'] }
    const plan = await buildIndicatorOrganizationPlan(magnesiumRecords, [magnesiumPin], preferences, merges)
    expect(collectChartMetrics(plan.records, [])).toEqual([{ code: 'MG', name: '镁', unit: 'mmol/L', count: 4, source: 'exam' }])
    expect(plan.records[0].indicators.map((item) => item.rawName)).toEqual(magnesiumRecords[0].indicators.map((item) => item.rawName))
    expect(plan.pins[0]).toMatchObject({ title: '镁趋势', indicatorCodes: ['MG'] })
    expect(plan.preferences.chartPinnedIndicatorCodes).toEqual(['MG'])
    expect(plan.preferences.chartIndicatorOrder).toEqual(['MG'])
    expect(suggestLocalIndicatorMerges(collectIndicatorGroups(plan.records))).toEqual([])
  })

  it('locally merges exact custom names while keeping incompatible units and qualified names separate', () => {
    const groups = collectIndicatorGroups([record('variants', [
      indicator('CUSTOM_A', '另一指标', 'mmol/L'), indicator('CUSTOM_B', '*另一指标*', 'mmol/L'),
      indicator('CUSTOM_C', '另一指标', 'mg/L'), indicator('CUSTOM_D', '另一指标', ''),
      indicator('CUSTOM_E', '另一指标(游离)', 'mmol/L'),
      indicator('NEUT_ABS', '同名', 'mmol/L'), indicator('NEUT_PCT', '同名', 'mmol/L'),
    ])])
    const merges = suggestLocalIndicatorMerges(groups)
    expect(merges).toHaveLength(1)
    const resolved = resolveIndicatorMerges(groups, merges)
    expect(resolved.get(groups.find((group) => group.code === 'CUSTOM_B')!.id)?.code).toBe('CUSTOM_A')
  })

  it('keeps local duplicates even when the model finds no additional merges', async () => {
    const groups = collectIndicatorGroups([record('magnesium', [
      indicator('CUSTOM_MG', '镁(MG)', 'mmol/L'), indicator('MG', '镁', 'mmol/L'),
    ])])
    post.mockResolvedValue(reply())
    const result = await suggestIndicatorMerges(groups, llm)
    expect(result.merges).toEqual(suggestLocalIndicatorMerges(groups))
    expect(result.completed).toBe(2)
    expect(post).toHaveBeenCalledTimes(1)
    expect(modelRequest(post.mock.calls[0][3]).indicators).toEqual(groups.filter((group) => group.code === 'MG').map((group) => ({ ...group, id: 'g0', count: 2 })))
  })

  it('counts exact name/code groups without losing individual results', async () => {
    expect(inventory.map((group) => [group.name, group.count])).toEqual([['*白细胞总数*', 2], ['白细胞计数', 1]])
    const preferences = { ...DEFAULT_PREFERENCES, chartIndicatorOrder: ['CUSTOM_WBC', 'WBC'], chartPinnedIndicatorCodes: ['CUSTOM_WBC'] }
    const plan = await buildIndicatorOrganizationPlan(records, [pin], preferences, [merge])
    expect(plan.summary).toEqual({ recordsUpdated: 2, indicatorsUpdated: 2, chartsUpdated: 1 })
    expect(plan.records.map((item) => item.indicators.length)).toEqual([2, 1])
    expect(plan.records[0].indicators[0]).toEqual({ ...source, normalizedName: target.normalizedName, normalizedCode: 'WBC' })
    expect(plan.records[0].indicators[1]).toBe(target)
    expect(plan.records[0].fingerprint).not.toBe('original-fingerprint')
    expect(plan.records[0].linkedEventIds).toEqual(['event-1'])
    expect(plan.pins[0]).toMatchObject({ title: '白细胞计数趋势', indicatorCodes: ['WBC'] })
    expect(plan.preferences.chartIndicatorOrder).toEqual(['WBC'])
    expect(plan.preferences.chartPinnedIndicatorCodes).toEqual(['WBC'])
    expect(records[0].indicators[0]).toBe(source)
  })

  it('cleans existing decorations without a model, preserving original names, units and fingerprints', async () => {
    const plan = await buildIndicatorOrganizationPlan(records, [pin], DEFAULT_PREFERENCES, [])
    expect(plan.records[0].indicators[0]).toMatchObject({
      normalizedName: '白细胞总数', normalizedCode: 'CUSTOM_WBC', rawName: source.rawName, value: source.value, unit: source.unit,
    })
    expect(plan.records[0].fingerprint).toBe('original-fingerprint')
    expect(plan.pins[0]).toMatchObject({ title: '白细胞总数趋势', indicatorCodes: ['CUSTOM_WBC'] })
  })

  it('keeps a chart on a source code that still has other unmerged names', async () => {
    const withRemainder = [...records, record('remaining', [indicator('CUSTOM_WBC', '另一项指标')])]
    const plan = await buildIndicatorOrganizationPlan(withRemainder, [pin], DEFAULT_PREFERENCES, [merge])
    expect(plan.pins[0].indicatorCodes).toEqual(['CUSTOM_WBC'])
    expect(plan.pins[0].title).toBe(pin.title)
  })

  it('rejects unknown targets, duplicate sources and cycles before changing anything', () => {
    expect(() => resolveIndicatorMerges(inventory, [{ ...merge, targetId: 'made-up' }])).toThrow('不存在')
    expect(() => resolveIndicatorMerges(inventory, [merge, merge])).toThrow('多个目标')
    expect(() => resolveIndicatorMerges(inventory, [merge, { ...merge, sourceId: merge.targetId, targetId: merge.sourceId }])).toThrow('循环')
  })

  it('rejects incompatible standard quantities and unit scales', () => {
    const variants = collectIndicatorGroups([record('variants', [
      indicator('NEUT_ABS', '中性粒细胞计数'), indicator('NEUT_PCT', '中性粒细胞百分比'),
      indicator('CUSTOM_X', '另一种计数', '%'), indicator('CUSTOM_SMALL', '小单位', 'mIU/mL'),
      indicator('CUSTOM_LARGE', '大单位', 'MIU/mL'),
    ])])
    const suggest = (from: string, to: string) => [{ sourceId: variants.find((group) => group.code === from)!.id, targetId: variants.find((group) => group.code === to)!.id, reason: 'test' }]
    expect(() => resolveIndicatorMerges(variants, suggest('NEUT_ABS', 'NEUT_PCT'))).toThrow('不同标准指标')
    expect(() => resolveIndicatorMerges(variants, suggest('CUSTOM_X', 'NEUT_ABS'))).toThrow('单位不一致')
    expect(() => resolveIndicatorMerges(variants, suggest('CUSTOM_SMALL', 'CUSTOM_LARGE'))).toThrow('单位不一致')
  })

  it('sends only the indicator inventory to the configured model and validates the returned ids', async () => {
    post.mockImplementation(async (_provider, _url, _key, body) => {
      const request = modelRequest(body)
      const source = request.indicators.find((group) => group.code === 'CUSTOM_WBC')
      const target = request.indicators.find((group) => group.code === 'WBC')!
      return reply(source ? [{ sourceId: source.id, targetId: target.id, reason: merge.reason, unit: null }] : [])
    })
    await expect(suggestIndicatorMerges(inventory, llm)).resolves.toMatchObject({ merges: [merge], completed: 2, total: 2 })
    const request = post.mock.calls[0][3]
    expect(modelRequest(request).indicators).toEqual(inventory.map((group, index) => ({ ...group, id: `g${index}` })))
    expect(JSON.stringify(request)).not.toContain('仅本地医院')
    expect(JSON.stringify(request)).not.toContain('仅本地结论')
    expect(JSON.stringify(request)).not.toContain('4.25')
    post.mockResolvedValue(reply([{ sourceId: 'g0', targetId: 'fake', reason: 'test', unit: null }]))
    const invalid = await suggestIndicatorMerges(inventory, llm)
    expect(invalid.merges).toEqual([])
    expect(invalid.issues.some((issue) => issue.message.includes('不存在'))).toBe(true)
    post.mockResolvedValue({ ok: false, status: 429, detail: 'rate limit' })
    await expect(suggestIndicatorMerges(inventory, llm)).rejects.toThrow('429')
  })

  it('fills missing units including dimensionless ratios only with an explicit approved decision', async () => {
    const ratios = [record('ratio', [indicator('RATIO_A', '白球比', ''), indicator('RATIO_B', '白球比例(A/G)', '')])]
    const groups = collectIndicatorGroups(ratios)
    expect(groups.every((group) => group.units.includes(''))).toBe(true)
    const correction = { sourceId: groups[0].id, targetId: groups[1].id, reason: '比值无量纲', unit: '无量纲' }
    expect(() => resolveIndicatorMerges(groups, [{ ...correction, unit: undefined }])).toThrow('单位不一致或缺失')
    const plan = await buildIndicatorOrganizationPlan(ratios, [], DEFAULT_PREFERENCES, [correction])
    expect(plan.records[0].indicators.every((item) => item.unit === '无量纲')).toBe(true)
    expect(plan.records[0].indicators.map((item) => item.value)).toEqual(ratios[0].indicators.map((item) => item.value))
    expect(plan.records[0].indicators[0].originalMeasurement?.unit).toBe('')
    expect(projectIndicatorGroups(groups, [correction])).toHaveLength(1)
  })

  it('converts result values and bounds together while preserving the original measurement through later edits', async () => {
    const source = { ...indicator('ENZYME_A', '胆碱酯酶', 'kU/L'), rawValue: '<4.25 kU/L', referenceText: '3.5–9.5 kU/L' }
    const target = indicator('ENZYME_B', '胆碱酯酶(CHE)', 'U/L')
    const enzymeRecords = [record('enzyme', [source, target])]
    const groups = collectIndicatorGroups(enzymeRecords)
    const correction = { sourceId: groups.find((group) => group.code === 'ENZYME_A')!.id, targetId: groups.find((group) => group.code === 'ENZYME_B')!.id, reason: '统一单位', unit: 'U/L' }
    const plan = await buildIndicatorOrganizationPlan(enzymeRecords, [], DEFAULT_PREFERENCES, [correction])
    const converted = plan.records[0].indicators[0]
    expect(converted).toMatchObject({ value: 4250, rawValue: '<4250', unit: 'U/L', referenceLow: 3500, referenceHigh: 9500, referenceText: '3500–9500' })
    expect(converted.originalMeasurement).toMatchObject({ value: 4.25, rawValue: '<4.25 kU/L', unit: 'kU/L' })
    expect(editedIndicator(indicatorDraft(converted), converted).originalMeasurement).toEqual(converted.originalMeasurement)
    expect(convertIndicatorUnit(converted, 'kU/L')).toMatchObject({ value: 4.25, originalMeasurement: converted.originalMeasurement })
    expect(source.value).toBe(4.25)
  })

  it('rejects incompatible dimensions, ambiguous references and prefix-case changes rather than relabeling values', () => {
    expect(indicatorUnitFactor('秒', 's')).toBe(1)
    expect(indicatorUnitFactor('µmol/L', 'mmol/L')).toBeCloseTo(0.001)
    expect(indicatorUnitFactor('ug/l', 'µg/L')).toBe(1)
    expect(() => indicatorUnitFactor('mg/L', 'mmol/L')).toThrow('不能可靠换算')
    expect(() => indicatorUnitFactor('MIU/mL', 'mIU/mL')).toThrow('不能可靠换算')
    expect(() => resolveIndicatorMerges(inventory, [{ ...merge, unit: '无量纲' }])).toThrow('不能可靠换算')
    expect(() => convertIndicatorUnit({ ...source, unit: 'kU/L', referenceText: '年龄18岁分层，详见报告' }, 'U/L')).toThrow('描述')
    expect(convertIndicatorUnit({ ...source, unit: '', value: 41, rawValue: '41' }, 'U/L').value).toBe(41)
    expect(convertIndicatorUnit({ ...source, unit: '', rawValue: '4.25 kU/L', referenceText: '' }, 'U/L').value).toBe(4250)
    expect(convertIndicatorUnit({ ...source, unit: 'kU/L', referenceLow: -2, referenceHigh: 0, referenceText: '-2-0' }, 'U/L').referenceText).toBe('-2000–0')
  })

  it('converts labeled and conditional reference ranges without scaling descriptive ages', () => {
    const prealbumin = {
      ...indicator('PREALB', '前白蛋白', 'g/L'), value: 0.2, rawValue: '0.2',
      referenceLow: 0.1, referenceHigh: 0.3,
      referenceText: '成人（18–65岁）：0.1–0.3 g/L；儿童：0.05–0.2（参考值）',
    }
    const converted = convertIndicatorUnit(prealbumin, 'mg/L')
    expect(converted).toMatchObject({
      value: 200, referenceLow: 100, referenceHigh: 300,
      referenceText: '成人（18–65岁）：100–300；儿童：50–200（参考值）',
    })
    expect(converted.originalMeasurement?.referenceText).toBe(prealbumin.referenceText)
    expect(convertIndicatorUnit({ ...prealbumin, referenceText: '参考范围(g/L)：0.1–0.3' }, 'mg/L').referenceText).toBe('参考范围：100–300')
    expect(convertIndicatorUnit({ ...prealbumin, referenceText: '男 0.1g/l–0.3g/l；女：≤0.2g/L' }, 'mg/L').referenceText).toBe('男 100–300；女：≤200')
    expect(convertIndicatorUnit({ ...prealbumin, referenceText: '详见原报告' }, 'mg/L').referenceText).toBe('详见原报告')
    expect(() => convertIndicatorUnit({ ...prealbumin, referenceText: '0.1–0.3 (mg/L)' }, 'mg/L')).toThrow('单位与指标单位不一致')
    expect(() => convertIndicatorUnit({ ...prealbumin, referenceText: '0.1–0.3 (mEq/L)' }, 'mg/L')).toThrow('无法识别的单位')
    expect(convertIndicatorUnit({
      ...indicator('RATIO', '比值', '1'), value: 1.05, rawValue: '1.05',
      referenceLow: null, referenceHigh: 1, referenceText: '<1',
    }, '%')).toMatchObject({ value: 105, rawValue: '105', referenceHigh: 100, referenceText: '<100' })
  })

  it('preflights target measurements and skips the entire unsafe merge chain, leaving unrelated merges applicable', async () => {
    const badSource = indicator('P_A', '前白蛋白缩写', 'mg/L')
    const badTarget = { ...indicator('P_B', '前白蛋白', 'g/L'), referenceText: '年龄18岁分层，详见报告' }
    const badAlias = indicator('P_C', '前白蛋白别名', 'g/L')
    const mixed = [record('mixed', [source, target, badSource, badTarget, badAlias])]
    const groups = collectIndicatorGroups(mixed)
    const id = (code: string) => groups.find((group) => group.code === code)!.id
    const review = reviewIndicatorMerges(mixed, [
      merge,
      { sourceId: id('P_A'), targetId: id('P_B'), reason: '合并', unit: 'mg/L' },
      { sourceId: id('P_C'), targetId: id('P_A'), reason: '合并', unit: 'mg/L' },
      { sourceId: id('P_B'), targetId: id('P_B'), reason: '统一单位', unit: 'mg/L' },
    ])
    expect(review.merges).toEqual([merge])
    expect(review.skippedGroups).toBe(1)
    expect(review.issues[0]).toMatchObject({ name: '前白蛋白' })
    const plan = await buildIndicatorOrganizationPlan(mixed, [pin], DEFAULT_PREFERENCES, review.merges)
    expect(plan.records[0].indicators[0].normalizedCode).toBe('WBC')
    expect(plan.records[0].indicators.slice(2)).toEqual([badSource, badTarget, badAlias])
    expect(plan.pins[0].indicatorCodes).toEqual(['WBC'])
  })

  it('checks concrete reference data before accepting an AI unit decision or publishing it to the next request', async () => {
    const mixed = [record('mixed', [source, target,
      indicator('P_A', '前白蛋白缩写', 'mg/L'),
      { ...indicator('P_B', '前白蛋白', 'g/L'), referenceText: '年龄18岁分层，详见报告' },
    ])]
    const groups = collectIndicatorGroups(mixed)
    post.mockImplementation(async (_provider, _url, _key, body) => {
      const { indicator: focus, indicators } = modelRequest(body)
      const code = focus.code === 'CUSTOM_WBC' ? 'WBC' : focus.code === 'P_A' ? 'P_B' : ''
      const target = indicators.find((group) => group.code === code)
      return reply(target ? [{ sourceId: focus.id, targetId: target.id, reason: '合并', unit: focus.code === 'P_A' ? 'mg/L' : null }] : [])
    })
    const result = await suggestIndicatorMerges(groups, llm, {
      getInventory: () => groups, isCancelled: () => false, onProgress: () => undefined,
      reviewMerges: (merges) => reviewIndicatorMerges(mixed, merges),
    })
    expect(result.merges).toEqual([{ ...merge, reason: '合并' }])
    expect(result.issues.some((issue) => issue.name === '前白蛋白')).toBe(true)
    const subsequent = post.mock.calls.map((call) => modelRequest(call[3])).find((request) => request.indicator.code === 'P_B')!
    expect(subsequent.indicator.units).toEqual(['g/L'])
  })

  it('checks every remaining indicator against the updated projected catalog and flattens accepted merges', async () => {
    const groups = collectIndicatorGroups([record('aliases', [
      indicator('A', '某指标'), indicator('B', '某指标别名'), indicator('C', '某指标简称'),
    ])])
    post.mockImplementation(async (_provider, _url, _key, body) => {
      const request = modelRequest(body)
      const target = request.indicators.find((group) => group.code === 'A')!
      const source = request.indicators.find((group) => group.code === (request.indicator.code === 'A' ? 'B' : 'C'))!
      return reply([{ sourceId: source.id, targetId: target.id, reason: '同一指标', unit: null }])
    })
    const result = await suggestIndicatorMerges(groups, llm)
    expect(post).toHaveBeenCalledTimes(2)
    expect(modelRequest(post.mock.calls[1][3]).indicators.map((group) => [group.code, group.count])).toEqual([['A', 2], ['C', 1]])
    expect(result).toMatchObject({ completed: 3, total: 3, stopped: false, issues: [] })
    expect(result.merges).toHaveLength(2)
    expect(projectIndicatorGroups(groups, result.merges)).toMatchObject([{ code: 'A', count: 3 }])
  })

  it('validates the live catalog again before sending and includes indicators added during progress', async () => {
    let live = inventory
    let changed = false
    post.mockResolvedValue(reply())
    const result = await suggestIndicatorMerges(inventory, llm, {
      getInventory: () => live, isCancelled: () => false,
      onProgress: () => {
        if (changed) return
        changed = true
        live = collectIndicatorGroups([record('new', [target, indicator('ADDED', '新增指标')])])
      },
    })
    expect(modelRequest(post.mock.calls[0][3]).indicators.map((group) => group.code)).toEqual(['ADDED', 'WBC'])
    expect(result.inventory).toEqual(live)
    expect(result.completed).toBe(2)
    expect(result.issues.some((issue) => issue.name === '指标列表变化')).toBe(true)
  })

  it('discards a response if its source disappears while the request is running', async () => {
    let live = inventory
    post.mockImplementationOnce(async () => {
      live = collectIndicatorGroups([record('new', [target])])
      return reply([{ sourceId: 'g0', targetId: 'g1', reason: '过期建议', unit: null }])
    }).mockResolvedValue(reply())
    const result = await suggestIndicatorMerges(inventory, llm, { getInventory: () => live, isCancelled: () => false, onProgress: () => undefined })
    expect(result.inventory).toEqual(live)
    expect(result.merges).toEqual([])
    expect(modelRequest(post.mock.calls[1][3]).indicators).toHaveLength(1)
  })

  it('isolates unsafe unit suggestions without losing later dimensionless merges', async () => {
    const groups = collectIndicatorGroups([record('units', [
      indicator('A', '酶指标', 'U/L'), indicator('B', '酶指标别名', 'mmol/L'),
      indicator('C', '比值指标', ''), indicator('D', '比值指标别名', ''),
    ])])
    post.mockImplementation(async (_provider, _url, _key, body) => {
      const { indicator: focus, indicators } = modelRequest(body)
      const target = indicators.find((group) => group.code === (focus.code === 'A' ? 'B' : 'D'))
      return reply(focus.code === 'A' || focus.code === 'C'
        ? [{ sourceId: focus.id, targetId: target!.id, reason: '同项', unit: focus.code === 'A' ? 'mmol/L' : '无量纲' }] : [])
    })
    const result = await suggestIndicatorMerges(groups, llm)
    expect(result.issues.some((issue) => issue.message.includes('不能可靠换算'))).toBe(true)
    expect(result.merges.some((merge) => merge.sourceId === groups.find((group) => group.code === 'C')!.id)).toBe(true)
    expect(result.completed).toBe(4)
  })

  it('propagates a later common-unit choice through the entire merged group', async () => {
    const groups = collectIndicatorGroups([record('units', [
      indicator('A', '酶指标别名', 'U/L'), indicator('B', '酶指标', 'U/L'), indicator('C', '酶指标简称', 'kU/L'),
    ])])
    post.mockImplementation(async (_provider, _url, _key, body) => {
      const { indicator: focus, indicators } = modelRequest(body)
      const target = indicators.find((group) => group.code === 'B')!
      return reply(focus.code === 'B' ? [] : [{ sourceId: focus.id, targetId: target.id, reason: '统一单位', unit: focus.code === 'A' ? 'U/L' : 'kU/L' }])
    })
    const result = await suggestIndicatorMerges(groups, llm)
    expect(result.merges.every((merge) => merge.unit === 'kU/L')).toBe(true)
    expect(projectIndicatorGroups(groups, result.merges)).toMatchObject([{ code: 'B', count: 3, units: ['kU/L'] }])
  })

  it('stops after an in-flight response without applying it or sending more requests', async () => {
    let cancelled = false
    post.mockImplementation(async () => {
      cancelled = true
      return reply([{ sourceId: 'g0', targetId: 'g1', reason: '取消后返回', unit: null }])
    })
    const result = await suggestIndicatorMerges(inventory, llm, { getInventory: () => inventory, isCancelled: () => cancelled, onProgress: () => undefined })
    expect(post).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ stopped: true, merges: [], completed: 0 })
  })
})
