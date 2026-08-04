import React, { useState } from 'react'
import { parseConnectionUrl } from '../mobile/QRScanner.js'
import {
  pairWithHumanCode,
  redeemPairingOffer,
  type HumanCodePairingResult,
  type PairingApprovalDetails,
} from '../../security/human-code-pairing.js'

export interface PairedServerResult extends HumanCodePairingResult {
  endpoint: URL
  fingerprint: string
}

export interface PairServerDialogProps {
  onCancel: () => void
  onPaired: (result: PairedServerResult) => Promise<void> | void
}

type PairingMethod = 'paste' | 'code' | 'ssh' | 'file'

function unwrapOffer(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as { offer?: unknown }
    if (typeof parsed.offer !== 'string') throw new Error('Pairing file does not contain an offer')
    return parsed.offer
  }
  return trimmed
}

export function PairServerDialog({ onCancel, onPaired }: PairServerDialogProps): React.ReactElement {
  const [method, setMethod] = useState<PairingMethod>('paste')
  const [offerText, setOfferText] = useState('')
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState('38470')
  const [humanCode, setHumanCode] = useState('')
  const [sshHost, setSshHost] = useState('server.example')
  const [approval, setApproval] = useState<PairingApprovalDetails | null>(null)
  const [approvePending, setApprovePending] = useState<((approved: boolean) => void) | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const requestApproval = (details: PairingApprovalDetails): Promise<boolean> => {
    setApproval(details)
    return new Promise(resolve => setApprovePending(() => resolve))
  }

  const approve = (accepted: boolean): void => {
    approvePending?.(accepted)
    setApprovePending(null)
    setApproval(null)
  }

  const pairOffer = async (): Promise<void> => {
    const offer = unwrapOffer(offerText)
    const parsed = parseConnectionUrl(offer)
    if (!parsed?.pairingOffer || !parsed.endpointHints?.length || !parsed.serverId) {
      throw new Error('Pairing offer is invalid or expired')
    }
    const accepted = await requestApproval({
      serverId: parsed.serverId,
      endpointHints: parsed.endpointHints,
      certificateFingerprint: parsed.fingerprint || '',
      requestedScopes: parsed.scopes || [],
    })
    if (!accepted) throw new Error('Pairing approval was cancelled')

    let lastError: unknown
    for (const endpoint of parsed.endpointHints) {
      try {
        const paired = await redeemPairingOffer(offer, endpoint, crypto.randomUUID(), navigator.userAgent)
        await onPaired({ ...paired, endpoint: new URL(endpoint), fingerprint: parsed.fingerprint || '' })
        return
      } catch (cause) {
        lastError = cause
      }
    }
    throw lastError instanceof Error ? lastError : new Error('No pairing endpoint was reachable')
  }

  const pairCode = async (): Promise<void> => {
    const numericPort = Number(port)
    if (!host.trim() || !Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
      throw new Error('Enter a valid host and port')
    }
    if (!/^\d{4}-\d{4}$/.test(humanCode.trim())) throw new Error('Pairing code must use 1234-5678 format')
    let fingerprint = ''
    const paired = await pairWithHumanCode(
      host.trim(),
      numericPort,
      humanCode.trim(),
      crypto.randomUUID(),
      navigator.userAgent,
      details => {
        fingerprint = details.certificateFingerprint
        return requestApproval(details)
      },
    )
    await onPaired({
      ...paired,
      endpoint: new URL(`http://${host.trim()}:${numericPort}`),
      fingerprint,
    })
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (method === 'code') await pairCode()
      else await pairOffer()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  if (approval) {
    return (
      <section className="pair-server-dialog" role="dialog" aria-modal="true" aria-labelledby="pair-server-approval-title">
        <h3 id="pair-server-approval-title">Approve Server</h3>
        <dl>
          <dt>Server ID</dt><dd>{approval.serverId}</dd>
          <dt>Fingerprint</dt><dd><code>{approval.certificateFingerprint || 'Not available'}</code></dd>
          <dt>Endpoints</dt><dd>{approval.endpointHints.join(', ')}</dd>
          <dt>Scopes</dt><dd>{approval.requestedScopes.join(', ') || 'None'}</dd>
        </dl>
        <p>Compare this fingerprint with the trusted Server before approving.</p>
        <button type="button" onClick={() => approve(true)}>Approve</button>
        <button type="button" onClick={() => approve(false)}>Reject</button>
      </section>
    )
  }

  return (
    <section className="pair-server-dialog" role="dialog" aria-modal="true" aria-labelledby="pair-server-title">
      <h3 id="pair-server-title">Pair a Server</h3>
      <div role="tablist" aria-label="Pairing method">
        {(['paste', 'code', 'ssh', 'file'] as PairingMethod[]).map(value => (
          <button key={value} type="button" role="tab" aria-selected={method === value} onClick={() => setMethod(value)}>
            {value === 'paste' ? 'Paste link' : value === 'code' ? 'Human code' : value === 'ssh' ? 'SSH bootstrap' : 'Pairing file'}
          </button>
        ))}
      </div>

      {method === 'code' ? (
        <>
          <label>Server host<input value={host} onChange={event => setHost(event.target.value)} /></label>
          <label>Port<input inputMode="numeric" value={port} onChange={event => setPort(event.target.value)} /></label>
          <label>Pairing code<input inputMode="numeric" placeholder="1234-5678" value={humanCode} onChange={event => setHumanCode(event.target.value)} /></label>
        </>
      ) : (
        <>
          {method === 'ssh' && (
            <>
              <label>SSH host<input value={sshHost} onChange={event => setSshHost(event.target.value)} /></label>
              <p>Run this authenticated command, then paste its JSON output below:</p>
              <code>ssh {sshHost} donutcode-server pairing-offer</code>
            </>
          )}
          {method === 'file' && (
            <label>
              One-time pairing file
              <input type="file" accept=".json,.donutpair,application/json" onChange={event => {
                const file = event.target.files?.[0]
                if (file) void file.text().then(setOfferText).catch(cause => setError(String(cause)))
              }} />
            </label>
          )}
          <label>
            {method === 'paste' ? 'Pairing link' : 'Pairing offer JSON'}
            <textarea value={offerText} onChange={event => setOfferText(event.target.value)} rows={5} />
          </label>
        </>
      )}

      {error && <div role="alert">{error}</div>}
      <button type="button" disabled={busy} onClick={() => void submit()}>{busy ? 'Pairing…' : 'Continue'}</button>
      <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
    </section>
  )
}
