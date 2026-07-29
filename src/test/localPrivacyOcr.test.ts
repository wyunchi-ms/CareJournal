import { describe, expect, it, vi } from 'vitest'
import { extractPrivacySafeText, redactSensitiveText } from '../services/localPrivacyOcr'

vi.mock('@paddleocr/paddleocr-js', () => ({
  PaddleOCR: {
    create: vi.fn(async () => ({
      predict: vi.fn(async () => [{
        items: [
          { text: '浙江大学医学院附属儿童医院', score: 0.99 },
          { text: '科室：血液科', score: 0.99 },
          { text: '姓名：张三', score: 0.98 },
          { text: '病案号：A123456', score: 0.98 },
          { text: '白细胞 5.2 10^9/L', score: 0.96 },
        ],
      }]),
    })),
  },
}))

describe('local privacy redaction', () => {
  it('removes patient identifiers while preserving hospital and department', () => {
    const result = redactSensitiveText([
      '浙江大学医学院附属儿童医院',
      '科室：血液科',
      '患者姓名：张三 性别：男',
      '病案号：A20260729001',
      '住院号 99887766',
      '联系电话：13800138000',
      '身份证号：33010219900101123X',
      '血红蛋白 132 g/L',
    ].join('\n'))

    expect(result.text).toContain('浙江大学医学院附属儿童医院')
    expect(result.text).toContain('科室：血液科')
    expect(result.text).toContain('血红蛋白 132 g/L')
    expect(result.text).not.toContain('张三')
    expect(result.text).not.toContain('A20260729001')
    expect(result.text).not.toContain('99887766')
    expect(result.text).not.toContain('13800138000')
    expect(result.text).not.toContain('33010219900101123X')
    expect(result.redactedFields).toBe(5)
  })

  it('redacts standalone phone and identity numbers without removing clinical values', () => {
    const result = redactSensitiveText('联系电话缺失\n13800138000\n33010219900101123X\n白细胞 5.2 10^9/L')

    expect(result.text).toContain('白细胞 5.2 10^9/L')
    expect(result.text.match(/\[已脱敏\]/g)).toHaveLength(2)
  })

  it('returns only redacted text from the local PaddleOCR image path', async () => {
    const result = await extractPrivacySafeText({
      id: 'image-1',
      name: 'report.jpg',
      mimeType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,AA==',
      sha256: 'hash',
    })

    expect(result.source).toBe('paddle-ocr')
    expect(result.text).toContain('浙江大学医学院附属儿童医院')
    expect(result.text).toContain('科室：血液科')
    expect(result.text).toContain('白细胞 5.2 10^9/L')
    expect(result.text).not.toContain('张三')
    expect(result.text).not.toContain('A123456')
  })
})
