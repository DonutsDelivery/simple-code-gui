// Re-export everything from the useHostConnection module
export { useHostConnection, default } from './useHostConnection.js'
export type {
  HostConfig,
  ConnectionState,
  ConnectionMethod,
  PendingFile,
  HostConnectionState,
  HostConnectionActions,
  UseHostConnectionReturn,
  ConnectOptions
} from './types.js'
export { STORAGE_KEY, RECONNECT_DELAYS, MAX_RECONNECT_ATTEMPTS, PING_INTERVAL, PONG_TIMEOUT } from './constants.js'
