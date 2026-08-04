import { Capacitor, registerPlugin } from '@capacitor/core'

interface ServerTrustPlugin {
  probe(options: { endpoint: string }): Promise<{ fingerprint: string }>
  trust(options: { endpoint: string; fingerprint: string }): Promise<void>
  remove(options: { endpoint: string }): Promise<void>
}

const ServerTrust = registerPlugin<ServerTrustPlugin>('ServerTrust')

export function hasNativeServerTrust(): boolean {
  return Capacitor.isNativePlatform()
}

export async function probeNativeServerCertificate(endpoint: string): Promise<string> {
  return (await ServerTrust.probe({ endpoint })).fingerprint
}

export async function trustNativeServerCertificate(endpoint: string, fingerprint: string): Promise<void> {
  await ServerTrust.trust({ endpoint, fingerprint })
}
