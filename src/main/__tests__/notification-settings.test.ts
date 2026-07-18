import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/mock/userData' } }))
vi.mock('../meta-project-sync', () => ({ syncMetaProjects: vi.fn() }))
vi.mock('fs', () => {
  const mocked = {
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(() => JSON.stringify({ workspace: { projects: [], openTabs: [], activeTabId: null } })),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    unlinkSync: vi.fn(),
    statSync: vi.fn(() => ({ size: 0 })),
  }
  return { ...mocked, default: mocked }
})

import { SessionStore } from '../session-store'

describe('notification settings persistence', () => {
  beforeEach(() => vi.clearAllMocks())

  // AC: @agent-session-notifications ac-6
  it('defaults, clamps, and preserves voice settings independently', () => {
    const store = new SessionStore()
    expect(store.getSettings()).toMatchObject({
      notificationSoundsEnabled: true,
      notificationVolume: 0.65,
    })

    store.saveSettings({
      defaultProjectDir: '',
      theme: 'default',
      voiceOutputEnabled: true,
      voiceVolume: 0.2,
      notificationSoundsEnabled: false,
      notificationVolume: 4,
    })

    expect(store.getSettings()).toMatchObject({
      voiceOutputEnabled: true,
      voiceVolume: 0.2,
      notificationSoundsEnabled: false,
      notificationVolume: 1,
    })
  })
})
