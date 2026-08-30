/**
 * Shared artifact manifest types (renderer + main).
 *
 * Mirrors the server-side ArtifactManifest in src/main/artifact-store.ts so the
 * renderer can render artifacts without importing main-process code.
 */

export const ARTIFACT_KINDS = ['source', 'package', 'log', 'screenshot', 'test-report', 'cache'] as const
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]

export interface ArtifactManifest {
  artifactId: string
  sha256: string
  size: number
  filename: string
  mediaType: string
  producerServerId: string
  repositoryId?: string
  commit?: string
  tree?: string
  dirtyPatchId?: string
  platform: string
  architecture: string
  buildCommand?: string
  kind: ArtifactKind
  createdAt: number
  expiresAt?: number
}
