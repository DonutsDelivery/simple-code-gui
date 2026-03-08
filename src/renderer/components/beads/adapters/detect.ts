/**
 * Backend Detection
 *
 * Auto-detects which task backend a project uses based on directory contents.
 * Prefers kspec if both are present. Falls back to beads. Returns 'none' if neither.
 */

import type { BackendKind, TaskAdapter } from './types.js'
import { BeadsAdapter } from './beads-adapter.js'
import { KspecAdapter } from './kspec-adapter.js'

// Singleton adapters — stateless enough to reuse
const beadsAdapter = new BeadsAdapter()
const kspecAdapter = new KspecAdapter()

/**
 * Detect which backend is available for a project directory.
 * Checks filesystem via IPC — does not require daemon to be running.
 */
export async function detectBackend(cwd: string): Promise<BackendKind> {
  // Check kspec first (preferred when both exist)
  const kspecStatus = await kspecAdapter.check(cwd)
  if (kspecStatus.initialized) return 'kspec'

  // Check beads
  const beadsStatus = await beadsAdapter.check(cwd)
  if (beadsStatus.installed && beadsStatus.initialized) return 'beads'

  // Neither initialized — check if either is available for init
  if (kspecStatus.installed) return 'none' // could init either
  if (beadsStatus.installed) return 'none'

  return 'none'
}

/**
 * Get the adapter for a given backend kind.
 */
export function getAdapter(kind: BackendKind): TaskAdapter | null {
  switch (kind) {
    case 'beads': return beadsAdapter
    case 'kspec': return kspecAdapter
    default: return null
  }
}

/**
 * Detect backend and return the appropriate adapter.
 * Returns null if no backend is initialized.
 */
export async function getAdapterForProject(cwd: string): Promise<TaskAdapter | null> {
  const kind = await detectBackend(cwd)
  return getAdapter(kind)
}

export { beadsAdapter, kspecAdapter }
