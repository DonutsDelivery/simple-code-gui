/**
 * Beads Routes - /projects/beads/* endpoints
 */

import { Express, Request, Response } from 'express'
import { join } from 'path'
import { existsSync } from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'
import { validateProjectPath } from '../../mobile-security'
import {
  getBeadsExecOptions,
  checkBeadsInstalled,
  spawnBdCommand,
  validateTaskId,
  TASK_ID_PATTERN
} from '../../ipc'
import { log } from '../utils'

const execAsync = promisify(exec)

export function setupBeadsRoutes(app: Express): void {
  // Check if beads is installed and initialized
  app.get('/projects/beads/check', async (req: Request, res: Response) => {
    try {
      const cwd = req.query.cwd as string
      if (!cwd) {
        return res.status(400).json({ error: 'cwd query parameter is required' })
      }

      const pathValidation = validateProjectPath(cwd)
      if (!pathValidation.valid) {
        return res.status(400).json({ error: pathValidation.error })
      }
      const safeCwd = pathValidation.normalizedPath!

      const installed = await checkBeadsInstalled()
      if (!installed) {
        return res.json({ installed: false, initialized: false })
      }

      const beadsDir = join(safeCwd, '.beads')
      res.json({ installed: true, initialized: existsSync(beadsDir) })
    } catch (error) {
      log('Beads check error', { error: String(error) })
      res.status(500).json({ error: String(error) })
    }
  })

  // Initialize beads in a project
  app.post('/projects/beads/init', async (req: Request, res: Response) => {
    try {
      const { cwd } = req.body
      if (!cwd) {
        return res.status(400).json({ error: 'cwd is required' })
      }

      const pathValidation = validateProjectPath(cwd)
      if (!pathValidation.valid) {
        return res.status(400).json({ error: pathValidation.error })
      }
      const safeCwd = pathValidation.normalizedPath!

      await execAsync('bd init', { ...getBeadsExecOptions(), cwd: safeCwd })
      res.json({ success: true })
    } catch (error: any) {
      log('Beads init error', { error: String(error) })
      res.status(500).json({ success: false, error: error.message || String(error) })
    }
  })

  // Get tasks ready to work on
  app.get('/projects/beads/ready', async (req: Request, res: Response) => {
    try {
      const cwd = req.query.cwd as string
      if (!cwd) {
        return res.status(400).json({ error: 'cwd query parameter is required' })
      }

      const pathValidation = validateProjectPath(cwd)
      if (!pathValidation.valid) {
        return res.status(400).json({ error: pathValidation.error })
      }
      const safeCwd = pathValidation.normalizedPath!

      const { stdout } = await execAsync('bd ready --json', { ...getBeadsExecOptions(), cwd: safeCwd })
      res.json({ success: true, tasks: JSON.parse(stdout) })
    } catch (error: any) {
      log('Beads ready error', { error: String(error) })
      res.status(500).json({ success: false, error: error.message || String(error) })
    }
  })

  // List all tasks
  app.get('/projects/beads/tasks', async (req: Request, res: Response) => {
    try {
      const cwd = req.query.cwd as string
      if (!cwd) {
        return res.status(400).json({ error: 'cwd query parameter is required' })
      }

      const pathValidation = validateProjectPath(cwd)
      if (!pathValidation.valid) {
        return res.status(400).json({ error: pathValidation.error })
      }
      const safeCwd = pathValidation.normalizedPath!

      const { stdout } = await execAsync('bd list --json', { ...getBeadsExecOptions(), cwd: safeCwd })
      res.json(JSON.parse(stdout))
    } catch (error: any) {
      log('Beads list error', { error: String(error) })
      res.status(500).json({ error: error.message || String(error) })
    }
  })

  // Show a specific task
  app.get('/projects/beads/tasks/:taskId', async (req: Request, res: Response) => {
    try {
      const { taskId } = req.params
      const cwd = req.query.cwd as string
      if (!cwd) {
        return res.status(400).json({ error: 'cwd query parameter is required' })
      }

      const pathValidation = validateProjectPath(cwd)
      if (!pathValidation.valid) {
        return res.status(400).json({ error: pathValidation.error })
      }
      const safeCwd = pathValidation.normalizedPath!

      validateTaskId(taskId)
      const { stdout } = await spawnBdCommand(['show', taskId, '--json'], { cwd: safeCwd })
      res.json(JSON.parse(stdout))
    } catch (error: any) {
      log('Beads show error', { error: String(error) })
      res.status(500).json({ error: error.message || String(error) })
    }
  })

  // Create a new task
  app.post('/projects/beads/tasks', async (req: Request, res: Response) => {
    try {
      const { cwd, title, description, priority, type, labels } = req.body
      if (!cwd) {
        return res.status(400).json({ error: 'cwd is required' })
      }
      if (!title || typeof title !== 'string') {
        return res.status(400).json({ error: 'title is required' })
      }
      if (type && !TASK_ID_PATTERN.test(type)) {
        return res.status(400).json({ error: 'Invalid type format' })
      }

      const pathValidation = validateProjectPath(cwd)
      if (!pathValidation.valid) {
        return res.status(400).json({ error: pathValidation.error })
      }
      const safeCwd = pathValidation.normalizedPath!

      const args = ['create', title]
      if (description) args.push('-d', description)
      if (priority !== undefined) args.push('-p', String(priority))
      if (type) args.push('-t', type)
      if (labels) args.push('-l', labels)
      args.push('--json')

      const { stdout } = await spawnBdCommand(args, { cwd: safeCwd })
      res.json(JSON.parse(stdout))
    } catch (error: any) {
      log('Beads create error', { error: String(error) })
      res.status(500).json({ error: error.message || String(error) })
    }
  })

  // Mark task as complete
  app.post('/projects/beads/tasks/:taskId/complete', async (req: Request, res: Response) => {
    try {
      const { taskId } = req.params
      const { cwd } = req.body
      if (!cwd) {
        return res.status(400).json({ error: 'cwd is required' })
      }

      const pathValidation = validateProjectPath(cwd)
      if (!pathValidation.valid) {
        return res.status(400).json({ error: pathValidation.error })
      }
      const safeCwd = pathValidation.normalizedPath!

      validateTaskId(taskId)
      const { stdout } = await spawnBdCommand(['close', taskId, '--json'], { cwd: safeCwd })
      res.json({ success: true, result: JSON.parse(stdout) })
    } catch (error: any) {
      log('Beads complete error', { error: String(error) })
      res.status(500).json({ success: false, error: error.message || String(error) })
    }
  })

  // Start working on a task
  app.post('/projects/beads/tasks/:taskId/start', async (req: Request, res: Response) => {
    try {
      const { taskId } = req.params
      const { cwd } = req.body
      if (!cwd) {
        return res.status(400).json({ error: 'cwd is required' })
      }

      const pathValidation = validateProjectPath(cwd)
      if (!pathValidation.valid) {
        return res.status(400).json({ error: pathValidation.error })
      }
      const safeCwd = pathValidation.normalizedPath!

      validateTaskId(taskId)
      await spawnBdCommand(['update', taskId, '--status', 'in_progress'], { cwd: safeCwd })
      res.json({ success: true })
    } catch (error: any) {
      log('Beads start error', { error: String(error) })
      res.status(500).json({ success: false, error: error.message || String(error) })
    }
  })

  // Update a task
  app.patch('/projects/beads/tasks/:taskId', async (req: Request, res: Response) => {
    try {
      const { taskId } = req.params
      const { cwd, status, title, description, priority } = req.body
      if (!cwd) {
        return res.status(400).json({ error: 'cwd is required' })
      }

      const pathValidation = validateProjectPath(cwd)
      if (!pathValidation.valid) {
        return res.status(400).json({ error: pathValidation.error })
      }
      const safeCwd = pathValidation.normalizedPath!

      validateTaskId(taskId)
      const args = ['update', taskId]
      if (status) args.push('--status', status)
      if (title) args.push('--title', title)
      if (description !== undefined) args.push('--description', description)
      if (priority !== undefined) args.push('--priority', String(priority))

      await spawnBdCommand(args, { cwd: safeCwd })
      res.json({ success: true })
    } catch (error: any) {
      log('Beads update error', { error: String(error) })
      res.status(500).json({ success: false, error: error.message || String(error) })
    }
  })

  // Delete a task
  app.delete('/projects/beads/tasks/:taskId', async (req: Request, res: Response) => {
    try {
      const { taskId } = req.params
      const cwd = req.query.cwd as string
      if (!cwd) {
        return res.status(400).json({ error: 'cwd query parameter is required' })
      }

      const pathValidation = validateProjectPath(cwd)
      if (!pathValidation.valid) {
        return res.status(400).json({ error: pathValidation.error })
      }
      const safeCwd = pathValidation.normalizedPath!

      validateTaskId(taskId)
      await spawnBdCommand(['delete', taskId, '--force'], { cwd: safeCwd })
      res.json({ success: true })
    } catch (error: any) {
      log('Beads delete error', { error: String(error) })
      res.status(500).json({ success: false, error: error.message || String(error) })
    }
  })
}
