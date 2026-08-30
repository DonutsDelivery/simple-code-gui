import type { Express, Request, Response } from 'express'
import { existsSync } from 'fs'
import { resolve } from 'path'
import type { RepositoryRegistry } from '../../repository-registry'
import {
  createGitBundle,
  createPatchManifest,
  materializeRevision,
  previewPatchApply,
} from '../../repository-transfer'
import { log } from '../utils'

/**
 * Checkpoint 10 — scoped repository identity/materialization endpoints.
 *
 * All routes require an authenticated device; mutations (identify/materialize/
 * bundle/patch-preview) are write-scoped via the shared middleware, and reads
 * (list) are read-scoped. Path inputs are resolved server-side; the server
 * never accepts a path that does not exist.
 */
export function setupRepositoryRoutes(
  app: Express,
  getRegistry: () => RepositoryRegistry | null,
  getServerId: () => string,
): void {
  app.get('/api/repositories', (_req: Request, res: Response) => {
    const registry = getRegistry()
    if (!registry) return res.status(503).json({ error: 'Repository registry is not available' })
    return res.json({
      repositories: registry.listRepositories(),
      checkouts: registry.listCheckouts(),
      serverId: getServerId(),
    })
  })

  app.post('/api/repositories/identify', async (req: Request, res: Response) => {
    const registry = getRegistry()
    if (!registry) return res.status(503).json({ error: 'Repository registry is not available' })
    const { path } = req.body ?? {}
    if (typeof path !== 'string' || !path) {
      return res.status(400).json({ error: 'path is required' })
    }
    const resolved = resolve(path)
    if (!existsSync(resolved)) return res.status(404).json({ error: `Path does not exist: ${resolved}` })
    try {
      const checkout = await registry.identify(resolved)
      log('Repository identified', { repositoryId: checkout.repositoryId, path: resolved, commit: checkout.commit.slice(0, 12), tree: checkout.tree.slice(0, 12) })
      return res.json({ checkout, repository: registry.getRepository(checkout.repositoryId) })
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Identification failed' })
    }
  })

  app.post('/api/repositories/materialize', async (req: Request, res: Response) => {
    const registry = getRegistry()
    if (!registry) return res.status(503).json({ error: 'Repository registry is not available' })
    const { destinationDir, repositoryId, commit, remoteUrl, bundlePath, sourceServerId } = req.body ?? {}
    if (typeof destinationDir !== 'string' || !destinationDir) {
      return res.status(400).json({ error: 'destinationDir is required' })
    }
    if (typeof repositoryId !== 'string' || typeof commit !== 'string' || !commit) {
      return res.status(400).json({ error: 'repositoryId and commit are required' })
    }
    if (typeof remoteUrl !== 'string' && typeof bundlePath !== 'string') {
      return res.status(400).json({ error: 'remoteUrl or bundlePath is required' })
    }
    try {
      const receipt = await materializeRevision(registry, sourceServerId ?? getServerId(), {
        destinationDir,
        repositoryId,
        commit,
        remoteUrl,
        bundlePath,
      })
      log('Revision materialized', { repositoryId, commit: commit.slice(0, 12), tree: receipt.tree.slice(0, 12), path: receipt.absolutePath, via: receipt.via })
      return res.json({ receipt })
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Materialization failed' })
    }
  })

  app.post('/api/repositories/bundle', async (req: Request, res: Response) => {
    const { sourcePath, revision, bundlePath } = req.body ?? {}
    if (typeof sourcePath !== 'string' || typeof revision !== 'string' || typeof bundlePath !== 'string') {
      return res.status(400).json({ error: 'sourcePath, revision, and bundlePath are required' })
    }
    try {
      const created = await createGitBundle({ sourcePath: resolve(sourcePath), revision, bundlePath: resolve(bundlePath) })
      return res.json({ bundlePath: created })
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Bundle creation failed' })
    }
  })

  app.post('/api/repositories/patch-manifest', async (req: Request, res: Response) => {
    const registry = getRegistry()
    if (!registry) return res.status(503).json({ error: 'Repository registry is not available' })
    const { checkoutId } = req.body ?? {}
    if (typeof checkoutId !== 'string' || !checkoutId) {
      return res.status(400).json({ error: 'checkoutId is required' })
    }
    const checkout = registry.getCheckout(checkoutId)
    if (!checkout) return res.status(404).json({ error: 'checkout not found' })
    try {
      const manifest = await createPatchManifest(registry, checkout)
      return res.json({ manifest })
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Patch manifest failed' })
    }
  })

  app.post('/api/repositories/patch-preview', async (req: Request, res: Response) => {
    const { destinationPath, patch } = req.body ?? {}
    if (typeof destinationPath !== 'string' || typeof patch !== 'string') {
      return res.status(400).json({ error: 'destinationPath and patch are required' })
    }
    try {
      const preview = await previewPatchApply(resolve(destinationPath), patch)
      return res.json({ preview })
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Patch preview failed' })
    }
  })
}
