export function cleanIndicatorName(name: string) {
  return name.trim()
    .replace(/^[*＊★☆※✱✳•●↑↓↗↘▲▼\s]+|[*＊★☆※✱✳•●↑↓↗↘▲▼\s]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function cleanReportResult(value: string) {
  return value.replace(/[↑↓↗↘▲▼]/g, '')
    .replace(/\s+[HL]$/i, '')
    .replace(/^[*＊★☆※✱✳\s]+|[*＊★☆※✱✳\s]+$/gu, '')
    .trim()
}
