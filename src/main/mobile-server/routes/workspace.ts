/**
 * Workspace Routes - /api/workspace, /api/settings, /api/sessions, /api/project endpoints
 */

import { Express, Request, Response } from 'express'
import { basename } from 'path'
import { validateProjectPath } from '../../mobile-security'
import { discoverSessions } from '../../session-discovery'
import { log } from '../utils'
import type { EnvironmentCommandRouter } from '../../environment-command-router.js'

export function setupWorkspaceRoutes(
  app: Express,
  getSessionStore: () => any,
  getEnvironmentRouter?: () => EnvironmentCommandRouter | null,
): void {
  // Reload workspace from disk
  app.post('/api/workspace/reload', async (_req: Request, res: Response) => {
    try {
      const sessionStore = getSessionStore()
      if (!sessionStore) {
        return res.status(500).json({ error: 'Session store not available' })
      }
      sessionStore.reloadFromDisk()
      const workspace = sessionStore.getWorkspace()
      res.json({ success: true, projectCount: workspace.projects?.length || 0 })
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  app.get('/api/workspace', async (_req: Request, res: Response) => {
    try {
      const sessionStore = getSessionStore()
      if (!sessionStore) {
        return res.status(500).json({ error: 'Session store not available' })
      }
      const workspace = getEnvironmentRouter?.()?.getSnapshot().workspace ?? sessionStore.getWorkspace()
      res.json(workspace)
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  app.put('/api/workspace', async (_req: Request, res: Response) => {
    res.status(410).json({
      error: 'Blind workspace replacement is disabled; use POST /api/environment/commands with expectedRevision',
      code: 'AUTHORITATIVE_COMMAND_REQUIRED',
    })
  })

  app.post('/api/workspace', async (_req: Request, res: Response) => {
    res.status(410).json({
      error: 'Blind workspace replacement is disabled; use POST /api/environment/commands with expectedRevision',
      code: 'AUTHORITATIVE_COMMAND_REQUIRED',
    })
  })

  // Settings routes
  app.get('/api/settings', async (_req: Request, res: Response) => {
    try {
      const sessionStore = getSessionStore()
      if (!sessionStore) {
        return res.status(500).json({ error: 'Session store not available' })
      }
      const settings = sessionStore.getSettings()
      res.json(settings)
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  app.put('/api/settings', async (req: Request, res: Response) => {
    try {
      const sessionStore = getSessionStore()
      if (!sessionStore) {
        return res.status(500).json({ error: 'Session store not available' })
      }
      sessionStore.saveSettings(req.body)
      res.json({ success: true })
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  app.post('/api/settings', async (req: Request, res: Response) => {
    try {
      const sessionStore = getSessionStore()
      if (!sessionStore) {
        return res.status(500).json({ error: 'Session store not available' })
      }
      sessionStore.saveSettings(req.body)
      res.json({ success: true })
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // Sessions discovery
  app.get('/api/sessions', async (req: Request, res: Response) => {
    try {
      const projectPath = req.query.path as string
      const backend = (req.query.backend as 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider' | 'droid' | 'hermes' | 'grok') || 'claude'
      if (!projectPath) {
        return res.status(400).json({ error: 'Missing path' })
      }

      const pathValidation = validateProjectPath(projectPath)
      if (!pathValidation.valid) {
        return res.status(400).json({ error: pathValidation.error })
      }
      const safeProjectPath = pathValidation.normalizedPath!

      const sessions = await discoverSessions(safeProjectPath, backend)
      res.json({ sessions })
    } catch (error: any) {
      log('Sessions error', { error: String(error) })
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // Project add
  app.post('/api/project/add', async (req: Request, res: Response) => {
    try {
      const { path: projectPath } = req.body

      if (!projectPath || typeof projectPath !== 'string') {
        return res.status(400).json({ error: 'path is required and must be a string' })
      }

      const pathValidation = validateProjectPath(projectPath)
      if (!pathValidation.valid) {
        return res.status(400).json({ error: pathValidation.error })
      }
      const safeProjectPath = pathValidation.normalizedPath!

      const name = basename(safeProjectPath)

      log('Project add', { path: safeProjectPath, name })
      res.json({ path: safeProjectPath, name })
    } catch (error) {
      log('Project add error', { error: String(error) })
      res.status(500).json({ error: 'Internal server error' })
    }
  })
}
