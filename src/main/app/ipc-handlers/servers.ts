import { ipcMain } from 'electron'
import { ApiServerManager } from '../../api-server.js'
import { MobileServer } from '../../mobile-server.js'

export function registerServerHandlers(
  apiServerManager: ApiServerManager,
  mobileServer: MobileServer
): void {
  // API Server management
  ipcMain.handle('api:start', (_, { projectPath, port }: { projectPath: string; port: number }) => apiServerManager.start(projectPath, port))
  ipcMain.handle('api:stop', (_, projectPath: string) => { apiServerManager.stop(projectPath); return { success: true } })
  ipcMain.handle('api:status', (_, projectPath: string) => ({
    running: apiServerManager.isRunning(projectPath),
    port: apiServerManager.getPort(projectPath)
  }))

  // Mobile server management (for phone app connectivity)
  ipcMain.handle('mobile:getConnectionInfo', () => mobileServer.getConnectionInfo())
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
}
