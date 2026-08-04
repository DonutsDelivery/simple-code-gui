export const DONUTCODE_PROTOCOL_NAME = 'donutcode-server'
export const DONUTCODE_PROTOCOL_VERSION = 1
export const DONUTCODE_MIN_PROTOCOL_VERSION = 1

export interface ServerProtocolCapabilities {
  workspaceRead: boolean
  workspaceWrite: boolean
  settingsRead: boolean
  settingsWrite: boolean
  sessionDiscovery: boolean
  pty: boolean
  tts: boolean
  apiOpenSessionEvents: boolean
  orchestratorSessionEvents: boolean
  ptyRecreatedEvents: boolean
  agentSessionSignalEvents: boolean
  environmentSnapshots: boolean
  environmentCommands: boolean
  environmentEvents: boolean
}

export interface ServerProtocolDescriptor {
  protocol: typeof DONUTCODE_PROTOCOL_NAME
  protocolVersion: number
  minimumClientVersion: number
  minVersion: number
  maxVersion: number
  serverId: string
  serverVersion: string
  platform: 'linux' | 'darwin' | 'win32'
  capabilities: ServerProtocolCapabilities
}

export interface CommandEnvelope<T> {
  commandId: string
  clientId: string
  serverId: string
  expectedRevision?: number
  command: T
}

export interface EventEnvelope<T> {
  serverId: string
  revision: number
  eventId: string
  occurredAt: number
  event: T
}

export class UnsupportedCapabilityError extends Error {
  readonly code = 'UNSUPPORTED_CAPABILITY'

  constructor(readonly capability: keyof ServerProtocolCapabilities) {
    super(`Connected server does not support capability: ${capability}`)
    this.name = 'UnsupportedCapabilityError'
  }
}

export const MOBILE_SERVER_CAPABILITIES: ServerProtocolCapabilities = {
  workspaceRead: true,
  workspaceWrite: true,
  settingsRead: true,
  settingsWrite: true,
  sessionDiscovery: true,
  pty: true,
  tts: true,
  apiOpenSessionEvents: false,
  orchestratorSessionEvents: false,
  ptyRecreatedEvents: false,
  agentSessionSignalEvents: true,
  environmentSnapshots: true,
  environmentCommands: true,
  environmentEvents: true,
}

export function createServerProtocolDescriptor(
  serverVersion: string,
  serverId = 'unknown',
  platform: ServerProtocolDescriptor['platform'] = 'linux'
): ServerProtocolDescriptor {
  return {
    protocol: DONUTCODE_PROTOCOL_NAME,
    protocolVersion: DONUTCODE_PROTOCOL_VERSION,
    minimumClientVersion: DONUTCODE_MIN_PROTOCOL_VERSION,
    minVersion: DONUTCODE_MIN_PROTOCOL_VERSION,
    maxVersion: DONUTCODE_PROTOCOL_VERSION,
    serverId,
    serverVersion,
    platform,
    capabilities: { ...MOBILE_SERVER_CAPABILITIES },
  }
}

export function assertCompatibleServerProtocol(value: unknown): asserts value is ServerProtocolDescriptor {
  if (!value || typeof value !== 'object') {
    throw new Error('Server did not return a DonutCode protocol descriptor')
  }

  const descriptor = value as Partial<ServerProtocolDescriptor>
  if (descriptor.protocol !== DONUTCODE_PROTOCOL_NAME) {
    throw new Error(`Unsupported server protocol: ${String(descriptor.protocol || 'unknown')}`)
  }
  if (!descriptor.serverId || typeof descriptor.serverId !== 'string') {
    throw new Error('Server protocol descriptor is missing server identity')
  }
  if (typeof descriptor.minVersion !== 'number' || typeof descriptor.maxVersion !== 'number') {
    throw new Error('Server protocol descriptor is missing its supported version range')
  }
  if (
    descriptor.minVersion > DONUTCODE_PROTOCOL_VERSION
    || descriptor.maxVersion < DONUTCODE_MIN_PROTOCOL_VERSION
  ) {
    throw new Error(
      `Incompatible DonutCode protocol versions: client ${DONUTCODE_MIN_PROTOCOL_VERSION}-${DONUTCODE_PROTOCOL_VERSION}, server ${descriptor.minVersion}-${descriptor.maxVersion}`
    )
  }
  if (!descriptor.capabilities || typeof descriptor.capabilities !== 'object') {
    throw new Error('Server protocol descriptor is missing capabilities')
  }
}
