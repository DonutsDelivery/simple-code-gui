import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface Project {
  path: string
  name: string
}

export interface OpenTab {
  id: string
  projectPath: string
  sessionId?: string
  title: string
}

export interface Workspace {
  projects: Project[]
  openTabs: OpenTab[]
  activeTabId: string | null
}

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

interface StoredData {
  workspace: Workspace
  windowBounds?: WindowBounds
}

export class SessionStore {
  private configPath: string
  private data: StoredData

  constructor() {
    const configDir = join(app.getPath('userData'), 'config')
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true })
    }
    this.configPath = join(configDir, 'workspace.json')
    this.data = this.load()
  }

  private load(): StoredData {
    try {
      if (existsSync(this.configPath)) {
        const content = readFileSync(this.configPath, 'utf-8')
        return JSON.parse(content)
      }
    } catch (e) {
      console.error('Failed to load workspace:', e)
    }
    return {
      workspace: {
        projects: [],
        openTabs: [],
        activeTabId: null
      }
    }
  }

  private save(): void {
    try {
      writeFileSync(this.configPath, JSON.stringify(this.data, null, 2))
    } catch (e) {
      console.error('Failed to save workspace:', e)
    }
  }

  getWorkspace(): Workspace {
    return this.data.workspace
  }

  saveWorkspace(workspace: Workspace): void {
    this.data.workspace = workspace
    this.save()
  }

  getWindowBounds(): WindowBounds | undefined {
    return this.data.windowBounds
  }

  saveWindowBounds(bounds: WindowBounds): void {
    this.data.windowBounds = bounds
    this.save()
  }
}
