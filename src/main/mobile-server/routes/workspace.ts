/**
 * Workspace Routes - /api/workspace, /api/settings, /api/sessions, /api/project endpoints
 */

import { Express, Request, Response } from 'express'
import { basename } from 'path'
import { validateProjectPath } from '../../mobile-security'
import { discoverSessions } from '../../session-discovery'
import { log } from '../utils'

export function setupWorkspaceRoutes(
  app: Express,
  getSessionStore: () => any
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
      res.status(500).json({ error: String(error) })
    }
  })

  app.get('/api/workspace', async (_req: Request, res: Response) => {
    try {
      const sessionStore = getSessionStore()
      if (!sessionStore) {
        return res.status(500).json({ error: 'Session store not available' })
      }
      const workspace = sessionStore.getWorkspace()
      res.json(workspace)
    } catch (error) {
      res.status(500).json({ error: String(error) })
    }
  })

  app.put('/api/workspace', async (req: Request, res: Response) => {
    try {
      const sessionStore = getSessionStore()
      if (!sessionStore) {
        return res.status(500).json({ error: 'Session store not available' })
      }
      // Protect against overwriting populated workspace with empty one
      const incoming = req.body
      const incomingProjects = incoming?.projects?.length || 0
      if (incomingProjects === 0) {
        const current = sessionStore.getWorkspace()
        const currentProjects = current?.projects?.length || 0
        if (currentProjects > 0) {
          log('Rejected empty workspace save - current has projects', { currentProjects })
          return res.status(400).json({ error: 'Cannot overwrite populated workspace with empty one' })
        }
      }
      sessionStore.saveWorkspace(req.body)
      res.json({ success: true })
    } catch (error) {
      res.status(500).json({ error: String(error) })
    }
  })

  app.post('/api/workspace', async (req: Request, res: Response) => {
    try {
      const sessionStore = getSessionStore()
      if (!sessionStore) {
        return res.status(500).json({ error: 'Session store not available' })
      }
      // Protect against overwriting populated workspace with empty one
      const incoming = req.body
      const incomingProjects = incoming?.workspace?.projects?.length || 0
      if (incomingProjects === 0) {
        const current = sessionStore.getWorkspace()
        const currentProjects = current?.workspace?.projects?.length || 0
        if (currentProjects > 0) {
          log('Rejected empty workspace save - current has projects', { currentProjects })
          return res.status(400).json({ error: 'Cannot overwrite populated workspace with empty one' })
        }
      }
      sessionStore.saveWorkspace(req.body)
      res.json({ success: true })
    } catch (error) {
      res.status(500).json({ error: String(error) })
    }
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
      res.status(500).json({ error: String(error) })
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
      res.status(500).json({ error: String(error) })
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
      res.status(500).json({ error: String(error) })
    }
  })

  // Sessions discovery
  app.get('/api/sessions', async (req: Request, res: Response) => {
    try {
      const projectPath = req.query.path as string
      const backend = (req.query.backend as 'claude' | 'gemini' | 'codex' | 'opencode' | 'aider') || 'claude'
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
      res.status(500).json({ error: error.message || String(error) })
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
      res.status(500).json({ error: String(error) })
    }
  })
}
