import { describe, expect, it } from 'vitest'
import {
  DONUTCODE_PROTOCOL_VERSION,
  assertCompatibleServerProtocol,
  createServerProtocolDescriptor,
} from './server-protocol'

describe('DonutCode server protocol', () => {
  it('publishes the supported version and explicit capabilities', () => {
    const descriptor = createServerProtocolDescriptor('1.3.58')

    expect(descriptor).toMatchObject({
      protocol: 'donutcode-server',
      minVersion: DONUTCODE_PROTOCOL_VERSION,
      maxVersion: DONUTCODE_PROTOCOL_VERSION,
      serverVersion: '1.3.58',
      capabilities: {
        workspaceRead: true,
        workspaceWrite: true,
        orchestratorSessionEvents: false,
        agentSessionSignalEvents: true,
        environmentSnapshots: true,
        environmentCommands: true,
        environmentEvents: true,
      },
    })
    expect(() => assertCompatibleServerProtocol(descriptor)).not.toThrow()
  })

  it('rejects incompatible server versions with a useful error', () => {
    const descriptor = {
      ...createServerProtocolDescriptor('future'),
      minVersion: DONUTCODE_PROTOCOL_VERSION + 1,
      maxVersion: DONUTCODE_PROTOCOL_VERSION + 1,
    }

    expect(() => assertCompatibleServerProtocol(descriptor)).toThrow(
      /Incompatible DonutCode protocol versions/
    )
  })
})
