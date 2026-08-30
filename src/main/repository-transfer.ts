import { execFile } from 'child_process'
import { existsSync, mkdirSync, readdirSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { RepositoryRegistry, execGit, hashIdentity, readGitRepoFacts, type CheckoutIdentity } from './repository-registry.js'

/**
 * Checkpoint 10 — exact source materialization across servers.
 *
 * The normal source handoff is immutable commit/tree identity: the source
 * server reports `commit`/`tree`, and any destination server that can reach a
 * common remote materializes that exact revision via clone/fetch/checkout.
 * When hosts cannot reach a common remote, an explicit `git bundle` carries
 * the exact objects. Uncommitted work is NEVER silently copied (no live `.git`
 * directory or working tree transfer) — it requires an explicit patch manifest
 * and a destination conflict preview.
 */

export interface MaterializeOptions {
  /** Destination directory; the revision is checked out into a server-owned subdirectory. */
  destinationDir: string
  /** Repository identity on the destination (used for the receipt). */
  repositoryId: string
  /** Exact commit to materialize. */
  commit: string
  /** Remote URL to clone/fetch from (source server, mirror, or common remote). */
  remoteUrl?: string
  /** Path to a git bundle file when hosts cannot reach a common remote. */
  bundlePath?: string
}

export interface MaterializationReceipt {
  receiptId: string
  sourceServerId: string
  destinationServerId: string
  repositoryId: string
  commit: string
  tree: string
  absolutePath: string
  dirty: boolean
  via: 'clone' | 'bundle'
  createdAt: number
}

/** Clone/fetch the exact commit into a server-owned location and verify the tree. */
export async function materializeRevision(
  registry: RepositoryRegistry,
  sourceServerId: string,
  options: MaterializeOptions,
): Promise<MaterializationReceipt> {
  const { destinationDir, repositoryId, commit, remoteUrl, bundlePath } = options
  if (!commit) throw new Error('commit is required to materialize a revision')
  if (!remoteUrl && !bundlePath) throw new Error('remoteUrl or bundlePath is required to materialize a revision')

  // Server-owned location: <destinationDir>/materialized/<repositoryId>/<commit>
  const workRoot = join(resolve(destinationDir), 'materialized', repositoryId)
  mkdirSync(workRoot, { recursive: true })
  const checkoutDir = join(workRoot, commit)

  if (!existsSync(join(checkoutDir, '.git'))) {
    mkdirSync(dirname(checkoutDir), { recursive: true })
    if (bundlePath) {
      // Bundle materialization: clone from the bundle, then fetch the commit.
      await execGit(['clone', '--no-checkout', bundlePath, checkoutDir], dirname(checkoutDir))
    } else if (remoteUrl) {
      await execGit(['clone', '--no-checkout', remoteUrl, checkoutDir], dirname(checkoutDir))
    }
    await execGit(['fetch', '--all'], checkoutDir).catch(() => undefined)
  }

  await execGit(['checkout', '--detach', commit], checkoutDir)
  const facts = await readGitRepoFacts(checkoutDir)
  if (!facts.tree) throw new Error(`Failed to resolve tree for commit ${commit}`)

  const checkout = await registry.identify(checkoutDir)
  const receipt: MaterializationReceipt = {
    receiptId: hashIdentity([repositoryId, commit, checkoutDir, String(Date.now())]),
    sourceServerId,
    destinationServerId: registry.listCheckouts().find(c => c.checkoutId === checkout.checkoutId)?.serverId ?? '',
    repositoryId,
    commit,
    tree: facts.tree,
    absolutePath: checkoutDir,
    dirty: facts.dirty,
    via: bundlePath ? 'bundle' : 'clone',
    createdAt: Date.now(),
  }
  return receipt
}

export interface BundleRequest {
  /** Checkout to bundle from. */
  sourcePath: string
  /** Commit range to include (e.g. `main`, `HEAD`, or a commit range). */
  revision: string
  /** Destination bundle file path. */
  bundlePath: string
}

/** Create a git bundle carrying the exact objects for `revision`. */
export async function createGitBundle(request: BundleRequest): Promise<string> {
  const { sourcePath, revision, bundlePath } = request
  mkdirSync(dirname(resolve(bundlePath)), { recursive: true })
  await execGit(['bundle', 'create', bundlePath, revision], sourcePath)
  return bundlePath
}

export interface PatchManifest {
  manifestId: string
  sourceCheckoutId: string
  repositoryId: string
  commit: string
  tree: string
  /** `git diff` output for tracked changes (empty when clean). */
  trackedDiff: string
  /** Untracked file paths (never content-copied silently). */
  untrackedFiles: string[]
  createdAt: number
}

/** Capture uncommitted work as an explicit manifest. Never copies `.git` or the working tree. */
export async function createPatchManifest(
  registry: RepositoryRegistry,
  checkout: CheckoutIdentity,
): Promise<PatchManifest> {
  const facts = await readGitRepoFacts(checkout.absolutePath)
  const trackedDiff = facts.dirty
    ? await execGit(['diff', '--no-ext-diff', '--binary'], checkout.absolutePath).catch(() => '')
    : ''
  const statusOut = await execGit(['status', '--porcelain', '-uall'], checkout.absolutePath).catch(() => '')
  const untrackedFiles = statusOut
    .split('\n')
    .filter(line => line.startsWith('?? '))
    .map(line => line.slice(3))
  return {
    manifestId: hashIdentity([checkout.checkoutId, String(Date.now())]),
    sourceCheckoutId: checkout.checkoutId,
    repositoryId: checkout.repositoryId,
    commit: checkout.commit,
    tree: checkout.tree,
    trackedDiff,
    untrackedFiles,
    createdAt: Date.now(),
  }
}

export interface ConflictPreview {
  path: string
  hasConflicts: boolean
  wouldApplyCleanly: boolean
  details: string[]
}

/** Dry-run `git apply --check` on a destination checkout; never mutates. */
export async function previewPatchApply(destinationPath: string, patch: string): Promise<ConflictPreview> {
  const result = await new Promise<{ ok: boolean; stderr: string }>((resolvePromise) => {
    const child = execFile('git', ['apply', '--check', '-'], { cwd: destinationPath, timeout: 30_000 }, (err, _stdout, stderr) => {
      resolvePromise({ ok: !err, stderr: stderr || (err ? (err as Error).message : '') })
    })
    child.stdin?.end(patch)
  }).catch(() => ({ ok: false, stderr: 'git apply failed' }))
  return {
    path: destinationPath,
    hasConflicts: !result.ok,
    wouldApplyCleanly: result.ok,
    details: result.ok ? [] : [result.stderr.slice(0, 500)],
  }
}

export function listMaterialized(workRoot: string): string[] {
  if (!existsSync(workRoot)) return []
  return readdirSync(workRoot).filter((entry): entry is string => typeof entry === 'string' && existsSync(join(workRoot, entry, '.git')))
}

export function materializedRoot(destinationDir: string): string {
  return join(resolve(destinationDir), 'materialized')
}
