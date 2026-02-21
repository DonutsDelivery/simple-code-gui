/**
 * HTTP Backend Helpers
 *
 * Network helper functions for the HTTP backend.
 */

/**
 * Check if host is a local/private network address (including Tailscale)
 */
export function isLocalNetwork(hostname: string): boolean {
  // RFC 1918 private ranges + Tailscale CGNAT (100.64-127.x.x) + MagicDNS (*.ts.net)
  return (
    /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(
      hostname
    ) || hostname.endsWith('.ts.net')
  )
}
