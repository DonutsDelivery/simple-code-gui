// Download utilities for voice manager

import * as fs from 'fs'
import * as https from 'https'
import { exec } from 'child_process'
import { promisify } from 'util'

import { isWindows } from '../platform.js'
import type { ProgressCallback } from './types.js'

const execAsync = promisify(exec)

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)

    const request = https.get(url, (response) => {
      // Handle redirects (301, 302, 307, 308)
      if (response.statusCode && [301, 302, 307, 308].includes(response.statusCode)) {
        file.close()
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
        const location = response.headers.location
        if (!location) {
          reject(new Error('Redirect with no location header'))
          return
        }
        const redirectUrl = location.startsWith('http') ? location : new URL(location, url).toString()
        downloadFile(redirectUrl, destPath, onProgress)
          .then(resolve)
          .catch(reject)
        return
      }

      if (response.statusCode !== 200) {
        file.close()
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
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
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
        reject(err)
      })
    })

    request.on('error', (err) => {
      file.close()
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
      reject(err)
    })
  })
}

export function fetchJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      // Handle redirects (301, 302, 307, 308)
      if (response.statusCode && [301, 302, 307, 308].includes(response.statusCode)) {
        const location = response.headers.location
        if (!location) {
          reject(new Error('Redirect with no location header'))
          return
        }
        const redirectUrl = location.startsWith('http') ? location : new URL(location, url).toString()
        fetchJson<T>(redirectUrl)
          .then(resolve)
          .catch(reject)
        return
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`))
        return
      }

      let data = ''
      response.on('data', chunk => data += chunk)
      response.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(e)
        }
      })
    })

    request.on('error', reject)
  })
}

export async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  ensureDir(destDir)

  if (isWindows) {
    await execAsync(
      `powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force"`,
      { timeout: 120000 }
    )
  } else if (archivePath.endsWith('.tar.gz')) {
    await execAsync(`tar -xzf "${archivePath}" -C "${destDir}"`, { timeout: 120000 })
  } else {
    await execAsync(`unzip -o "${archivePath}" -d "${destDir}"`, { timeout: 120000 })
  }
}
