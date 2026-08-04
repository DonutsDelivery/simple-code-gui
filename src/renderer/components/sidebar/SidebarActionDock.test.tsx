import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SidebarActionDock } from './SidebarActionDock'
import type { VoiceControlState } from '../VoiceControls'

const voice: VoiceControlState = {
  isRecording: false,
  isModelLoading: false,
  voiceInputTitle: 'Click to start voice input',
  handleVoiceInput: vi.fn(async () => {}),
  showLevelMeter: false,
  audioLevel: 0,
  silenceThreshold: 12,
  setSilenceThreshold: vi.fn(),
  pushToTalkEnabled: false,
  togglePushToTalk: vi.fn(),
  voiceOutputEnabled: false,
  installingTTS: false,
  ttsInstalled: true,
  handleVoiceOutput: vi.fn(async () => {}),
}

const project = {
  path: '/tmp/project',
  name: 'Project',
  apiPort: 4310,
} as any

function renderDock(overrides: Partial<React.ComponentProps<typeof SidebarActionDock>> = {}) {
  const props: React.ComponentProps<typeof SidebarActionDock> = {
    voice,
    focusedProject: project,
    apiStatus: { running: false },
    isDebugMode: true,
    onOpenSettings: vi.fn(),
    onOpenProjectSettings: vi.fn(),
    onToggleApi: vi.fn(),
    onOpenConnections: vi.fn(),
    ...overrides,
  }
  return { ...render(<SidebarActionDock {...props} />), props }
}

describe('SidebarActionDock', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps only the primary actions directly visible and labels every control', () => {
    renderDock()

    expect(screen.getByRole('button', { name: 'Click to start voice input' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Connections and mobile pairing' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Open settings' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'More sidebar actions' })).toBeVisible()
    expect(screen.queryByText('Start project API')).not.toBeInTheDocument()
    expect(screen.queryByText('Voice output')).not.toBeInTheDocument()
  })

  it('moves secondary and contextual controls into the overflow', async () => {
    const { props } = renderDock()
    fireEvent.click(screen.getByRole('button', { name: 'More sidebar actions' }))

    expect(await screen.findByRole('menuitem', { name: /Automatic voice input/ })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: /Voice output/ })).toBeVisible()
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /Start project API/ }))
    })
    expect(props.onToggleApi).toHaveBeenCalledWith(project)
  })

  it('supports roving focus and restores focus after Escape', async () => {
    renderDock()
    const trigger = screen.getByRole('button', { name: 'More sidebar actions' })
    fireEvent.click(trigger)

    const inputMode = await screen.findByRole('menuitem', { name: /Automatic voice input/ })
    const voiceOutput = screen.getByRole('menuitem', { name: /Voice output/ })
    await waitFor(() => expect(inputMode).toHaveFocus())

    fireEvent.keyDown(inputMode, { key: 'ArrowDown' })
    expect(voiceOutput).toHaveFocus()
    fireEvent.keyDown(voiceOutput, { key: 'Escape' })

    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('uses one toolbar tab stop and arrow-key navigation across primary actions', () => {
    renderDock()
    const toolbar = screen.getByRole('toolbar', { name: 'Sidebar actions' })
    const voiceButton = screen.getByRole('button', { name: 'Click to start voice input' })
    const connectionsButton = screen.getByRole('button', { name: 'Connections and mobile pairing' })
    const settingsButton = screen.getByRole('button', { name: 'Open settings' })
    const moreButton = screen.getByRole('button', { name: 'More sidebar actions' })

    expect(voiceButton).toHaveAttribute('tabindex', '0')
    expect(connectionsButton).toHaveAttribute('tabindex', '-1')
    voiceButton.focus()
    fireEvent.keyDown(toolbar, { key: 'ArrowRight' })
    expect(connectionsButton).toHaveFocus()
    expect(connectionsButton).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(toolbar, { key: 'End' })
    expect(moreButton).toHaveFocus()
    fireEvent.keyDown(toolbar, { key: 'ArrowLeft' })
    expect(settingsButton).toHaveFocus()
  })

  it('uses all available width when the Connections action is absent', () => {
    renderDock({ onOpenConnections: undefined })
    const toolbar = screen.getByRole('toolbar', { name: 'Sidebar actions' })

    expect(toolbar).toHaveStyle({ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' })
    expect(screen.queryByRole('button', { name: 'Connections and mobile pairing' })).not.toBeInTheDocument()
  })

  it('omits project and debug actions when their context is absent', async () => {
    renderDock({ focusedProject: undefined, apiStatus: undefined, isDebugMode: false })
    fireEvent.click(screen.getByRole('button', { name: 'More sidebar actions' }))

    await screen.findByRole('menu')
    expect(screen.queryByRole('menuitem', { name: /project API/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Refresh interface/i })).not.toBeInTheDocument()
  })
})
