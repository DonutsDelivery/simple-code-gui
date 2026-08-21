import { loadDeviceCredential, storeDeviceCredential } from './device-credentials.js'

const PAIRING_DEVICE_ID_KEY = 'pairing-device-id-v1'
const LEGACY_DEVICE_ID_KEY = 'donutcode-device-id'

let cachedDeviceId: string | null = null

/** Stable per-install identity used for every pairing method and retry. */
export async function getPairingDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId

  const durable = await loadDeviceCredential(PAIRING_DEVICE_ID_KEY)
  if (durable) {
    cachedDeviceId = durable
    return durable
  }

  let deviceId = ''
  try {
    deviceId = localStorage.getItem(LEGACY_DEVICE_ID_KEY) || ''
  } catch {
    // Durable secure storage remains the source of truth.
  }
  if (!deviceId) deviceId = crypto.randomUUID()

  await storeDeviceCredential(PAIRING_DEVICE_ID_KEY, deviceId)
  try {
    localStorage.setItem(LEGACY_DEVICE_ID_KEY, deviceId)
  } catch {
    // The encrypted durable copy is sufficient.
  }
  cachedDeviceId = deviceId
  return deviceId
}
