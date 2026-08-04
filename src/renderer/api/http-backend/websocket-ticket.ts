export async function requestWebSocketTicket(wsBaseUrl: string, token: string, purpose: string): Promise<string> {
  const httpBaseUrl = wsBaseUrl.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:')
  const response = await fetch(`${httpBaseUrl}/api/auth/websocket-ticket`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ purpose }),
  })
  if (!response.ok) throw new Error(`WebSocket ticket request failed: HTTP ${response.status}`)
  const body = await response.json() as { ticket?: string }
  if (!body.ticket) throw new Error('WebSocket ticket response was invalid')
  return body.ticket
}
