import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { EnvironmentRuntime } from '../environment-runtime'
import { HeadlessServer, readRuntimeInfo } from '../headless-server'
import { issueDeviceToken } from '../mobile-server/device-registry'
import { runtimeHttpRequest } from '../runtime-http'

const tempDirs: string[] = []
const runtimes: EnvironmentRuntime[] = []

async function requestAndApprovePairing(
  runtime: EnvironmentRuntime,
  baseUrl: string,
  offer: string,
  deviceId: string,
  deviceName: string,
): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/pairing-offer/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offer, deviceId, deviceName }),
  })
  expect(response.status).toBe(202)
  const pending = await response.json() as { requestId: string; requestSecret: string }
  expect(runtime.server.listPairingRequests()).toEqual(expect.arrayContaining([
    expect.objectContaining({ requestId: pending.requestId, deviceId, deviceName }),
  ]))
  const unauthorizedStatus = await fetch(`${baseUrl}/api/auth/pairing-offer/request/${pending.requestId}/status`, {
    headers: { 'X-Pairing-Request-Secret': 'wrong-secret' },
  })
  expect(unauthorizedStatus.status).toBe(404)
  expect(runtime.server.approvePairingRequest(pending.requestId)).toEqual({ approved: true })
  const status = await fetch(`${baseUrl}/api/auth/pairing-offer/request/${pending.requestId}/status`, {
    headers: { 'X-Pairing-Request-Secret': pending.requestSecret },
  })
  expect(status.status).toBe(200)
  const result = await status.json() as { status: string; deviceCredential: string }
  expect(result.status).toBe('approved')
  return result.deviceCredential
}

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
      secure: false,
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
    const baseUrl = `http://${endpoint.host}:${endpoint.port}`
    const deviceCredential = await requestAndApprovePairing(runtime, baseUrl, pairingOffer, 'headless-test', 'Headless test')

    const replay = await fetch(`${baseUrl}/api/auth/pairing-offer/request`, {
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
    const secondCredential = await requestAndApprovePairing(runtime, baseUrl, trustedOffer, 'second-device', 'Second device')

    const liveTicketResponse = await fetch(`${baseUrl}/api/auth/websocket-ticket`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${deviceCredential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ purpose: '/ws' }),
    })
    const { ticket: liveTicket } = await liveTicketResponse.json() as { ticket: string }
    const liveSocket = new WebSocket(`${baseUrl.replace('http:', 'ws:')}/ws`, [`ticket-${liveTicket}`])
    await new Promise<void>((resolve, reject) => {
      liveSocket.once('open', resolve)
      liveSocket.once('error', reject)
    })

    expect(runtime.server.revokeDevice('headless-test')).toEqual({ revoked: 1 })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Revoked device socket remained open')), 2_000)
      liveSocket.once('close', () => { clearTimeout(timer); resolve() })
    })
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

    const ticketHeaders = { Authorization: `Bearer ${readOnlyCredential}`, 'Content-Type': 'application/json' }
    const readSocketTicket = await fetch(`${baseUrl}/api/auth/websocket-ticket`, {
      method: 'POST',
      headers: ticketHeaders,
      body: JSON.stringify({ purpose: '/ws' }),
    })
    expect(readSocketTicket.status).toBe(200)
    const forbiddenPtyTicket = await fetch(`${baseUrl}/api/auth/websocket-ticket`, {
      method: 'POST',
      headers: ticketHeaders,
      body: JSON.stringify({ purpose: '/api/pty/example/stream' }),
    })
    expect(forbiddenPtyTicket.status).toBe(403)

    await runtime.stop()
    runtimes.splice(runtimes.indexOf(runtime), 1)
    const restarted = new EnvironmentRuntime({
      dataDir,
      appPath: process.cwd(),
      version: 'test-version',
      serverId: 'server-headless',
      host: '127.0.0.1',
      port: 0,
      secure: false,
    })
    runtimes.push(restarted)
    const restartedEndpoint = await restarted.start()
    const replayAfterRestart = await fetch(`http://${restartedEndpoint.host}:${restartedEndpoint.port}/api/auth/pairing-offer/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offer: pairingOffer, deviceId: 'restart-replay', deviceName: 'Restart replay' }),
    })
    expect(replayAfterRestart.status).toBe(403)
  }, 30_000)

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
      secure: false,
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
  }, 15_000)

  it('serves HTTPS and rejects an unpinned certificate', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'donutcode-headless-tls-'))
    tempDirs.push(dataDir)
    const server = new HeadlessServer({
      dataDir,
      appPath: process.cwd(),
      version: 'test-version',
      serverId: 'server-headless-tls',
      host: '127.0.0.1',
      port: 0,
      secure: true,
    })
    runtimes.push(server.runtime)
    const info = await server.start()
    expect(info.endpoint).toMatch(/^https:/)
    expect(info.certFingerprint).toMatch(/^[0-9a-f]{64}$/)
    const health = await runtimeHttpRequest(info, '/health')
    expect(health.status).toBe(200)
    await expect(runtimeHttpRequest({ ...info, certFingerprint: '0'.repeat(64) }, '/health')).rejects.toThrow('fingerprint mismatch')
  })
})
