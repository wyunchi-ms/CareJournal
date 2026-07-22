import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ImagePreview } from '../components/ImagePreview'

afterEach(cleanup)

describe('image preview', () => {
  it('supports explicit zoom and reset controls', () => {
    render(<ImagePreview src="data:image/jpeg;base64,preview" alt="检查单" />)

    fireEvent.click(screen.getByRole('button', { name: '放大预览：检查单' }))
    const previewImage = screen.getAllByAltText('检查单')[1]
    expect(previewImage).toHaveStyle({ transform: 'translate3d(0px, 0px, 0) scale(1)' })

    fireEvent.click(screen.getByRole('button', { name: '放大图片' }))
    expect(previewImage).toHaveStyle({ transform: 'translate3d(0px, 0px, 0) scale(1.5)' })

    fireEvent.click(screen.getByRole('button', { name: '恢复原始缩放' }))
    expect(previewImage).toHaveStyle({ transform: 'translate3d(0px, 0px, 0) scale(1)' })
    expect(screen.getByText('双指缩放，放大后单指拖动；双击可快速切换')).toBeInTheDocument()
  })
})
