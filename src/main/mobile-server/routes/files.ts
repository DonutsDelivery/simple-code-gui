/**
 * Files Routes - /api/files/* endpoints
 */

import { Express, Request, Response } from 'express'
import { basename, resolve } from 'path'
import { existsSync, statSync, readdirSync, createReadStream } from 'fs'
import {
  validateFilePath,
  validateDirectoryPath,
  validateWithinProjectRoots
} from '../../mobile-security'
import { log, getProjectRoots } from '../utils'
import { PendingFile } from '../types'
import type { SessionStore } from '../../session-store'

export function setupFilesRoutes(
  app: Express,
  getPendingFiles: () => Map<string, PendingFile>,
  sendFileToMobile: (filePath: string, message?: string) => { success: boolean; fileId?: string; error?: string },
  removePendingFile: (fileId: string) => boolean,
  getConnectedClientCount: () => number,
  getSessionStore: () => SessionStore | null
): void {
  // List directory contents
  app.get('/api/files/list', async (req: Request, res: Response) => {
    try {
      const dirPath = req.query.path as string
      const basePath = req.query.basePath as string
      if (!dirPath) {
        return res.status(400).json({ error: 'path query parameter is required' })
      }
      if (!basePath) {
        return res.status(400).json({ error: 'basePath query parameter is required (project root)' })
      }

      // M1: the client-supplied basePath must itself be a registered project
      // root (or under one) — not just any existing directory.
      const baseValidation = validateWithinProjectRoots(
        basePath,
        getProjectRoots(getSessionStore()),
        { mustExist: true, mustBeDirectory: true }
      )
      if (!baseValidation.valid) {
        return res.status(400).json({ error: `Invalid basePath: ${baseValidation.error}` })
      }
      const safeBasePath = baseValidation.normalizedPath!

      const pathValidation = validateDirectoryPath(dirPath, [safeBasePath])
      if (!pathValidation.valid) {
        return res.status(400).json({ error: pathValidation.error })
      }
      const safePath = pathValidation.normalizedPath!

      const entries = readdirSync(safePath, { withFileTypes: true })
      const files = entries.map(entry => {
        const fullPath = resolve(safePath, entry.name)
        let stats = null
        try {
          stats = statSync(fullPath)
        } catch {
          // Ignore stat errors
        }
        return {
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file',
          size: stats?.size || 0,
          modified: stats?.mtime?.toISOString() || null,
          path: fullPath
        }
      })

      // Sort: directories first, then files, alphabetically
      files.sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1
        if (a.type !== 'directory' && b.type === 'directory') return 1
        return a.name.localeCompare(b.name)
      })

      res.json({ path: safePath, basePath: safeBasePath, files })
    } catch (error: any) {
      log('Files list error', { error: String(error) })
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // Download a file
  app.get('/api/files/download', async (req: Request, res: Response) => {
    try {
      const filePath = req.query.path as string
      const basePath = req.query.basePath as string
      if (!filePath) {
        return res.status(400).json({ error: 'path query parameter is required' })
      }
      if (!basePath) {
        return res.status(400).json({ error: 'basePath query parameter is required (project root)' })
      }

      // M1: the client-supplied basePath must itself be a registered project
      // root (or under one) — not just any existing directory.
      const baseValidation = validateWithinProjectRoots(
        basePath,
        getProjectRoots(getSessionStore()),
        { mustExist: true, mustBeDirectory: true }
      )
      if (!baseValidation.valid) {
        return res.status(400).json({ error: `Invalid basePath: ${baseValidation.error}` })
      }
      const safeBasePath = baseValidation.normalizedPath!

      const pathValidation = validateFilePath(filePath, [safeBasePath])
      if (!pathValidation.valid) {
        return res.status(400).json({ error: pathValidation.error })
      }
      const safePath = pathValidation.normalizedPath!

      const stats = statSync(safePath)
      const fileName = basename(safePath)

      res.setHeader('Content-Type', 'application/octet-stream')
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
      res.setHeader('Content-Length', stats.size)

      const fileStream = createReadStream(safePath)
      fileStream.pipe(res)

      fileStream.on('error', (err) => {
        log('File stream error', { error: String(err) })
        if (!res.headersSent) {
          res.status(500).json({ error: 'Error reading file' })
        }
      })
    } catch (error: any) {
      log('File download error', { error: String(error) })
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // Get file/directory info
  app.get('/api/files/info', async (req: Request, res: Response) => {
    try {
      const filePath = req.query.path as string
      if (!filePath) {
        return res.status(400).json({ error: 'path query parameter is required' })
      }

      // M1: only stat paths inside a registered project (file or directory).
      // Previously this validated against the system blocklist only, allowing a
      // LAN token-holder to stat any readable file outside blocked system roots.
      const validation = validateWithinProjectRoots(
        filePath,
        getProjectRoots(getSessionStore()),
        { mustExist: true }
      )
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error })
      }
      const safePath = validation.normalizedPath!

      const stats = statSync(safePath)
      res.json({
        path: safePath,
        name: basename(safePath),
        type: stats.isDirectory() ? 'directory' : stats.isSymbolicLink() ? 'symlink' : 'file',
        size: stats.size,
        modified: stats.mtime.toISOString(),
        created: stats.birthtime.toISOString(),
        isReadable: true
      })
    } catch (error: any) {
      log('File info error', { error: String(error) })
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // Queue a file for mobile download
  app.post('/api/files/send', async (req: Request, res: Response) => {
    try {
      const { path: filePath, message } = req.body
      if (!filePath) {
        return res.status(400).json({ error: 'path is required in request body' })
      }

      // M1: only send files that live inside a registered project. Previously
      // any readable file outside blocked system roots could be exfiltrated.
      const pathValidation = validateWithinProjectRoots(
        filePath,
        getProjectRoots(getSessionStore()),
        { mustExist: true, mustBeDirectory: false }
      )
      if (!pathValidation.valid) {
        return res.status(400).json({ error: pathValidation.error })
      }

      const result = sendFileToMobile(pathValidation.normalizedPath!, message)
      if (result.success) {
        res.json({
          success: true,
          fileId: result.fileId,
          connectedClients: getConnectedClientCount()
        })
      } else {
        res.status(400).json({ success: false, error: result.error })
      }
    } catch (error: any) {
      log('File send error', { error: String(error) })
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // Get list of pending files
  app.get('/api/files/pending', async (_req: Request, res: Response) => {
    try {
      const pendingFilesMap = getPendingFiles()
      const files = Array.from(pendingFilesMap.values()).map(f => ({
        id: f.id,
        name: f.name,
        size: f.size,
        mimeType: f.mimeType,
        message: f.message,
        expiresAt: f.expiresAt
      }))
      res.json({ files })
    } catch (error: any) {
      log('Pending files error', { error: String(error) })
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // Download a pending file
  app.get('/api/files/pending/:fileId/download', async (req: Request, res: Response) => {
    try {
      const { fileId } = req.params
      const pendingFilesMap = getPendingFiles()
      const pendingFile = pendingFilesMap.get(fileId)

      if (!pendingFile) {
        return res.status(404).json({ error: 'File not found or expired' })
      }

      if (!existsSync(pendingFile.path)) {
        pendingFilesMap.delete(fileId)
        return res.status(404).json({ error: 'File no longer exists' })
      }

      const stats = statSync(pendingFile.path)

      res.setHeader('Content-Type', pendingFile.mimeType)
      res.setHeader('Content-Disposition', `attachment; filename="${pendingFile.name}"`)
      res.setHeader('Content-Length', stats.size)

      const fileStream = createReadStream(pendingFile.path)
      fileStream.pipe(res)

      fileStream.on('error', (err) => {
        log('Pending file stream error', { error: String(err), fileId })
        if (!res.headersSent) {
          res.status(500).json({ error: 'Error reading file' })
        }
      })
    } catch (error: any) {
      log('Pending file download error', { error: String(error) })
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // Remove a pending file
  app.delete('/api/files/pending/:fileId', async (req: Request, res: Response) => {
    try {
      const { fileId } = req.params
      const removed = removePendingFile(fileId)
      res.json({ success: removed })
    } catch (error: any) {
      log('Pending file delete error', { error: String(error) })
      res.status(500).json({ error: 'Internal server error' })
    }
  })
}
