import type { ParsedConnectionUrl } from '../QRScanner.js'

/**
 * Parse claude-terminal:// URL into connection parameters
 */
export function parseDeepLink(url: string): ParsedConnectionUrl | null {
  try {
    // Format: claude-terminal://host:port?token=xxx&nonce=xxx&fingerprint=xxx
    const match = url.match(/^claude-terminal:\/\/([^:/?]+):(\d+)\?(.+)$/)
    if (!match) return null

    const [, host, portStr, queryStr] = match
    const params = new URLSearchParams(queryStr)

    return {
      host,
      port: parseInt(portStr, 10),
      token: params.get('token') || '',
      nonce: params.get('nonce') || undefined,
      fingerprint: params.get('fingerprint') || undefined,
      nonceExpires: params.get('nonceExpires') ? parseInt(params.get('nonceExpires')!, 10) : undefined,
      version: 2
    }
  } catch {
    return null
  }
}

/**
 * Check if host is a local/private network address (including Tailscale)
 */
export function isLocalNetwork(hostname: string): boolean {
  // RFC 1918 private ranges + Tailscale CGNAT (100.64-127.x.x) + MagicDNS (*.ts.net)
  return /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(hostname) ||
         hostname.endsWith('.ts.net')
}

/**
 * Build HTTP URL with proper protocol based on network type or secure flag
 */
export function buildHttpUrl(host: { host: string; port: number; secure?: boolean }, path: string): string {
  // Validate port before building URL
  if (!host.port || host.port < 1 || host.port > 65535) {
    console.error('[MobileApp] Invalid port for HTTP URL:', host.port)
    throw new Error(`Invalid port: ${host.port}`)
  }
  // Use https if server has TLS enabled, otherwise fallback to network-based detection
  const protocol = host.secure ?? !isLocalNetwork(host.host) ? 'https' : 'http'
  return `${protocol}://${host.host}:${host.port}${path}`
}
