import { normalizeReportType } from '../data/reportTypeAliases'
import type { ExamRecord } from '../types'

export function recordDisplayType(record: ExamRecord) {
  return record.normalizedReportType || normalizeReportType(record.reportType).label
}
