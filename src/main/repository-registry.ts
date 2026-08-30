import { execFile } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { createHash } from 'crypto'

/**
 * Checkpoint 10 — repository identity and exact source materialization.
 *
 * Repository identity is derived from normalized verified Git remotes plus
 * object identity (commit/tree hashes). A directory/project display name alone
 * is never used as identity — two checkouts of the same repository on
 * different servers (possibly at different native paths) must resolve to the
 * same repositoryId so agents can prove they build the same source bytes.
 */

export interface RepositoryIdentity {
  repositoryId: string
  /** Sorted, de-duplicated, credential-stripped canonical remote URLs. */
  normalizedRemotes: string[]
}

export interface CheckoutIdentity {
  checkoutId: string
  repositoryId: string
  serverId: string
  /** Host-native absolute path of the checkout. */
  absolutePath: string
  /** Full commit hash (or the disambiguated identity when not a git repo). */
  commit: string
  /** Commit tree hash (same bytes across hosts regardless of native path). */
  tree: string
  branch?: string
  /** True when the working tree differs from the committed tree. */
  dirty: boolean
}

export interface RepositoryRegistryData {
  repositories: Record<string, RepositoryIdentity>
  checkouts: Record<string, CheckoutIdentity>
}

/** Strip credentials, normalize protocol/host casing, drop trailing junk. */
export function normalizeGitRemote(raw: string): string {
  let url = raw.trim()
  if (!url) return url
  // Strip trailing whitespace and comments git may append after the URL.
  url = url.split(/\s+/)[0] ?? url
  // Remove userinfo (https://user:pass@host → https://host).
  url = url.replace(/^([a-z][a-z0-9+.-]*:\/\/)([^/@]+)@/, '$1')
  // ssh://[user@]host/path → host:path (scp-like), merging git@host:path form.
  url = url.replace(/^ssh:\/\/([^/@]+@)?([^/]+)\/(.+)$/, '$2:$3')
  url = url.replace(/^git@([^:]+):/, '$1:') // git@host:path → host:path
  // Normalize protocol: https, http, git → canonical form (host:path).
  const scpLike = /^([^/]+):(.+)$/.exec(url)
  if (scpLike && !url.includes('://')) {
    url = `${scpLike[1]}:${scpLike[2]}`
  }
  url = url.replace(/\/+$/, '')
  url = url.replace(/\.git$/, '')
  return url.toLowerCase()
}

export function hashIdentity(parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex')
}

export function deriveRepositoryId(normalizedRemotes: string[]): string {
  const sorted = [...new Set(normalizedRemotes.filter(Boolean))].sort()
  const seed = sorted.length > 0 ? sorted.join('\n') : 'unknown-remote'
  return hashIdentity([seed])
}

export interface GitRepoFacts {
  remotes: string[]
  commit: string | null
  tree: string | null
  branch: string | null
  dirty: boolean
}

export function execGit(args: string[], cwd: string, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile('git', args, { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(new Error(`git ${args[0]} failed in ${cwd}: ${(err as Error).message}`))
      else resolvePromise(stdout)
    })
  })
}

export async function readGitRepoFacts(absolutePath: string): Promise<GitRepoFacts> {
  const root = await gitRoot(absolutePath).catch(() => null)
  if (!root) return { remotes: [], commit: null, tree: null, branch: null, dirty: false }

  const [remoteOut, headOut, treeOut, branchOut, statusOut] = await Promise.all([
    execGit(['remote', '-v'], root).catch(() => ''),
    execGit(['rev-parse', 'HEAD'], root).catch(() => ''),
    execGit(['rev-parse', 'HEAD^{tree}'], root).catch(() => ''),
    execGit(['rev-parse', '--abbrev-ref', 'HEAD'], root).catch(() => ''),
    execGit(['status', '--porcelain'], root).catch(() => ''),
  ])
  const remotes = [...new Set(
    remoteOut.split('\n')
      .map(line => line.split(/\s+/)[1] ?? '') // `origin\t<url> (fetch)` → url
      .filter(Boolean)
      .map(normalizeGitRemote),
  )].filter(Boolean)
  return {
    remotes,
    commit: headOut.trim() || null,
    tree: treeOut.trim() || null,
    branch: branchOut.trim() && branchOut.trim() !== 'HEAD' ? branchOut.trim() : null,
    dirty: statusOut.trim().length > 0,
  }
}

async function gitRoot(absolutePath: string): Promise<string> {
  const out = await execGit(['rev-parse', '--show-toplevel'], absolutePath)
  return resolve(out.trim())
}

export class RepositoryRegistry {
  private data: RepositoryRegistryData = { repositories: {}, checkouts: {} }
  private readonly file: string

  constructor(dataDir: string, private readonly serverId: string) {
    this.file = join(dataDir, 'repository-registry.json')
    if (existsSync(this.file)) {
      try {
        this.data = JSON.parse(readFileSync(this.file, 'utf8')) as RepositoryRegistryData
      } catch {
        this.data = { repositories: {}, checkouts: {} }
      }
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 })
  }

  /** Identify a checkout on THIS server, registering the repository identity. */
  async identify(absolutePath: string): Promise<CheckoutIdentity> {
    const resolved = resolve(absolutePath)
    if (!existsSync(resolved)) throw new Error(`Path does not exist: ${resolved}`)
    const facts = await readGitRepoFacts(resolved)

    let repositoryId: string
    let normalizedRemotes: string[]
    let commit = facts.commit
    let tree = facts.tree
    if (facts.commit && facts.tree) {
      normalizedRemotes = facts.remotes
      repositoryId = deriveRepositoryId(normalizedRemotes)
      // Disambiguator: two unrelated local repos with no remotes must not
      // collide — include the path-derived hash only when there is no remote.
      if (normalizedRemotes.length === 0) {
        repositoryId = hashIdentity([repositoryId, hashIdentity([resolved])])
      }
    } else {
      // Not a git checkout: identity falls back to path (explicitly never the
      // display name alone), with a null tree so cross-host proof is impossible
      // by design.
      normalizedRemotes = []
      repositoryId = hashIdentity(['non-git', hashIdentity([resolved])])
      commit = hashIdentity([resolved])
      tree = ''
    }

    const existing = this.data.repositories[repositoryId]
    if (existing) {
      normalizedRemotes = existing.normalizedRemotes
    } else {
      this.data.repositories[repositoryId] = { repositoryId, normalizedRemotes }
    }

    const checkoutId = hashIdentity([repositoryId, this.serverId, resolved])
    this.data.checkouts[checkoutId] = {
      checkoutId,
      repositoryId,
      serverId: this.serverId,
      absolutePath: resolved,
      commit: commit ?? '',
      tree: tree ?? '',
      branch: facts.branch ?? undefined,
      dirty: facts.dirty,
    }
    this.persist()
    return this.data.checkouts[checkoutId]
  }

  getRepository(repositoryId: string): RepositoryIdentity | undefined {
    return this.data.repositories[repositoryId]
  }

  getCheckout(checkoutId: string): CheckoutIdentity | undefined {
    return this.data.checkouts[checkoutId]
  }

  listCheckouts(serverId?: string): CheckoutIdentity[] {
    return Object.values(this.data.checkouts)
      .filter(checkout => !serverId || checkout.serverId === serverId)
      .sort((a, b) => a.absolutePath.localeCompare(b.absolutePath))
  }

  listRepositories(): RepositoryIdentity[] {
    return Object.values(this.data.repositories).sort((a, b) => a.repositoryId.localeCompare(b.repositoryId))
  }
}
