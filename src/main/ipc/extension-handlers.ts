import { ipcMain } from 'electron'
import { extensionManager, Extension } from '../extension-manager'

/**
 * M12: SSRF guard for fetching remote extension manifests. Custom URLs are a
 * user feature, so we allow any *public* https host but reject the targets an
 * SSRF actually wants: non-https schemes, localhost, and private/loopback/
 * link-local IP literals (incl. the cloud metadata 169.254.169.254). DNS names
 * that resolve to internal IPs (rebinding) remain a documented residual — full
 * coverage needs resolve-then-pin, out of scope for this pass.
 */
function assertSafePublicUrl(raw: string): void {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('Invalid URL')
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Only https:// extension URLs are allowed')
  }
  const host = parsed.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0' || host === '::1' || host === '[::1]') {
    throw new Error('Refusing to fetch from a loopback/local address')
  }
  // IPv4 literal in a private/loopback/link-local range
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const [a, b] = [parseInt(m[1], 10), parseInt(m[2], 10)]
    const isPrivate =
      a === 10 ||
      a === 127 ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 169 && b === 254) ||      // link-local + cloud metadata
      (a === 100 && b >= 64 && b <= 127) // CGNAT
    if (isPrivate) {
      throw new Error('Refusing to fetch from a private/internal address')
    }
  }
}

export function registerExtensionHandlers() {
  // Registry
  ipcMain.handle('extensions:fetchRegistry', async (_, forceRefresh?: boolean) => {
    try {
      return await extensionManager.fetchRegistry(forceRefresh)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('extensions:fetchFromUrl', async (_, url: string) => {
    try {
      assertSafePublicUrl(url)
      return await extensionManager.fetchFromUrl(url)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // Installation
  ipcMain.handle('extensions:installSkill', async (_, { extension, scope, projectPath }: { extension: Extension; scope?: 'global' | 'project'; projectPath?: string }) => {
    try {
      return await extensionManager.installSkill(extension, scope, projectPath)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('extensions:installMcp', async (_, { extension, config }: { extension: Extension; config?: Record<string, any> }) => {
    try {
      return await extensionManager.installMcp(extension, config)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('extensions:remove', async (_, extensionId: string) => {
    try {
      return await extensionManager.remove(extensionId)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('extensions:update', async (_, extensionId: string) => {
    try {
      return await extensionManager.update(extensionId)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // Query
  ipcMain.handle('extensions:getInstalled', async () => {
    try {
      return await extensionManager.getInstalled()
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('extensions:getForProject', async (_, projectPath: string) => {
    try {
      return await extensionManager.getInstalledForProject(projectPath)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('extensions:getCommands', async (_, projectPath: string) => {
    try {
      return await extensionManager.getCommandsForProject(projectPath)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // Config
  ipcMain.handle('extensions:getConfig', async (_, extensionId: string) => {
    try {
      return await extensionManager.getConfig(extensionId)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('extensions:setConfig', async (_, { extensionId, config }: { extensionId: string; config: Record<string, any> }) => {
    try {
      return await extensionManager.setConfig(extensionId, config)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('extensions:enableForProject', async (_, { extensionId, projectPath }: { extensionId: string; projectPath: string }) => {
    try {
      return await extensionManager.enableForProject(extensionId, projectPath)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('extensions:disableForProject', async (_, { extensionId, projectPath }: { extensionId: string; projectPath: string }) => {
    try {
      return await extensionManager.disableForProject(extensionId, projectPath)
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // Custom URLs
  ipcMain.handle('extensions:addCustomUrl', async (_, url: string) => {
    try {
      assertSafePublicUrl(url)
      extensionManager.addCustomUrl(url)
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('extensions:removeCustomUrl', async (_, url: string) => {
    try {
      extensionManager.removeCustomUrl(url)
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('extensions:getCustomUrls', async () => {
    try {
      return extensionManager.getCustomUrls()
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}
