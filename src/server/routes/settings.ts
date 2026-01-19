/**
 * Settings Routes
 *
 * HTTP endpoints for application settings, voice configuration, and CLI status.
 */

import { Router, Request, Response } from 'express'
import {
  ApiResponse,
  Settings,
  VoiceSettings
} from '../types'
import { getServices } from '../app'

const router = Router()

// =============================================================================
// Helper Functions
// =============================================================================

function sendResponse<T>(res: Response, statusCode: number, data: ApiResponse<T>): void {
  res.status(statusCode).json(data)
}

function sendError(res: Response, statusCode: number, error: string): void {
  sendResponse(res, statusCode, {
    success: false,
    error,
    timestamp: Date.now()
  })
}

// =============================================================================
// Application Settings Routes
// =============================================================================

/**
 * GET /api/settings
 * Get application settings
 *
 * Returns: Settings
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const services = getServices()

    if (!services.getSettings) {
      return sendError(res, 503, 'Settings service not available')
    }

    const settings: Settings = await services.getSettings()

    sendResponse<Settings>(res, 200, {
      success: true,
      data: settings,
      timestamp: Date.now()
    })
  } catch (error: any) {
    console.error('[Settings Route] Get error:', error)
    sendError(res, 500, error.message || 'Failed to get settings')
  }
})

/**
 * PUT /api/settings
 * Save application settings
 *
 * Body: Settings
 */
router.put('/', async (req: Request, res: Response) => {
  try {
    const services = getServices()

    if (!services.saveSettings) {
      return sendError(res, 503, 'Settings service not available')
    }

    const settings: Settings = req.body

    // Basic validation
    if (!settings || typeof settings !== 'object') {
      return sendError(res, 400, 'Invalid settings data')
    }

    await services.saveSettings(settings)

    sendResponse(res, 200, {
      success: true,
      timestamp: Date.now()
    })
  } catch (error: any) {
    console.error('[Settings Route] Save error:', error)
    sendError(res, 500, error.message || 'Failed to save settings')
  }
})

/**
 * PATCH /api/settings
 * Partially update application settings
 *
 * Body: Partial<Settings>
 */
router.patch('/', async (req: Request, res: Response) => {
  try {
    const services = getServices()

    if (!services.getSettings || !services.saveSettings) {
      return sendError(res, 503, 'Settings service not available')
    }

    const updates: Partial<Settings> = req.body

    // Get current settings and merge
    const currentSettings = await services.getSettings()
    const newSettings = { ...currentSettings, ...updates }

    await services.saveSettings(newSettings)

    sendResponse<Settings>(res, 200, {
      success: true,
      data: newSettings,
      timestamp: Date.now()
    })
  } catch (error: any) {
    sendError(res, 500, error.message || 'Failed to update settings')
  }
})

// =============================================================================
// Voice Settings Routes
// =============================================================================

/**
 * GET /api/settings/voice
 * Get voice settings
 *
 * Returns: VoiceSettings
 */
router.get('/voice', async (_req: Request, res: Response) => {
  try {
    const services = getServices()

    if (!services.voiceGetSettings) {
      return sendError(res, 503, 'Voice service not available')
    }

    const settings: VoiceSettings = await services.voiceGetSettings()

    sendResponse<VoiceSettings>(res, 200, {
      success: true,
      data: settings,
      timestamp: Date.now()
    })
  } catch (error: any) {
    sendError(res, 500, error.message || 'Failed to get voice settings')
  }
})

/**
 * POST /api/settings/voice/speak
 * Speak text using TTS
 *
 * Body: { text: string }
 */
router.post('/voice/speak', async (req: Request, res: Response) => {
  try {
    const services = getServices()

    if (!services.voiceSpeak) {
      return sendError(res, 503, 'Voice service not available')
    }

    const { text } = req.body

    if (!text || typeof text !== 'string') {
      return sendError(res, 400, 'text is required and must be a string')
    }

    // Limit text length to prevent abuse
    if (text.length > 5000) {
      return sendError(res, 400, 'text must be 5000 characters or less')
    }

    const result = await services.voiceSpeak(text)

    sendResponse(res, result.success ? 200 : 500, {
      success: result.success,
      data: result.audioData ? { audioData: result.audioData } : undefined,
      error: result.error,
      timestamp: Date.now()
    })
  } catch (error: any) {
    sendError(res, 500, error.message || 'Failed to speak text')
  }
})

/**
 * POST /api/settings/voice/stop
 * Stop TTS playback
 */
router.post('/voice/stop', async (_req: Request, res: Response) => {
  try {
    const services = getServices()

    if (!services.voiceStopSpeaking) {
      return sendError(res, 503, 'Voice service not available')
    }

    const result = await services.voiceStopSpeaking()

    sendResponse(res, result.success ? 200 : 500, {
      success: result.success,
      timestamp: Date.now()
    })
  } catch (error: any) {
    sendError(res, 500, error.message || 'Failed to stop speaking')
  }
})

// =============================================================================
// CLI Status Routes
// =============================================================================

/**
 * GET /api/settings/cli/status
 * Get installation status of all CLI tools
 *
 * Returns: { claude, gemini, codex, opencode, aider }
 */
router.get('/cli/status', async (_req: Request, res: Response) => {
  try {
    const services = getServices()

    const status: Record<string, any> = {}

    // Check each CLI tool in parallel
    const checks = await Promise.allSettled([
      services.claudeCheck?.() ?? Promise.resolve({ installed: false }),
      services.geminiCheck?.() ?? Promise.resolve({ installed: false }),
      services.codexCheck?.() ?? Promise.resolve({ installed: false }),
      services.opencodeCheck?.() ?? Promise.resolve({ installed: false }),
      services.aiderCheck?.() ?? Promise.resolve({ installed: false })
    ])

    const cliNames = ['claude', 'gemini', 'codex', 'opencode', 'aider']

    checks.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        status[cliNames[index]] = result.value
      } else {
        status[cliNames[index]] = { installed: false, error: result.reason?.message }
      }
    })

    sendResponse(res, 200, {
      success: true,
      data: status,
      timestamp: Date.now()
    })
  } catch (error: any) {
    sendError(res, 500, error.message || 'Failed to check CLI status')
  }
})

/**
 * GET /api/settings/cli/:tool
 * Get installation status of a specific CLI tool
 *
 * Params: tool - one of: claude, gemini, codex, opencode, aider
 */
router.get('/cli/:tool', async (req: Request, res: Response) => {
  try {
    const services = getServices()
    const { tool } = req.params

    const checkFunctions: Record<string, (() => Promise<any>) | undefined> = {
      claude: services.claudeCheck,
      gemini: services.geminiCheck,
      codex: services.codexCheck,
      opencode: services.opencodeCheck,
      aider: services.aiderCheck
    }

    const checkFn = checkFunctions[tool]
    if (!checkFn) {
      return sendError(res, 400, `Unknown tool: ${tool}. Valid tools: ${Object.keys(checkFunctions).join(', ')}`)
    }

    const result = await checkFn()

    sendResponse(res, 200, {
      success: true,
      data: result,
      timestamp: Date.now()
    })
  } catch (error: any) {
    sendError(res, 500, error.message || 'Failed to check CLI status')
  }
})

export default router
