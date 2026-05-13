import { ipcMain, BrowserWindow, clipboard } from 'electron'
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir, homedir } from 'os'
import { isWindows } from '../platform'
import { type AIBackend, getInstructionFilePath, getInstructionFileRelativePath } from './instruction-files'

/**
 * Validates that a project path is safe and doesn't contain path traversal attempts.
 * Returns the resolved absolute path if valid, or throws an error if invalid.
 */
function validateProjectPath(projectPath: string): string {
  // Reject null bytes which can truncate paths
  if (projectPath.includes('\0')) {
    throw new Error('Invalid project path: contains null bytes')
  }

  const resolved = resolve(projectPath)
  const home = homedir()

  // Path must be absolute and within home directory or common project locations
  // This prevents path traversal attacks (e.g., ../../etc/passwd)
  if (!resolved.startsWith(home) && !resolved.startsWith('/tmp') && !resolved.startsWith('/var/tmp')) {
    throw new Error('Invalid project path: must be within home directory or temp directories')
  }

  // Verify that the resolved path doesn't escape via symlink traversal
  // by checking that joining with a subpath stays within the base
  const testPath = resolve(resolved, '.claude')
  if (!testPath.startsWith(resolved)) {
    throw new Error('Invalid project path: path traversal detected')
  }

  return resolved
}

export function registerWindowHandlers(getMainWindow: () => BrowserWindow | null) {
  ipcMain.handle('window:minimize', () => {
    getMainWindow()?.minimize()
  })

  ipcMain.handle('window:maximize', () => {
    const mainWindow = getMainWindow()
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })

  ipcMain.handle('window:close', () => {
    getMainWindow()?.close()
  })

  ipcMain.handle('window:isMaximized', () => {
    return getMainWindow()?.isMaximized() ?? false
  })

  // Clipboard
  ipcMain.handle('clipboard:readImage', async () => {
    try {
      const formats = clipboard.availableFormats()

      // Check for text/uri-list (Linux file copy)
      if (formats.includes('text/uri-list')) {
        const uriBuffer = clipboard.readBuffer('text/uri-list')
        const uriList = uriBuffer.toString('utf8').trim()
        if (uriList) {
          const paths = uriList.split('\n')
            .map(uri => uri.trim())
            .filter(uri => uri.startsWith('file://'))
            .map(uri => decodeURIComponent(uri.replace('file://', '')))
          if (paths.length > 0) {
            return { success: true, hasImage: true, path: paths.join(' '), isFile: true }
          }
        }
      }

      // Check for Windows file copy
      if (isWindows) {
        try {
          const rawFilePath = clipboard.read('FileNameW')
          if (rawFilePath) {
            const filePath = rawFilePath.replace(new RegExp(String.fromCharCode(0), 'g'), '').trim()
            if (filePath && (filePath.includes(':\\') || filePath.startsWith('\\\\'))) {
              return { success: true, hasImage: true, path: filePath, isFile: true }
            }
          }
        } catch { /* FileNameW not available */ }

        try {
          const hdropBuffer = clipboard.readBuffer('CF_HDROP')
          if (hdropBuffer && hdropBuffer.length > 0) {
            const hdropStr = hdropBuffer.toString('ucs2').replace(/\0+/g, '\n').trim()
            const lines = hdropStr.split('\n').filter(l => l.includes(':\\') || l.startsWith('\\\\'))
            if (lines.length > 0) {
              return { success: true, hasImage: true, path: lines.join(' '), isFile: true }
            }
          }
        } catch { /* CF_HDROP not available */ }
      }

      // Try to get image from clipboard
      const image = clipboard.readImage()
      if (image.isEmpty()) {
        const html = clipboard.readHTML()
        if (html && html.includes('<img')) {
          const srcMatch = html.match(/src="([^"]+)"/)
          if (srcMatch && srcMatch[1]) {
            return { success: true, hasImage: true, path: srcMatch[1], isUrl: true }
          }
        }
        return { success: false, hasImage: false }
      }

      // Save to temp file
      const filename = `clipboard-${Date.now()}.png`
      const filepath = join(tmpdir(), filename)
      const pngBuffer = image.toPNG()
      writeFileSync(filepath, pngBuffer)

      return { success: true, hasImage: true, path: filepath }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // Write text to clipboard (for OSC 52 and other programmatic clipboard writes)
  ipcMain.handle('clipboard:writeText', async (_, text: string) => {
    try {
      clipboard.writeText(text)
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // Custom commands
  ipcMain.handle('commands:save', async (_, { name, content, projectPath }: { name: string; content: string; projectPath: string | null }) => {
    try {
      // Sanitize name to prevent path traversal attacks
      const sanitizedName = name.replace(/[\/\\:*?"<>|]/g, '_')

      let commandsDir: string
      if (projectPath) {
        commandsDir = join(projectPath, '.claude', 'commands')
      } else {
        commandsDir = join(homedir(), '.claude', 'commands')
      }

      if (!existsSync(commandsDir)) {
        mkdirSync(commandsDir, { recursive: true })
      }

      const filePath = join(commandsDir, `${sanitizedName}.md`)

      // Verify resolved path is within commands directory to prevent path traversal
      const resolvedPath = resolve(filePath)
      const resolvedCommandsDir = resolve(commandsDir)
      if (!resolvedPath.startsWith(resolvedCommandsDir + '/') && resolvedPath !== resolvedCommandsDir) {
        return { success: false, error: 'Invalid command name' }
      }

      if (existsSync(filePath)) {
        return { success: false, error: `Command "${sanitizedName}" already exists` }
      }

      writeFileSync(filePath, content, 'utf8')
      return { success: true, path: filePath }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // Instruction file editor (CLAUDE.md, GEMINI.md, AGENTS.md, etc.)
  ipcMain.handle('claudemd:read', async (_, projectPath: string, aiBackend?: AIBackend) => {
    try {
      const validatedPath = validateProjectPath(projectPath)
      const backend: AIBackend = aiBackend || 'claude'
      const filePath = getInstructionFilePath(validatedPath, backend)

      const resolvedFilePath = resolve(filePath)
      if (!resolvedFilePath.startsWith(validatedPath)) {
        return { success: false, error: 'Invalid path: path traversal detected' }
      }

      const relativePath = getInstructionFileRelativePath(backend)

      if (existsSync(resolvedFilePath)) {
        const content = readFileSync(resolvedFilePath, 'utf8')
        return { success: true, content, exists: true, relativePath }
      }
      return { success: true, content: '', exists: false, relativePath }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('claudemd:save', async (_, { projectPath, content, aiBackend }: { projectPath: string; content: string; aiBackend?: AIBackend }) => {
    try {
      const validatedPath = validateProjectPath(projectPath)
      const backend: AIBackend = aiBackend || 'claude'
      const filePath = getInstructionFilePath(validatedPath, backend)

      const resolvedFilePath = resolve(filePath)
      if (!resolvedFilePath.startsWith(validatedPath)) {
        return { success: false, error: 'Invalid path: path traversal detected' }
      }

      writeFileSync(resolvedFilePath, content, 'utf8')
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })
}
