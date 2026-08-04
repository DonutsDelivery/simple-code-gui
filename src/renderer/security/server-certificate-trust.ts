import { hasNativeServerTrust, probeNativeServerCertificate, trustNativeServerCertificate } from './native-server-trust.js'

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
}

export async function trustServerEndpoint(endpoint: string, fingerprint: string): Promise<void> {
  const url = new URL(endpoint)
  if (url.protocol === 'http:' && isLoopback(url.hostname)) return
  if (url.protocol !== 'https:') throw new Error('Remote pairing requires HTTPS')
  if (!fingerprint) throw new Error('The pairing offer did not include a certificate fingerprint')
  if (hasNativeServerTrust()) {
    await trustNativeServerCertificate(endpoint, fingerprint)
    return
  }

  const trust = window.electronAPI?.trustServerCertificate
  if (!trust) throw new Error('Certificate pinning is unavailable on this platform')
  await trust(endpoint, fingerprint)
}

export async function probeAndTrustServerEndpoint(endpoint: string): Promise<string> {
  const url = new URL(endpoint)
  if (url.protocol === 'http:' && isLoopback(url.hostname)) return ''
  if (url.protocol !== 'https:') throw new Error('Remote pairing requires HTTPS')
  if (hasNativeServerTrust()) {
    const fingerprint = await probeNativeServerCertificate(endpoint)
    await trustNativeServerCertificate(endpoint, fingerprint)
    return fingerprint
  }
  const probe = window.electronAPI?.probeServerCertificate
  if (!probe) throw new Error('Certificate probing is unavailable on this platform')
  const fingerprint = await probe(endpoint)
  await trustServerEndpoint(endpoint, fingerprint)
  return fingerprint
}
