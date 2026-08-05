import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectDirectorySettings } from './ProjectDirectorySettings'

describe('ProjectDirectorySettings', () => {
  afterEach(() => {
    delete (window as typeof window & { electronAPI?: unknown }).electronAPI
  })

  it('allows a connected mobile client to enter a server directory', () => {
    const onChange = vi.fn()
    render(<ProjectDirectorySettings defaultProjectDir="" onChange={onChange} />)

    const input = screen.getByLabelText('Default Project Directory')
    expect(input).not.toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: 'Browse' })).not.toBeInTheDocument()

    fireEvent.change(input, { target: { value: '/srv/projects' } })
    expect(onChange).toHaveBeenCalledWith('/srv/projects')
  })

  it('keeps the native directory picker on desktop', async () => {
    const selectDirectory = vi.fn().mockResolvedValue('/home/user/projects')
    ;(window as typeof window & { electronAPI?: { selectDirectory: typeof selectDirectory } }).electronAPI = { selectDirectory }
    const onChange = vi.fn()
    render(<ProjectDirectorySettings defaultProjectDir="" onChange={onChange} />)

    expect(screen.getByLabelText('Default Project Directory')).toHaveAttribute('readonly')
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }))

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('/home/user/projects'))
  })
})
