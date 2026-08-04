import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { EnvironmentRuntime } from '../environment-runtime'
import { HeadlessServer, readRuntimeInfo } from '../headless-server'
import { issueDeviceToken } from '../mobile-server/device-registry'

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

    const pairingOffer = runtime.server.getConnectionInfo().qrData
    const pairingResponse = await fetch(`http://${endpoint.host}:${endpoint.port}/api/auth/pairing-offer/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingOffer, offer: pairingOffer, deviceId: 'headless-test', deviceName: 'Headless test' }),
    })
    expect(pairingResponse.status).toBe(200)
    const { deviceCredential } = await pairingResponse.json() as { deviceCredential: string }

    const replay = await fetch(`http://${endpoint.host}:${endpoint.port}/api/auth/pairing-offer/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offer: pairingOffer, deviceId: 'replay-device', deviceName: 'Replay test' }),
    })
    expect(replay.status).toBe(403)

    const snapshot = await fetch(`http://${endpoint.host}:${endpoint.port}/api/environment/snapshot`, {
      headers: { Authorization: `Bearer ${deviceCredential}` },
    })
    expect(snapshot.status).toBe(200)
    await expect(snapshot.json()).resolves.toMatchObject({
      serverId: 'server-headless',
      revision: 0,
    })

    const trustedOfferResponse = await fetch(`http://${endpoint.host}:${endpoint.port}/api/auth/pairing-offer`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${deviceCredential}` },
    })
    expect(trustedOfferResponse.status).toBe(200)
    const { offer: trustedOffer } = await trustedOfferResponse.json() as { offer: string }
    const secondPairingResponse = await fetch(`http://${endpoint.host}:${endpoint.port}/api/auth/pairing-offer/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offer: trustedOffer, deviceId: 'second-device', deviceName: 'Second device' }),
    })
    expect(secondPairingResponse.status).toBe(200)
    const { deviceCredential: secondCredential } = await secondPairingResponse.json() as { deviceCredential: string }

    expect(runtime.server.revokeDevice('headless-test')).toEqual({ revoked: 1 })
    const revokedSnapshot = await fetch(`http://${endpoint.host}:${endpoint.port}/api/environment/snapshot`, {
      headers: { Authorization: `Bearer ${deviceCredential}` },
    })
    expect(revokedSnapshot.status).toBe(403)
    const unrelatedSnapshot = await fetch(`http://${endpoint.host}:${endpoint.port}/api/environment/snapshot`, {
      headers: { Authorization: `Bearer ${secondCredential}` },
    })
    expect(unrelatedSnapshot.status).toBe(200)

    const readOnlyCredential = issueDeviceToken('read-only-device', 'Read-only device', ['read'])
    const readOnlySnapshot = await fetch(`http://${endpoint.host}:${endpoint.port}/api/environment/snapshot`, {
      headers: { Authorization: `Bearer ${readOnlyCredential}` },
    })
    expect(readOnlySnapshot.status).toBe(200)
    const forbiddenMutation = await fetch(`http://${endpoint.host}:${endpoint.port}/api/environment/commands`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${readOnlyCredential}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(forbiddenMutation.status).toBe(403)

    await runtime.stop()
    runtimes.splice(runtimes.indexOf(runtime), 1)
    const restarted = new EnvironmentRuntime({
      dataDir,
      appPath: process.cwd(),
      version: 'test-version',
      serverId: 'server-headless',
      host: '127.0.0.1',
      port: 0,
    })
    runtimes.push(restarted)
    const restartedEndpoint = await restarted.start()
    const replayAfterRestart = await fetch(`http://${restartedEndpoint.host}:${restartedEndpoint.port}/api/auth/pairing-offer/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offer: pairingOffer, deviceId: 'restart-replay', deviceName: 'Restart replay' }),
    })
    expect(replayAfterRestart.status).toBe(403)
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
