import { describe, expect, it, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ArtifactPanel } from './ArtifactPanel'
import type { Api } from '../../api'
import type { ArtifactManifest } from '../../../common/artifacts'

beforeAll(() => {
  // jsdom does not implement blob navigation; stub the anchor click + blob URL.
  URL.createObjectURL = vi.fn(() => 'blob:fake')
  HTMLAnchorElement.prototype.click = vi.fn()
})

const manifest: ArtifactManifest = {
  artifactId: 'abc123',
  sha256: 'abc123',
  size: 2048,
  filename: 'build.zip',
  mediaType: 'application/zip',
  producerServerId: 'server-a',
  repositoryId: 'repo-1',
  commit: 'c0ffee',
  tree: 't0tree',
  platform: 'linux',
  architecture: 'x64',
  kind: 'package',
  createdAt: 1_700_000_000_000,
}

function makeApi(overrides: Partial<Api> = {}): Api {
  return {
    getWorkspace: vi.fn(),
    saveWorkspace: vi.fn(),
    discoverSessions: vi.fn(),
    listPtys: vi.fn(),
    spawnPty: vi.fn(),
    listArtifacts: vi.fn(async () => [manifest]),
    downloadArtifact: vi.fn(async () => ({ filePath: 'blob:fake', sha256: 'abc123' })),
    expireArtifact: vi.fn(async () => ({ removed: true })),
    ...overrides,
  } as unknown as Api
}

describe('ArtifactPanel', () => {
  it('renders artifact metadata with source provenance', async () => {
    render(<ArtifactPanel api={makeApi()} />)
    await waitFor(() => expect(screen.getByText('build.zip')).toBeTruthy())
    expect(screen.getAllByText(/Package/).length).toBeGreaterThan(0)
    expect(screen.getByText(/2\.0 KB/)).toBeTruthy()
    expect(screen.getByText(/linux\/x64/)).toBeTruthy()
    expect(screen.getByText(/repo-1/)).toBeTruthy()
    expect(screen.getByText(/c0ffee/)).toBeTruthy()
  })

  it('expires an artifact through the api and removes it from the list', async () => {
    const expireArtifact = vi.fn(async () => ({ removed: true }))
    render(<ArtifactPanel api={makeApi({ expireArtifact })} />)
    await waitFor(() => expect(screen.getByText('build.zip')).toBeTruthy())
    fireEvent.click(screen.getByText('Expire'))
    await waitFor(() => expect(expireArtifact).toHaveBeenCalledWith('abc123'))
    await waitFor(() => expect(screen.getByText(/No artifacts/)).toBeTruthy())
  })

  it('downloads an artifact and never auto-runs it (blob URL only)', async () => {
    const downloadArtifact = vi.fn(async () => ({ filePath: 'blob:fake', sha256: 'abc123' }))
    render(<ArtifactPanel api={makeApi({ downloadArtifact })} />)
    await waitFor(() => expect(screen.getByText('build.zip')).toBeTruthy())
    fireEvent.click(screen.getByText('Download'))
    await waitFor(() => expect(downloadArtifact).toHaveBeenCalledWith('abc123'))
    expect(screen.getByText(/Downloaded build\.zip/)).toBeTruthy()
  })

  it('shows an error when the connection has no artifact store', async () => {
    const api = makeApi()
    delete (api as { listArtifacts?: unknown }).listArtifacts
    render(<ArtifactPanel api={api} />)
    await waitFor(() => expect(screen.getByText(/does not expose an artifact store/)).toBeTruthy())
  })
})
