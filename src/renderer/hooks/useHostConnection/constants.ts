// ============================================
// Constants for useHostConnection
// ============================================

export const STORAGE_KEY = 'claude-terminal-hosts'
export const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000] // Exponential backoff
export const MAX_RECONNECT_ATTEMPTS = 5
export const PING_INTERVAL = 30000 // 30 seconds
export const PONG_TIMEOUT = 10000 // 10 seconds
