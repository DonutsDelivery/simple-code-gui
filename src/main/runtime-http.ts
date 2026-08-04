import { request as httpRequest } from 'http'
import { request as httpsRequest } from 'https'
import type { ClientRequest, IncomingMessage } from 'http'
import type { TLSSocket } from 'tls'

export interface RuntimeHttpTarget {
  endpoint: string
  certFingerprint?: string
}

export interface RuntimeHttpResponse {
  status: number
  body: string
  json<T>(): T
}

function normalizeFingerprint(value: string): string {
  return value.replace(/^sha256:/i, '').replace(/:/g, '').toLowerCase()
}

export async function runtimeHttpRequest(
  target: RuntimeHttpTarget,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {},
): Promise<RuntimeHttpResponse> {
  const url = new URL(path, `${target.endpoint.replace(/\/$/, '')}/`)
  const secure = url.protocol === 'https:'
  if (secure && !target.certFingerprint) throw new Error('HTTPS runtime metadata is missing its certificate fingerprint')
  if (!secure && url.protocol !== 'http:') throw new Error('Unsupported runtime protocol')

  return await new Promise<RuntimeHttpResponse>((resolve, reject) => {
    const requestImpl = secure ? httpsRequest : httpRequest
    const request = requestImpl(url, {
      method: options.method || 'GET',
      headers: options.headers,
      rejectUnauthorized: secure ? false : undefined,
      agent: false,
    }, (response: IncomingMessage) => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(Buffer.from(chunk)))
      response.once('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        resolve({
          status: response.statusCode || 0,
          body,
          json<T>(): T { return JSON.parse(body) as T },
        })
      })
    })
    const timeout = setTimeout(() => request.destroy(new Error('Runtime request timed out')), options.timeoutMs ?? 5_000)
    request.once('close', () => clearTimeout(timeout))
    request.once('error', reject)

    const send = (clientRequest: ClientRequest): void => {
      if (options.body !== undefined) clientRequest.write(options.body)
      clientRequest.end()
    }
    if (!secure) {
      send(request)
      return
    }
    request.once('socket', socket => {
      const tlsSocket = socket as TLSSocket
      tlsSocket.once('secureConnect', () => {
        const actual = normalizeFingerprint(tlsSocket.getPeerCertificate().fingerprint256 || '')
        const expected = normalizeFingerprint(target.certFingerprint || '')
        if (!actual || actual !== expected) {
          const error = new Error('Runtime TLS certificate fingerprint mismatch')
          reject(error)
          request.destroy(error)
          return
        }
        send(request)
      })
    })
  })
}
