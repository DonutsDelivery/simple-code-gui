import React from 'react'

interface HeadroomSettingsProps {
  enabled: boolean
  port: number
  proxyPath: string
  status: { running: boolean; port: number; error: string | null } | null
  onChange: (next: { enabled: boolean; port: number; proxyPath: string }) => void
}

export function HeadroomSettings({
  enabled,
  port,
  proxyPath,
  status,
  onChange
}: HeadroomSettingsProps): React.ReactElement {
  return (
    <div className="form-group">
      <label>Headroom Compression</label>
      <p className="form-hint">
        Routes harness LLM traffic through a local Headroom proxy to compress
        tool output, file reads, and history before they reach the model.
        Applies to Claude, Codex, OpenCode, Aider, and Grok. Gemini, Droid, and
        Hermes use native APIs the proxy can&apos;t compress and are left untouched.
      </p>

      <label className="permission-mode-option" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange({ enabled: e.target.checked, port, proxyPath })}
        />
        <span className="mode-label">Enable compression proxy</span>
      </label>

      {enabled && (
        <>
          <div style={{ marginTop: '8px' }}>
            <label htmlFor="headroom-port" style={{ display: 'block', marginBottom: '4px' }}>Proxy port</label>
            <input
              id="headroom-port"
              type="number"
              value={port}
              min={1}
              max={65535}
              onChange={(e) => onChange({ enabled, port: Number(e.target.value) || 8787, proxyPath })}
              style={{ width: '120px' }}
            />
          </div>

          <div style={{ marginTop: '8px' }}>
            <label htmlFor="headroom-path" style={{ display: 'block', marginBottom: '4px' }}>
              headroom executable path (optional — leave blank to auto-detect)
            </label>
            <input
              id="headroom-path"
              type="text"
              placeholder="/home/you/.local/headroom-venv/bin/headroom"
              value={proxyPath}
              onChange={(e) => onChange({ enabled, port, proxyPath: e.target.value })}
              style={{ width: '100%' }}
            />
          </div>

          <p className="form-hint" style={{ marginTop: '8px' }}>
            {status?.error
              ? `⚠ ${status.error}`
              : status?.running
                ? `● Proxy running on port ${status.port}`
                : '○ Proxy not running (save to start)'}
          </p>
        </>
      )}
    </div>
  )
}
