import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AgentNotificationSettings } from '../components/settings/AgentNotificationSettings'

vi.mock('../utils/agentNotificationAudio', () => ({ playAgentNotificationSound: vi.fn() }))

import { playAgentNotificationSound } from '../utils/agentNotificationAudio'

describe('AgentNotificationSettings', () => {
  // AC: @agent-session-notifications ac-6
  it('changes notification controls without exposing TTS controls', () => {
    const onChange = vi.fn()
    render(<AgentNotificationSettings enabled volume={0.65} onChange={onChange} />)

    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '0.4' } })
    expect(onChange).toHaveBeenCalledWith({ enabled: true, volume: 0.4 })
    expect(screen.queryByText(/text-to-speech/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Test completed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Test needs input' }))
    expect(playAgentNotificationSound).toHaveBeenNthCalledWith(1, 'completed', 0.65)
    expect(playAgentNotificationSound).toHaveBeenNthCalledWith(2, 'needs-input', 0.65)
  })
})
