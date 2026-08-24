import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LocaleSetup } from '../components/LocaleSetup'

describe('LocaleSetup', () => {
  it('collects language and region before completing first-run setup', async () => {
    const onComplete = vi.fn(async () => undefined)
    render(<LocaleSetup initialValue={{ region: 'CN', language: 'zh-CN', setupCompleted: false }} onComplete={onComplete} />)

    fireEvent.click(screen.getByRole('button', { name: 'English' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Region' }), { target: { value: 'US' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith({ region: 'US', language: 'en', setupCompleted: true }))
  })
})
