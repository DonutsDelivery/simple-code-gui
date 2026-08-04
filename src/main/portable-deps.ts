import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import { exec } from 'child_process'
import { promisify } from 'util'
import { isWindows } from './platform'
import { getRuntimeDataDir } from './runtime-paths.js'

const execAsync = promisify(exec)

// Portable deps directory in app data
const getDepsDir = (): string => path.join(getRuntimeDataDir(), 'deps')
const getNodeDir = (): string => path.join(getDepsDir(), 'node')
const getPythonDir = (): string => path.join(getDepsDir(), 'python')

// URLs for portable downloads
const NODE_VERSION = '22.23.2'
const PYTHON_VERSION = '3.14.6'

type NodePlatform = 'win32' | 'darwin' | 'linux'
type NodeArchitecture = 'x64' | 'arm64'

function getNodePlatform(platform: string = process.platform): NodePlatform | null {
  return platform === 'win32' || platform === 'darwin' || platform === 'linux'
    ? platform
    : null
}

function getNodeArchitecture(architecture: string = process.arch): NodeArchitecture {
  return architecture === 'arm64' ? 'arm64' : 'x64'
}

function getPortableNodeInstallDir(): string | null {
  const platform = getNodePlatform()
  if (!platform) return null
  const platformName = platform === 'win32' ? 'win' : platform
  return path.join(getNodeDir(), `node-v${NODE_VERSION}-${platformName}-${getNodeArchitecture()}`)
}

function getPortableNodeBinDir(): string | null {
  const installDir = getPortableNodeInstallDir()
  if (!installDir) return null
  return isWindows ? installDir : path.join(installDir, 'bin')
}

function getNodeDownloadUrl(platform: string = process.platform, architecture: string = process.arch): string | null {
  const supportedPlatform = getNodePlatform(platform)
  if (!supportedPlatform) return null
  const platformName = supportedPlatform === 'win32' ? 'win' : supportedPlatform
  const extension = supportedPlatform === 'win32' ? 'zip' : 'tar.gz'
  return `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${platformName}-${getNodeArchitecture(architecture)}.${extension}`
}

// Python embeddable for Windows (no installer needed)
const PYTHON_URLS = {
  win32: `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`,
  // macOS and Linux typically have Python or can get it easily via package managers
}

export interface DepStatus {
  nodeInstalled: boolean
  nodePath: string | null
  pythonInstalled: boolean
  pythonPath: string | null
}

// Ensure deps directory exists
function ensureDepsDir(): void {
  if (!fs.existsSync(getDepsDir())) {
    fs.mkdirSync(getDepsDir(), { recursive: true })
  }
}

// Get paths to portable executables
export function getPortableNodePath(): string | null {
  const installDir = getPortableNodeInstallDir()
  if (!installDir) return null
  const nodePath = path.join(installDir, isWindows ? 'node.exe' : 'bin/node')
  return fs.existsSync(nodePath) ? nodePath : null
}

export function getPortableNpmPath(): string | null {
  const installDir = getPortableNodeInstallDir()
  if (!installDir) return null
  const npmPath = path.join(installDir, isWindows ? 'npm.cmd' : 'bin/npm')
  return fs.existsSync(npmPath) ? npmPath : null
}

/** npm's Unix entrypoint resolves node through /usr/bin/env. */
export function getPortableCommandEnv(): NodeJS.ProcessEnv {
  const nodeBinDir = getPortableNodeBinDir()
  const pathValue = [nodeBinDir, process.env.PATH].filter(Boolean).join(path.delimiter)
  return { ...process.env, PATH: pathValue }
}

export function getPortablePythonPath(): string | null {
  if (isWindows) {
    const pythonPath = path.join(getPythonDir(), 'python.exe')
    return fs.existsSync(pythonPath) ? pythonPath : null
  }
  return null // Use system Python on macOS/Linux
}

export function getPortablePipPath(): string | null {
  if (isWindows) {
    const pipPath = path.join(getPythonDir(), 'Scripts', 'pip.exe')
    return fs.existsSync(pipPath) ? pipPath : null
  }
  return null
}

// Get portable bin directories for PATH
export function getPortableBinDirs(): string[] {
  const dirs: string[] = []

  if (isWindows) {
    const nodeBin = getPortableNodeBinDir()
    if (nodeBin && fs.existsSync(nodeBin)) dirs.push(nodeBin)
    if (fs.existsSync(getPythonDir())) {
      dirs.push(getPythonDir())
      dirs.push(path.join(getPythonDir(), 'Scripts'))
    }
  } else {
    const nodeBin = getPortableNodeBinDir()
    if (nodeBin && fs.existsSync(nodeBin)) dirs.push(nodeBin)
  }

  const npmGlobal = path.join(getRuntimeDataDir(), 'npm-global')
  const npmGlobalBin = isWindows ? npmGlobal : path.join(npmGlobal, 'bin')
  if (fs.existsSync(npmGlobalBin)) dirs.push(npmGlobalBin)

  return dirs
}

// Check current dependency status
export function checkDeps(): DepStatus {
  return {
    nodeInstalled: getPortableNodePath() !== null,
    nodePath: getPortableNodePath(),
    pythonInstalled: getPortablePythonPath() !== null || !isWindows,
    pythonPath: getPortablePythonPath()
  }
}

