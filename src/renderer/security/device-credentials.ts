import { Capacitor } from '@capacitor/core'
import { SecureStorage } from '@aparajita/capacitor-secure-storage'

const memoryCredentials = new Map<string, string>()
const PREFIX = 'donutcode-device-credential:'

export async function storeDeviceCredential(reference: string, credential: string): Promise<void> {
  if (!reference || !credential) throw new Error('Credential reference and value are required')
  if (Capacitor.isNativePlatform()) {
    await SecureStorage.set(`${PREFIX}${reference}`, credential)
    return
  }
  if (window.electronAPI?.storeSecureCredential) {
    const stored = await window.electronAPI.storeSecureCredential(reference, credential)
    if (stored) return
  }
  memoryCredentials.set(reference, credential)
}

export async function loadDeviceCredential(reference: string): Promise<string | null> {
  if (!reference) return null
  if (Capacitor.isNativePlatform()) {
    const value = await SecureStorage.get(`${PREFIX}${reference}`)
    return typeof value === 'string' ? value : null
  }
  if (window.electronAPI?.loadSecureCredential) {
    const value = await window.electronAPI.loadSecureCredential(reference)
    if (value) return value
  }
  return memoryCredentials.get(reference) ?? null
}

export async function removeDeviceCredential(reference: string): Promise<void> {
  if (!reference) return
  if (Capacitor.isNativePlatform()) {
    await SecureStorage.remove(`${PREFIX}${reference}`)
    return
  }
  if (window.electronAPI?.removeSecureCredential) {
    await window.electronAPI.removeSecureCredential(reference)
  }
  memoryCredentials.delete(reference)
}
