import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  RepositoryRegistry,
  deriveRepositoryId,
  normalizeGitRemote,
} from '../repository-registry'
import {
  createGitBundle,
  createPatchManifest,
  materializeRevision,
  previewPatchApply,
} from '../repository-transfer'

const git = (args: string[], cwd: string): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

function makeRepo(root: string, name: string): string {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  git(['init', '-b', 'main'], dir)
  git(['config', 'user.email', 'test@example.com'], dir)
  git(['config', 'user.name', 'Test'], dir)
  writeFileSync(join(dir, 'file.txt'), 'hello\n')
  git(['add', '.'], dir)
  git(['commit', '-m', 'initial'], dir)
  git(['remote', 'add', 'origin', 'https://user:secret@github.com/acme/widget.git'], dir)
  return dir
}

describe('repository identity', () => {
  it('normalizes git remotes: strips credentials, merges ssh syntax variants, dedupes', () => {
    expect(normalizeGitRemote('https://user:secret@github.com/acme/widget.git')).toBe('https://github.com/acme/widget')
    expect(normalizeGitRemote('git@github.com:acme/widget.git')).toBe('github.com:acme/widget')
    // ssh:// and scp-like syntax for the same host/path merge to one canonical form.
    expect(normalizeGitRemote('ssh://git@github.com/acme/widget.git')).toBe('github.com:acme/widget')
    expect(normalizeGitRemote('ssh://github.com/acme/widget')).toBe('github.com:acme/widget')
    expect(normalizeGitRemote('https://GitHub.com/Acme/Widget.git/')).toBe('https://github.com/acme/widget')
    expect(normalizeGitRemote('https://github.com/acme/widget.git  (fetch)')).toBe('https://github.com/acme/widget')
  })

  it('derives the same repositoryId from the same remotes regardless of order', () => {
    const a = deriveRepositoryId(['https://github.com/acme/widget', 'github.com:acme/tools'])
    const b = deriveRepositoryId(['github.com:acme/tools', 'https://github.com/acme/widget'])
    const c = deriveRepositoryId(['https://github.com/other/project'])
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})

describe('RepositoryRegistry', () => {
  let dir: string
  let registry: RepositoryRegistry

  beforeEach(() => {
    dir = join(tmpdir(), `dc-repo-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    registry = new RepositoryRegistry(dir, 'server-a')
  })

  afterEach(() => {
    // Best-effort cleanup; git objects are small.
  })

  it('identifies a git checkout with a remote-backed repository identity', async () => {
    const repo = makeRepo(dir, 'src')
    const checkout = await registry.identify(repo)

    expect(checkout.serverId).toBe('server-a')
    expect(checkout.absolutePath).toBe(repo)
    expect(checkout.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(checkout.tree).toMatch(/^[0-9a-f]{40}$/)
    expect(checkout.dirty).toBe(false)
    expect(checkout.repositoryId).toMatch(/^[0-9a-f]{64}$/)

    const repository = registry.getRepository(checkout.repositoryId)
    expect(repository?.normalizedRemotes).toContain('https://github.com/acme/widget')
    expect(repository?.normalizedRemotes.some(r => r.includes('secret'))).toBe(false)
  })

  it('resolves the same repositoryId + tree for two checkouts at different native paths', async () => {
    const source = makeRepo(dir, 'source')
    const clone = join(dir, 'clone')
    git(['clone', '--quiet', source, clone], dir)
    // Point the clone at the same canonical remote as the source so both
    // checkouts resolve to the same repository identity (native paths differ).
    git(['remote', 'set-url', 'origin', 'https://github.com/acme/widget.git'], clone)

    const a = await registry.identify(source)
    const b = await registry.identify(clone)

    expect(a.repositoryId).toBe(b.repositoryId)
    expect(a.tree).toBe(b.tree)
    expect(a.commit).toBe(b.commit)
    expect(a.absolutePath).not.toBe(b.absolutePath)
  })

  it('persists the registry across instances', async () => {
    const repo = makeRepo(dir, 'persist')
    await registry.identify(repo)
    const reloaded = new RepositoryRegistry(dir, 'server-a')
    expect(reloaded.listCheckouts()).toHaveLength(1)
    expect(reloaded.listRepositories()).toHaveLength(1)
  })
})

describe('materialization', () => {
  let dir: string
  let source: string
  let registry: RepositoryRegistry

  beforeEach(async () => {
    dir = join(tmpdir(), `dc-mat-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    registry = new RepositoryRegistry(dir, 'server-dest')
    source = makeRepo(dir, 'source')
  })

  it('materializes the exact revision via remote clone and verifies the same tree', async () => {
    const sourceCheckout = await registry.identify(source)
    const receipt = await materializeRevision(registry, 'server-src', {
      destinationDir: dir,
      repositoryId: sourceCheckout.repositoryId,
      commit: sourceCheckout.commit,
      remoteUrl: `file://${source}`,
    })

    expect(receipt.commit).toBe(sourceCheckout.commit)
    expect(receipt.tree).toBe(sourceCheckout.tree)
    expect(receipt.via).toBe('clone')
    expect(receipt.sourceServerId).toBe('server-src')
    expect(existsSync(join(receipt.absolutePath, 'file.txt'))).toBe(true)
    // The materialized checkout is at a DIFFERENT native path with the SAME tree.
    expect(receipt.absolutePath).not.toBe(source)
  })

  it('materializes from a git bundle when hosts cannot reach a common remote', async () => {
    const sourceCheckout = await registry.identify(source)
    const bundlePath = join(dir, 'widget.bundle')
    await createGitBundle({ sourcePath: source, revision: 'main', bundlePath })

    const receipt = await materializeRevision(registry, 'server-src', {
      destinationDir: dir,
      repositoryId: sourceCheckout.repositoryId,
      commit: sourceCheckout.commit,
      bundlePath,
    })

    expect(receipt.via).toBe('bundle')
    expect(receipt.tree).toBe(sourceCheckout.tree)
    expect(existsSync(join(receipt.absolutePath, 'file.txt'))).toBe(true)
  })

  it('captures uncommitted work as an explicit patch manifest (never silent copies)', async () => {
    const checkout = await registry.identify(source)
    writeFileSync(join(source, 'file.txt'), 'hello\nchanged\n')
    writeFileSync(join(source, 'untracked.txt'), 'new\n')

    const manifest = await createPatchManifest(registry, checkout)

    expect(manifest.repositoryId).toBe(checkout.repositoryId)
    expect(manifest.trackedDiff).toContain('changed')
    expect(manifest.untrackedFiles).toContain('untracked.txt')

    // Preview against a clean checkout of the same commit: the diff context
    // matches, so it would apply cleanly (dry-run only, no mutation).
    const clean = join(dir, 'clean')
    git(['clone', '--quiet', source, clean], dir)
    git(['checkout', '--detach', checkout.commit], clean)
    const preview = await previewPatchApply(clean, manifest.trackedDiff)
    expect(preview.wouldApplyCleanly).toBe(true)
    expect(preview.hasConflicts).toBe(false)

    // Preview against a checkout whose file differs: conflict.
    writeFileSync(join(clean, 'file.txt'), 'conflicting content\n')
    const conflictPreview = await previewPatchApply(clean, manifest.trackedDiff)
    expect(conflictPreview.wouldApplyCleanly).toBe(false)
    expect(conflictPreview.hasConflicts).toBe(true)
  })
})
