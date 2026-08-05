import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WelcomeView } from './WelcomeView'

describe('WelcomeView', () => {
  it('exposes signed-offer paste as the primary pairing path', () => {
    const setView = vi.fn()

    render(
      <WelcomeView
        error={null}
        savedHosts={[]}
        setView={setView}
        onConnectToSavedHost={vi.fn()}
        onRemoveSavedHost={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Paste pairing link' }))
    expect(setView).toHaveBeenCalledWith('paste')
    expect(screen.getByRole('button', { name: 'Scan QR Code' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Manual Entry' })).toBeTruthy()
  })
})
