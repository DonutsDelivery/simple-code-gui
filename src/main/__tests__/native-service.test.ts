import { describe, expect, it } from 'vitest'
import { createNativeServiceDefinition } from '../native-service'

const options = {
  executable: '/opt/donut code/donutcode-server',
  dataDir: '/home/test/DonutCode Data',
  host: '0.0.0.0',
  port: 38470,
  homeDir: '/home/test',
}

describe('native service definitions', () => {
  it('creates a user-owned hardened systemd service with persistent logs', () => {
    const service = createNativeServiceDefinition('linux', options)
    expect(service.definitionPath).toBe('/home/test/.config/systemd/user/donutcode-server.service')
    expect(service.contents).toContain('NoNewPrivileges=true')
    expect(service.contents).toContain('WantedBy=default.target')
    expect(service.contents).toContain('StandardOutput=append:')
    expect(service.contents).not.toContain('User=root')
  })

  it('creates a LaunchAgent with background lifecycle and explicit logs', () => {
    const service = createNativeServiceDefinition('darwin', options)
    expect(service.definitionPath).toBe('/home/test/Library/LaunchAgents/com.donutcode.server.plist')
    expect(service.contents).toContain('<key>RunAtLoad</key><true/>')
    expect(service.contents).toContain('<key>ProcessType</key><string>Background</string>')
    expect(service.contents).toContain('<key>StandardErrorPath</key>')
  })

  it('creates a limited user logon task command for Windows', () => {
    const service = createNativeServiceDefinition('win32', options)
    expect(service.definitionPath).toContain('AppData/Local/DonutCode/server-service.cmd')
    expect(service.contents).toContain('donutcode-server" serve')
    expect(service.contents).toContain('server.log')
  })
})
