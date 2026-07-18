import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceViewToggle } from '../components/WorkspaceViewToggle'

describe('WorkspaceViewToggle', () => {
  // AC: @canvas-workspace ac-1
  // AC: @canvas-accessibility ac-1
  it('exposes the selected view and switches without replacing workspace content', () => {
    const onChange = vi.fn()
    render(<WorkspaceViewToggle value="tiles" onChange={onChange} />)

    expect(screen.getByRole('button', { name: 'Tiles' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Canvas' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Canvas' }))
    expect(onChange).toHaveBeenCalledWith('canvas')
  })
})
