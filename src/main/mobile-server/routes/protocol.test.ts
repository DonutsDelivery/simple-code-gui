import { createServer, type Server } from 'http'
import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import { createServerProtocolDescriptor } from '../../../common/server-protocol'
import { setupProtocolRoutes } from './protocol'

let server: Server | null = null

afterEach(async () => {
  if (!server) return
  await new Promise<void>((resolve, reject) => {
    server!.close(error => error ? reject(error) : resolve())
  })
  server = null
})

describe('protocol route', () => {
  it('serves the versioned DonutCode protocol descriptor over HTTP', async () => {
    const app = express()
    setupProtocolRoutes(app, () => createServerProtocolDescriptor('1.3.58', 'server-test', 'linux'))
    server = createServer(app)
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected TCP server address')

    const response = await fetch(`http://127.0.0.1:${address.port}/api/protocol`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      protocol: 'donutcode-server',
      minVersion: 1,
      maxVersion: 1,
      serverVersion: '1.3.58',
    })
  })
})
