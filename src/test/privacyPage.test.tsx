import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PrivacyPage } from '../pages/PrivacyPage'

describe('PrivacyPage', () => {
  afterEach(cleanup)

  it('explains local storage and the LLM data flow', () => {
    render(<PrivacyPage />)

    expect(screen.getByRole('heading', { name: '隐私说明' })).toBeInTheDocument()
    expect(screen.getByText(/项目维护者无法查看、恢复或远程删除这些数据/)).toBeInTheDocument()
    expect(screen.getByText(/未开启本地脱敏时，图片识别会发送原图/)).toBeInTheDocument()
    expect(screen.getByText(/自动识别与脱敏可能存在遗漏/)).toBeInTheDocument()
    expect(screen.getByText(/自动协商临时密钥并加密传输，不需要输入配对码/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回设置' })).toHaveAttribute('href', '#/settings')
  })
})
