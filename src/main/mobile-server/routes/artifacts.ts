import type { Express, Request, Response } from 'express'
import { existsSync } from 'fs'
import { resolve } from 'path'
import type { ArtifactStore } from '../../artifact-store'
import type { ArtifactUploadSink } from '../../artifact-transfer'
import { log } from '../utils'

/**
 * Checkpoint 11 — scoped artifact routes.
 *
 * Publish/list/inspect/download/expire through the authenticated API.
 * Publish and download are write-scoped; list/inspect are read-scoped. The
 * sink for chunked uploads is bound to the requesting device's session so an
 * interrupted transfer can resume from the last verified offset.
 */
export function setupArtifactRoutes(
  app: Express,
  getStore: () => ArtifactStore | null,
  getServerId: () => string,
  getSink: (clientKey: string) => ArtifactUploadSink | null,
): void {
  app.get('/api/artifacts', (req: Request, res: Response) => {
    const store = getStore()
    if (!store) return res.status(503).json({ error: 'Artifact store is not available' })
    const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined
    const producerServerId = typeof req.query.producerServerId === 'string' ? req.query.producerServerId : undefined
    return res.json({
      artifacts: store.list({ producerServerId, kind: kind as never }),
      serverId: getServerId(),
    })
  })

  app.get('/api/artifacts/:artifactId', (req: Request, res: Response) => {
    const store = getStore()
    if (!store) return res.status(503).json({ error: 'Artifact store is not available' })
    const manifest = store.get(req.params.artifactId)
    if (!manifest) return res.status(404).json({ error: 'Artifact not found' })
    return res.json({ manifest })
  })

  app.post('/api/artifacts/publish', async (req: Request, res: Response) => {
    const store = getStore()
    if (!store) return res.status(503).json({ error: 'Artifact store is not available' })
    const { filePath, ...metadata } = req.body ?? {}
    if (typeof filePath !== 'string' || !filePath) {
      return res.status(400).json({ error: 'filePath is required' })
    }
    const resolved = resolve(filePath)
    if (!existsSync(resolved)) return res.status(404).json({ error: `Path does not exist: ${resolved}` })
    try {
      const manifest = await store.publish(resolved, {
        ...metadata,
        producerServerId: metadata.producerServerId ?? getServerId(),
        platform: metadata.platform ?? process.platform,
        architecture: metadata.architecture ?? process.arch,
        kind: metadata.kind ?? 'package',
      })
      log('Artifact published', { artifactId: manifest.artifactId.slice(0, 12), filename: manifest.filename, size: manifest.size })
      return res.json({ manifest })
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Publish failed' })
    }
  })

  app.get('/api/artifacts/:artifactId/download', (req: Request, res: Response) => {
    const store = getStore()
    if (!store) return res.status(503).json({ error: 'Artifact store is not available' })
    const blobPath = store.blobPathFor(req.params.artifactId)
    if (!blobPath) return res.status(404).json({ error: 'Artifact bytes not found' })
    const manifest = store.get(req.params.artifactId)!
    res.setHeader('Content-Type', manifest.mediaType || 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(manifest.filename)}"`)
    res.setHeader('X-Artifact-Sha256', manifest.sha256)
    return res.sendFile(blobPath)
  })

  app.delete('/api/artifacts/:artifactId', (req: Request, res: Response) => {
    const store = getStore()
    if (!store) return res.status(503).json({ error: 'Artifact store is not available' })
    const removed = store.expire(req.params.artifactId)
    if (!removed) return res.status(404).json({ error: 'Artifact not found' })
    return res.json({ removed: true })
  })

  // --- Chunked upload (server-to-server transfer) ---

  app.post('/api/artifacts/upload/:artifactId/start', (req: Request, res: Response) => {
    const store = getStore()
    if (!store) return res.status(503).json({ error: 'Artifact store is not available' })
    const clientKey = (req as Request & { authToken?: string }).authToken ?? 'shared'
    const sink = getSink(clientKey)
    if (!sink) return res.status(400).json({ error: 'No upload session for this device' })
    return res.json({ offset: sink.currentOffset() })
  })

  app.post('/api/artifacts/upload/:artifactId/chunk', async (req: Request, res: Response) => {
    const clientKey = (req as Request & { authToken?: string }).authToken ?? 'shared'
    const sink = getSink(clientKey)
    if (!sink) return res.status(400).json({ error: 'No upload session for this device' })
    const { offset, chunkBase64 } = req.body ?? {}
    if (typeof offset !== 'number' || typeof chunkBase64 !== 'string') {
      return res.status(400).json({ error: 'offset (number) and chunkBase64 (string) are required' })
    }
    try {
      const result = await sink.append(offset, chunkBase64)
      return res.json(result)
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Chunk write failed' })
    }
  })

  app.post('/api/artifacts/upload/:artifactId/complete', async (req: Request, res: Response) => {
    const store = getStore()
    if (!store) return res.status(503).json({ error: 'Artifact store is not available' })
    const clientKey = (req as Request & { authToken?: string }).authToken ?? 'shared'
    const sink = getSink(clientKey)
    if (!sink) return res.status(400).json({ error: 'No upload session for this device' })
    const metadata = req.body ?? {}
    try {
      const manifest = await sink.complete({
        filename: metadata.filename ?? 'artifact.bin',
        mediaType: metadata.mediaType ?? 'application/octet-stream',
        producerServerId: metadata.producerServerId ?? getServerId(),
        platform: metadata.platform ?? process.platform,
        architecture: metadata.architecture ?? process.arch,
        kind: metadata.kind ?? 'package',
        repositoryId: metadata.repositoryId,
        commit: metadata.commit,
        tree: metadata.tree,
        dirtyPatchId: metadata.dirtyPatchId,
        buildCommand: metadata.buildCommand,
      })
      log('Artifact upload completed', { artifactId: manifest.artifactId.slice(0, 12), size: manifest.size })
      return res.json({ manifest })
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Upload completion failed' })
    }
  })

  app.post('/api/artifacts/upload/:artifactId/cancel', (req: Request, res: Response) => {
    const clientKey = (req as Request & { authToken?: string }).authToken ?? 'shared'
    const sink = getSink(clientKey)
    if (!sink) return res.status(400).json({ error: 'No upload session for this device' })
    sink.cancel()
    return res.json({ cancelled: true })
  })
}
