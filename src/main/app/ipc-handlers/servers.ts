import { ipcMain } from 'electron'
import { ApiServerManager } from '../../api-server.js'
import { MobileServer } from '../../mobile-server.js'
import type { SessionStore } from '../../session-store.js'
import type { EnvironmentRuntime } from '../../environment-runtime.js'

export function registerServerHandlers(
  apiServerManager: ApiServerManager,
  mobileServer: MobileServer,
  sessionStore: SessionStore,
  environmentRuntime?: EnvironmentRuntime,
): void {
  // API Server management
  ipcMain.handle('api:start', (_, { projectPath, port }: { projectPath: string; port: number }) => apiServerManager.start(projectPath, port))
  ipcMain.handle('api:stop', (_, projectPath: string) => { apiServerManager.stop(projectPath); return { success: true } })
  ipcMain.handle('api:status', (_, projectPath: string) => ({
    running: apiServerManager.isRunning(projectPath),
    port: apiServerManager.getPort(projectPath)
  }))

  // Mobile server management (for phone app connectivity)
  // H1: mobile/LAN access is opt-in. The renderer reads this to decide whether
  // to show the QR or an "Enable" prompt.
  ipcMain.handle('mobile:isEnabled', () => sessionStore.getSettings().mobileAccessEnabled === true)
  // Toggle mobile access at runtime: persist the setting and start/stop the
  // server so the user doesn't have to restart the app.
  ipcMain.handle('mobile:setEnabled', async (_event, enabled: boolean) => {
    const next = enabled === true
    sessionStore.saveSettings({ ...sessionStore.getSettings(), mobileAccessEnabled: next })
    if (environmentRuntime) {
      await environmentRuntime.setLanAccess(next)
      return { enabled: next, running: mobileServer.isRunning() }
    }
    if (next) {
      if (!mobileServer.isRunning()) await mobileServer.start()
    } else if (mobileServer.isRunning()) {
      await mobileServer.stop()
    }
    return { enabled: next, running: mobileServer.isRunning() }
  })
  ipcMain.handle('mobile:getConnectionInfo', () => mobileServer.getConnectionInfo())
  // Local-only: the embedded-server token for the renderer's auto-connect.
  // Kept off connection-info/URLs; delivered over IPC to the app's own UI.
  ipcMain.handle('mobile:getLocalToken', () => mobileServer.getLocalToken())
  ipcMain.handle('mobile:regenerateToken', () => {
    mobileServer.regenerateToken()
    return mobileServer.getConnectionInfo()
  })
  ipcMain.handle('mobile:isRunning', () => mobileServer.isRunning())
  ipcMain.handle('mobile:sendFile', (_event, filePath: string, message?: string) => {
    return mobileServer.sendFileToMobile(filePath, message)
  })
  ipcMain.handle('mobile:getConnectedClients', () => mobileServer.getConnectedClientCount())
  ipcMain.handle('mobile:getPendingFiles', () => mobileServer.getPendingFiles())

  // H3: per-device pairing management — list paired phones and revoke one
  // (closes its live sockets) without rotating the shared token.
  ipcMain.handle('mobile:listDevices', () => mobileServer.listDevices())
  ipcMain.handle('mobile:revokeDevice', (_event, deviceId: string) => mobileServer.revokeDevice(deviceId))
  ipcMain.handle('mobile:listPairingRequests', () => mobileServer.listPairingRequests())
  ipcMain.handle('mobile:approvePairingRequest', (_event, requestId: string) => mobileServer.approvePairingRequest(requestId))
  ipcMain.handle('mobile:rejectPairingRequest', (_event, requestId: string) => mobileServer.rejectPairingRequest(requestId))
}
