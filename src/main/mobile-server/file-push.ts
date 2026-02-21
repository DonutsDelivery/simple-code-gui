/**
 * File Push - File push to mobile functionality
 */

import { WebSocket } from 'ws'
import { basename } from 'path'
import { existsSync, statSync } from 'fs'
import { validateFilePath } from '../mobile-security'
import { log } from './utils'
import { PendingFile } from './types'

const MIME_TYPES: Record<string, string> = {
  'apk': 'application/vnd.android.package-archive',
  'pdf': 'application/pdf',
  'zip': 'application/zip',
  'txt': 'text/plain',
  'json': 'application/json',
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'gif': 'image/gif'
}

export function sendFileToMobile(
  filePath: string,
  message: string | undefined,
  pendingFiles: Map<string, PendingFile>,
  connectedClients: Set<WebSocket>
): { success: boolean; fileId?: string; error?: string } {
  try {
    const pathValidation = validateFilePath(filePath)
    if (!pathValidation.valid) {
      return { success: false, error: pathValidation.error }
    }
    const safePath = pathValidation.normalizedPath!

    const stats = statSync(safePath)
    const fileName = basename(safePath)

    const ext = fileName.split('.').pop()?.toLowerCase() || ''
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream'

    const fileId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const pendingFile: PendingFile = {
      id: fileId,
      name: fileName,
      path: safePath,
      size: stats.size,
      mimeType,
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes
      message
    }

    pendingFiles.set(fileId, pendingFile)

    cleanupExpiredFiles(pendingFiles)

    const notification = {
      type: 'file:available',
      file: {
        id: fileId,
        name: fileName,
        size: stats.size,
        mimeType,
        message
      }
    }

    connectedClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(notification))
      }
    })

    log('File queued for mobile', { fileId, fileName, size: stats.size, connectedClients: connectedClients.size })

    return { success: true, fileId }
  } catch (error: any) {
    log('Error sending file to mobile', { error: String(error) })
    return { success: false, error: error.message || String(error) }
  }
}

export function getPendingFilesList(pendingFiles: Map<string, PendingFile>): PendingFile[] {
  cleanupExpiredFiles(pendingFiles)
  return Array.from(pendingFiles.values())
}

export function removePendingFile(fileId: string, pendingFiles: Map<string, PendingFile>): boolean {
  return pendingFiles.delete(fileId)
}

export function cleanupExpiredFiles(pendingFiles: Map<string, PendingFile>): void {
  const now = Date.now()
  for (const [fileId, file] of pendingFiles) {
    if (file.expiresAt < now) {
      pendingFiles.delete(fileId)
      log('Expired pending file removed', { fileId, name: file.name })
    }
  }
}