// Download a file with progress callback
function downloadFile(url: string, destPath: string, onProgress?: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)

    https.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close()
        fs.unlinkSync(destPath)
        downloadFile(response.headers.location!, destPath, onProgress)
          .then(resolve)
          .catch(reject)
        return
      }

      if (response.statusCode !== 200) {
        file.close()
        fs.unlinkSync(destPath)
        reject(new Error(`Download failed with status ${response.statusCode}`))
        return
      }

      const totalSize = parseInt(response.headers['content-length'] || '0', 10)
      let downloaded = 0

      response.on('data', (chunk) => {
        downloaded += chunk.length
        if (onProgress && totalSize > 0) {
          onProgress(Math.round((downloaded / totalSize) * 100))
        }
      })

      response.pipe(file)

      file.on('finish', () => {
        file.close()
        resolve()
      })

      file.on('error', (err) => {
        file.close()
        fs.unlinkSync(destPath)
        reject(err)
      })
    }).on('error', (err) => {
      file.close()
      if (fs.existsSync(destPath)) {
        fs.unlinkSync(destPath)
      }
      reject(err)
    })
  })
}

// Extract archive (zip or tar.gz)
async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true })
  }

  if (isWindows) {
    // Use PowerShell to extract on Windows
    await execAsync(`powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force"`, {
      timeout: 120000
    })
  } else {
    // Use tar on Unix
    if (archivePath.endsWith('.tar.gz')) {
      await execAsync(`tar -xzf "${archivePath}" -C "${destDir}"`, { timeout: 120000 })
    } else {
      await execAsync(`unzip -o "${archivePath}" -d "${destDir}"`, { timeout: 120000 })
    }
  }
}

// Download and install portable Node.js
export async function installPortableNode(onProgress?: (status: string, percent?: number) => void): Promise<{ success: boolean; error?: string }> {
  try {
    ensureDepsDir()

    const platform = process.platform as 'win32' | 'darwin' | 'linux'
    const url = getNodeDownloadUrl(platform)
    if (!url) {
      return { success: false, error: `Unsupported platform: ${platform}` }
    }

    const ext = isWindows ? '.zip' : '.tar.gz'
    const archivePath = path.join(getDepsDir(), `node${ext}`)

    onProgress?.('Downloading Node.js...', 0)
    await downloadFile(url, archivePath, (percent) => {
      onProgress?.('Downloading Node.js...', percent)
    })

    onProgress?.('Extracting Node.js...', undefined)
    if (!fs.existsSync(getNodeDir())) {
      fs.mkdirSync(getNodeDir(), { recursive: true })
    }
    await extractArchive(archivePath, getNodeDir())

    // Cleanup archive
    fs.unlinkSync(archivePath)

    // Verify installation
    const nodePath = getPortableNodePath()
    if (!nodePath) {
      return { success: false, error: 'Node.js extraction failed' }
    }

    // Create npm global directory
    const npmGlobal = path.join(getRuntimeDataDir(), 'npm-global')
    if (!fs.existsSync(npmGlobal)) {
      fs.mkdirSync(npmGlobal, { recursive: true })
    }

    // Configure npm to use local prefix
    const npmPath = getPortableNpmPath()
    if (npmPath) {
      await execAsync(`"${npmPath}" config set prefix "${npmGlobal}"`, {
        timeout: 30000,
        env: getPortableCommandEnv()
      })
    }

    onProgress?.('Node.js installed successfully', 100)
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

// Download and install portable Python (Windows only)
export async function installPortablePython(onProgress?: (status: string, percent?: number) => void): Promise<{ success: boolean; error?: string }> {
  if (!isWindows) {
    return { success: false, error: 'Portable Python is only needed on Windows. Please install Python via your package manager.' }
  }

  try {
    ensureDepsDir()

    const url = PYTHON_URLS.win32
    const archivePath = path.join(getDepsDir(), 'python.zip')

    onProgress?.('Downloading Python...', 0)
    await downloadFile(url, archivePath, (percent) => {
      onProgress?.('Downloading Python...', percent)
    })

    onProgress?.('Extracting Python...', undefined)
    if (!fs.existsSync(getPythonDir())) {
      fs.mkdirSync(getPythonDir(), { recursive: true })
    }
    await extractArchive(archivePath, getPythonDir())

    // Cleanup archive
    fs.unlinkSync(archivePath)

    // Enable pip in embeddable Python
    // The embeddable version needs pip to be installed separately
    onProgress?.('Installing pip...', undefined)

    // Download get-pip.py
    const getPipPath = path.join(getPythonDir(), 'get-pip.py')
    await downloadFile('https://bootstrap.pypa.io/get-pip.py', getPipPath)

    // Uncomment import site in pythonXX._pth to enable pip
    const pthFiles = fs.readdirSync(getPythonDir()).filter(f => f.endsWith('._pth'))
    for (const pthFile of pthFiles) {
      const pthPath = path.join(getPythonDir(), pthFile)
      let content = fs.readFileSync(pthPath, 'utf-8')
      content = content.replace('#import site', 'import site')
      fs.writeFileSync(pthPath, content)
    }

    // Run get-pip.py
    const pythonPath = path.join(getPythonDir(), 'python.exe')
    await execAsync(`"${pythonPath}" "${getPipPath}"`, { timeout: 120000 })

    // Cleanup get-pip.py
    fs.unlinkSync(getPipPath)

    // Verify installation
    const pipPath = getPortablePipPath()
    if (!pipPath) {
      return { success: false, error: 'pip installation failed' }
    }

    onProgress?.('Python installed successfully', 100)
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

// Install Claude Code using portable npm
export async function installClaudeWithPortableNpm(): Promise<{ success: boolean; error?: string }> {
  const npmPath = getPortableNpmPath()
  if (!npmPath) {
    return { success: false, error: 'Portable npm not found. Please install Node.js first.' }
  }

  try {
    await execAsync(`"${npmPath}" install -g @anthropic-ai/claude-code`, {
      timeout: 300000,
      env: getPortableCommandEnv()
    })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}
