/**
 * Host storage utilities using Capacitor Preferences
 */

import { Preferences } from '@capacitor/preferences'
import type { SavedHost } from './types.js'

const HOSTS_STORAGE_KEY = 'donutcode-saved-servers'
const LEGACY_HOSTS_STORAGE_KEY = 'claude-terminal-saved-hosts'

export async function loadSavedHostsAsync(): Promise<SavedHost[]> {
  try {
    let { value } = await Preferences.get({ key: HOSTS_STORAGE_KEY })
    if (!value) {
      const legacy = await Preferences.get({ key: LEGACY_HOSTS_STORAGE_KEY })
      value = legacy.value
      if (value) await Preferences.set({ key: HOSTS_STORAGE_KEY, value })
    }
    console.log('[ConnectionScreen] Loading saved hosts from Preferences:', value)
    if (!value) return []
    const hosts = JSON.parse(value) as SavedHost[]
    console.log('[ConnectionScreen] Parsed saved hosts:', hosts.length, 'hosts')
    return hosts
  } catch (e) {
    console.error('[ConnectionScreen] Error loading saved hosts:', e)
    return []
  }
}

export async function saveSavedHostsAsync(hosts: SavedHost[]): Promise<void> {
  try {
    console.log('[ConnectionScreen] Saving', hosts.length, 'hosts to Preferences')
    await Preferences.set({ key: HOSTS_STORAGE_KEY, value: JSON.stringify(hosts) })
    console.log('[ConnectionScreen] Saved successfully')
  } catch (e) {
    console.error('[ConnectionScreen] Error saving hosts:', e)
  }
}

export function generateHostId(): string {
  return `host-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
