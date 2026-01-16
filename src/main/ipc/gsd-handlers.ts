import { ipcMain } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export interface GSDProgress {
  initialized: boolean
  currentPhase: string | null
  currentPhaseNumber: number | null
  totalPhases: number
  completedPhases: number
  phases: Array<{
    number: number
    title: string
    completed: boolean
  }>
}

function parseRoadmap(roadmapPath: string): Omit<GSDProgress, 'initialized'> {
  const result: Omit<GSDProgress, 'initialized'> = {
    currentPhase: null,
    currentPhaseNumber: null,
    totalPhases: 0,
    completedPhases: 0,
    phases: []
  }

  if (!existsSync(roadmapPath)) {
    return result
  }

  try {
    const content = readFileSync(roadmapPath, 'utf-8')
    const lines = content.split('\n')

    // Parse phase headers: ## Phase N: Title or ## Phase N.N: Title
    // Check for completion markers like [x] or (COMPLETED)
    const phasePattern = /^##\s+Phase\s+([\d.]+):\s*(.+)/i
    const completedPattern = /\[x\]|\(COMPLETED\)|\(DONE\)/i

    for (const line of lines) {
      const match = line.match(phasePattern)
      if (match) {
        const phaseNumStr = match[1]
        const phaseNum = parseFloat(phaseNumStr)
        const title = match[2].trim()
        const completed = completedPattern.test(line)

        result.phases.push({
          number: phaseNum,
          title: title.replace(completedPattern, '').trim(),
          completed
        })

        if (completed) {
          result.completedPhases++
        }
      }
    }

    result.totalPhases = result.phases.length

    // Find current phase (first non-completed)
    const currentPhaseObj = result.phases.find(p => !p.completed)
    if (currentPhaseObj) {
      result.currentPhase = currentPhaseObj.title
      result.currentPhaseNumber = currentPhaseObj.number
    } else if (result.phases.length > 0) {
      // All completed - show last phase
      const lastPhase = result.phases[result.phases.length - 1]
      result.currentPhase = lastPhase.title
      result.currentPhaseNumber = lastPhase.number
    }
  } catch {
    // Silently fail on parse errors
  }

  return result
}

export function registerGsdHandlers() {
  ipcMain.handle('gsd:projectCheck', async (_, cwd: string) => {
    const planningDir = join(cwd, '.planning')
    return { initialized: existsSync(planningDir) }
  })

  ipcMain.handle('gsd:getProgress', async (_, cwd: string) => {
    try {
      const planningDir = join(cwd, '.planning')
      const initialized = existsSync(planningDir)

      if (!initialized) {
        return {
          success: true,
          data: {
            initialized: false,
            currentPhase: null,
            currentPhaseNumber: null,
            totalPhases: 0,
            completedPhases: 0,
            phases: []
          } as GSDProgress
        }
      }

      const roadmapPath = join(planningDir, 'ROADMAP.md')
      const progress = parseRoadmap(roadmapPath)

      return {
        success: true,
        data: {
          initialized: true,
          ...progress
        } as GSDProgress
      }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })
}
