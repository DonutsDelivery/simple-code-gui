import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsModal } from './SettingsModal'

vi.mock('../contexts/VoiceContext', () => ({
  useVoice: () => ({
    whisperModel: 'base.en',
    setWhisperModel: vi.fn(),
    volume: 1,
  }),
}))
vi.mock('../hooks/useFocusTrap', () => ({
  useFocusTrap: () => ({ current: null }),
}))

describe('SettingsModal notification persistence', () => {
  beforeEach(() => {
    delete (window as any).electronAPI
  })

  // AC: @agent-session-notifications ac-6
  it('loads and saves notification settings through the active API without dropping other settings', async () => {
    const settings = {
      defaultProjectDir: '/projects',
      theme: 'default',
      notificationSoundsEnabled: false,
      notificationVolume: 0.25,
      voiceOutputEnabled: true,
    }
    const api = {
      getSettings: vi.fn().mockResolvedValue(settings),
      saveSettings: vi.fn().mockResolvedValue(undefined),
    } as any
    const onSaved = vi.fn()
    const { container } = render(
      <SettingsModal
        isOpen
        api={api}
        settings={settings}
        onClose={vi.fn()}
        onThemeChange={vi.fn()}
        onSaved={onSaved}
      />,
    )

    const enabled = await screen.findByLabelText('Play notification sounds')
    expect(enabled).not.toBeChecked()
    fireEvent.click(enabled)
    fireEvent.click(container.querySelector('.modal-footer .btn-primary') as HTMLButtonElement)

    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledOnce())
    expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      notificationSoundsEnabled: true,
      notificationVolume: 0.25,
      voiceOutputEnabled: true,
    }))
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({
      notificationSoundsEnabled: true,
      voiceOutputEnabled: true,
    }))
  })
})
