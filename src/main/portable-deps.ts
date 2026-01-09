import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import { exec } from 'child_process'
import { promisify } from 'util'
import { isWindows, isMac } from './platform'

const execAsync = promisify(exec)

// Portable deps directory in app data
const depsDir = path.join(app.getPath('userData'), 'deps')
const nodeDir = path.join(depsDir, 'node')
const pythonDir = path.join(depsDir, 'python')

// URLs for portable downloads
const NODE_VERSION = '20.18.1'
const PYTHON_VERSION = '3.12.0'

const NODE_URLS = {
  win32: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`,
  darwin: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-x64.tar.gz`,
  linux: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz`
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
  if (!fs.existsSync(depsDir)) {
    fs.mkdirSync(depsDir, { recursive: true })
  }
}

// Get paths to portable executables
export function getPortableNodePath(): string | null {
  if (isWindows) {
    const nodePath = path.join(nodeDir, `node-v${NODE_VERSION}-win-x64`, 'node.exe')
    return fs.existsSync(nodePath) ? nodePath : null
  } else if (isMac) {
    const nodePath = path.join(nodeDir, `node-v${NODE_VERSION}-darwin-x64`, 'bin', 'node')
    return fs.existsSync(nodePath) ? nodePath : null
  } else {
    const nodePath = path.join(nodeDir, `node-v${NODE_VERSION}-linux-x64`, 'bin', 'node')
    return fs.existsSync(nodePath) ? nodePath : null
  }
}

export function getPortableNpmPath(): string | null {
  if (isWindows) {
    const npmPath = path.join(nodeDir, `node-v${NODE_VERSION}-win-x64`, 'npm.cmd')
    return fs.existsSync(npmPath) ? npmPath : null
  } else if (isMac) {
    const npmPath = path.join(nodeDir, `node-v${NODE_VERSION}-darwin-x64`, 'bin', 'npm')
    return fs.existsSync(npmPath) ? npmPath : null
  } else {
    const npmPath = path.join(nodeDir, `node-v${NODE_VERSION}-linux-x64`, 'bin', 'npm')
    return fs.existsSync(npmPath) ? npmPath : null
  }
}

export function getPortablePythonPath(): string | null {
  if (isWindows) {
    const pythonPath = path.join(pythonDir, 'python.exe')
    return fs.existsSync(pythonPath) ? pythonPath : null
  }
  return null // Use system Python on macOS/Linux
}

export function getPortablePipPath(): string | null {
  if (isWindows) {
    const pipPath = path.join(pythonDir, 'Scripts', 'pip.exe')
    return fs.existsSync(pipPath) ? pipPath : null
  }
  return null
}

// Get portable bin directories for PATH
export function getPortableBinDirs(): string[] {
  const dirs: string[] = []

  // Add beads directory (cross-platform)
  const beadsDir = path.join(app.getPath('userData'), 'deps', 'beads')
  if (fs.existsSync(beadsDir)) {
    dirs.push(beadsDir)
  }

  if (isWindows) {
    const nodeBase = path.join(nodeDir, `node-v${NODE_VERSION}-win-x64`)
    if (fs.existsSync(nodeBase)) {
      dirs.push(nodeBase)
    }
    if (fs.existsSync(pythonDir)) {
      dirs.push(pythonDir)
      dirs.push(path.join(pythonDir, 'Scripts'))
    }
    // npm global packages installed via portable npm
    const npmGlobal = path.join(app.getPath('userData'), 'npm-global')
    if (fs.existsSync(npmGlobal)) {
      dirs.push(npmGlobal)
    }
  } else if (isMac) {
    const nodeBin = path.join(nodeDir, `node-v${NODE_VERSION}-darwin-x64`, 'bin')
    if (fs.existsSync(nodeBin)) {
      dirs.push(nodeBin)
    }
  } else {
    const nodeBin = path.join(nodeDir, `node-v${NODE_VERSION}-linux-x64`, 'bin')
    if (fs.existsSync(nodeBin)) {
      dirs.push(nodeBin)
    }
  }

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
    const url = NODE_URLS[platform]
    if (!url) {
      return { success: false, error: `Unsupported platform: ${platform}` }
    }

    const ext = isWindows ? '.zip' : '.tar.gz'
    const archivePath = path.join(depsDir, `node${ext}`)

    onProgress?.('Downloading Node.js...', 0)
    await downloadFile(url, archivePath, (percent) => {
      onProgress?.('Downloading Node.js...', percent)
    })

    onProgress?.('Extracting Node.js...', undefined)
    if (!fs.existsSync(nodeDir)) {
      fs.mkdirSync(nodeDir, { recursive: true })
    }
    await extractArchive(archivePath, nodeDir)

    // Cleanup archive
    fs.unlinkSync(archivePath)

    // Verify installation
    const nodePath = getPortableNodePath()
    if (!nodePath) {
      return { success: false, error: 'Node.js extraction failed' }
    }

    // Create npm global directory
    const npmGlobal = path.join(app.getPath('userData'), 'npm-global')
    if (!fs.existsSync(npmGlobal)) {
      fs.mkdirSync(npmGlobal, { recursive: true })
    }

    // Configure npm to use local prefix
    const npmPath = getPortableNpmPath()
    if (npmPath) {
      await execAsync(`"${npmPath}" config set prefix "${npmGlobal}"`, { timeout: 30000 })
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
    const archivePath = path.join(depsDir, 'python.zip')

    onProgress?.('Downloading Python...', 0)
    await downloadFile(url, archivePath, (percent) => {
      onProgress?.('Downloading Python...', percent)
    })

    onProgress?.('Extracting Python...', undefined)
    if (!fs.existsSync(pythonDir)) {
      fs.mkdirSync(pythonDir, { recursive: true })
    }
    await extractArchive(archivePath, pythonDir)

    // Cleanup archive
    fs.unlinkSync(archivePath)

    // Enable pip in embeddable Python
    // The embeddable version needs pip to be installed separately
    onProgress?.('Installing pip...', undefined)

    // Download get-pip.py
    const getPipPath = path.join(pythonDir, 'get-pip.py')
    await downloadFile('https://bootstrap.pypa.io/get-pip.py', getPipPath)

    // Uncomment import site in pythonXX._pth to enable pip
    const pthFiles = fs.readdirSync(pythonDir).filter(f => f.endsWith('._pth'))
    for (const pthFile of pthFiles) {
      const pthPath = path.join(pythonDir, pthFile)
      let content = fs.readFileSync(pthPath, 'utf-8')
      content = content.replace('#import site', 'import site')
      fs.writeFileSync(pthPath, content)
    }

    // Run get-pip.py
    const pythonPath = path.join(pythonDir, 'python.exe')
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
    await execAsync(`"${npmPath}" install -g @anthropic-ai/claude-code`, { timeout: 300000 })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

// Get the beads binary path
export function getBeadsBinaryPath(): string | null {
  const beadsDir = path.join(app.getPath('userData'), 'deps', 'beads')
  const binaryName = isWindows ? 'bd.exe' : 'bd'
  const binaryPath = path.join(beadsDir, binaryName)
  return fs.existsSync(binaryPath) ? binaryPath : null
}

// Get beads bin directory
export function getBeadsBinDir(): string {
  return path.join(app.getPath('userData'), 'deps', 'beads')
}

// Install Beads CLI (Go binary from GitHub releases)
export async function installBeadsBinary(onProgress?: (status: string, percent?: number) => void): Promise<{ success: boolean; error?: string }> {
  try {
    ensureDepsDir()

    const beadsDir = path.join(app.getPath('userData'), 'deps', 'beads')
    if (!fs.existsSync(beadsDir)) {
      fs.mkdirSync(beadsDir, { recursive: true })
    }

    // Determine platform and architecture
    const platform = process.platform
    const arch = process.arch

    // Determine platform pattern for asset matching
    // Asset names are like: beads_0.38.0_windows_amd64.zip
    let osName: string
    let archName: string
    let ext: string

    if (platform === 'win32') {
      osName = 'windows'
      ext = '.zip'
    } else if (platform === 'darwin') {
      osName = 'darwin'
      ext = '.tar.gz'
    } else {
      osName = 'linux'
      ext = '.tar.gz'
    }

    archName = arch === 'arm64' ? 'arm64' : 'amd64'

    // Get latest release URL from GitHub
    onProgress?.('Fetching latest release info...', 0)

    const releaseUrl = 'https://api.github.com/repos/steveyegge/beads/releases/latest'
    const releaseInfo = await new Promise<any>((resolve, reject) => {
      https.get(releaseUrl, { headers: { 'User-Agent': 'simple-code-gui' } }, (res) => {
        let data = ''
        res.on('data', chunk => data += chunk)
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch (e) {
            reject(new Error('Failed to parse release info'))
          }
        })
      }).on('error', reject)
    })

    // Find asset matching pattern: beads_VERSION_OS_ARCH.EXT
    const assetPattern = new RegExp(`beads_.*_${osName}_${archName}\\${ext}$`)
    const asset = releaseInfo.assets?.find((a: any) => assetPattern.test(a.name))
    if (!asset) {
      return { success: false, error: `No release found for ${osName}_${archName}${ext}` }
    }

    const downloadUrl = asset.browser_download_url
    const archivePath = path.join(beadsDir, `beads${ext}`)

    onProgress?.('Downloading Beads CLI...', 10)
    await downloadFile(downloadUrl, archivePath, (percent) => {
      onProgress?.('Downloading Beads CLI...', 10 + Math.round(percent * 0.7))
    })

    onProgress?.('Extracting Beads CLI...', 85)
    await extractArchive(archivePath, beadsDir)

    // Cleanup archive
    fs.unlinkSync(archivePath)

    // On Unix, make binary executable
    if (!isWindows) {
      const binaryPath = path.join(beadsDir, 'bd')
      if (fs.existsSync(binaryPath)) {
        fs.chmodSync(binaryPath, 0o755)
      }
    }

    // Verify installation
    const binaryPath = getBeadsBinaryPath()
    if (!binaryPath) {
      return { success: false, error: 'Beads extraction failed - binary not found' }
    }

    onProgress?.('Beads CLI installed successfully', 100)
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}
