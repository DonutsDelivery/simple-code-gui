import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { EnvironmentRuntime } from '../environment-runtime'
import { HeadlessServer, readRuntimeInfo } from '../headless-server'

const tempDirs: string[] = []
const runtimes: EnvironmentRuntime[] = []

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.stop()))
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('EnvironmentRuntime headless lifecycle', () => {
  it('serves canonical environment state without an Electron window', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'donutcode-headless-'))
    tempDirs.push(dataDir)
    const runtime = new EnvironmentRuntime({
      dataDir,
      appPath: process.cwd(),
      version: 'test-version',
      serverId: 'server-headless',
      host: '127.0.0.1',
      port: 0,
    })
    runtimes.push(runtime)

    const endpoint = await runtime.start()
    expect(endpoint).toMatchObject({
      serverId: 'server-headless',
      host: '127.0.0.1',
      version: 'test-version',
      secure: false,
    })
    expect(endpoint.port).toBeGreaterThan(0)

    const health = await fetch(`http://${endpoint.host}:${endpoint.port}/health`)
    await expect(health.json()).resolves.toMatchObject({ status: 'ok' })

    const token = runtime.server.getConnectionInfo().token
    const snapshot = await fetch(`http://${endpoint.host}:${endpoint.port}/api/environment/snapshot`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(snapshot.status).toBe(200)
    await expect(snapshot.json()).resolves.toMatchObject({
      serverId: 'server-headless',
      revision: 0,
    })
  })

  it('publishes atomic runtime identity and rejects a second live owner', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'donutcode-headless-info-'))
    tempDirs.push(dataDir)
    const options = {
      dataDir,
      appPath: process.cwd(),
      version: 'test-version',
      serverId: 'server-headless-info',
      host: '127.0.0.1',
      port: 0,
    }
    const server = new HeadlessServer(options)
    runtimes.push(server.runtime)
    const info = await server.start()

    expect(readRuntimeInfo(dataDir)).toEqual(info)
    expect(info.pid).toBe(process.pid)
    expect(info.startupNonce).toMatch(/^[0-9a-f-]{36}$/)

    const duplicate = new HeadlessServer(options)
    await expect(duplicate.start()).rejects.toThrow(`already running with PID ${process.pid}`)

    await server.stop()
    expect(readRuntimeInfo(dataDir)).toBeNull()
  })
})
