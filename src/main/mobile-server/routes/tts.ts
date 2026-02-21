/**
 * TTS Routes - /api/tts/* endpoints
 */

import { Express, Request, Response } from 'express'

export function setupTtsRoutes(
  app: Express,
  getVoiceManager: () => any
): void {
  app.post('/api/tts/speak', async (req: Request, res: Response) => {
    try {
      const { text } = req.body
      if (!text) {
        return res.status(400).json({ error: 'Text is required' })
      }
      const voiceManager = getVoiceManager()
      if (!voiceManager) {
        return res.status(500).json({ error: 'Voice manager not available' })
      }

      const result = await voiceManager.speak(text)
      if (result.success && result.audioData) {
        res.json({
          success: true,
          audioData: result.audioData,
          format: 'wav'
        })
      } else {
        res.status(500).json({ error: result.error || 'TTS failed' })
      }
    } catch (error) {
      res.status(500).json({ error: String(error) })
    }
  })

  // Stream audio directly as binary
  app.post('/api/tts/speak/stream', async (req: Request, res: Response) => {
    try {
      const { text } = req.body
      if (!text) {
        return res.status(400).json({ error: 'Text is required' })
      }
      const voiceManager = getVoiceManager()
      if (!voiceManager) {
        return res.status(500).json({ error: 'Voice manager not available' })
      }

      const result = await voiceManager.speak(text)
      if (result.success && result.audioData) {
        const audioBuffer = Buffer.from(result.audioData, 'base64')
        res.setHeader('Content-Type', 'audio/wav')
        res.setHeader('Content-Length', audioBuffer.length)
        res.send(audioBuffer)
      } else {
        res.status(500).json({ error: result.error || 'TTS failed' })
      }
    } catch (error) {
      res.status(500).json({ error: String(error) })
    }
  })

  app.post('/api/tts/stop', async (_req: Request, res: Response) => {
    try {
      const voiceManager = getVoiceManager()
      if (!voiceManager) {
        return res.status(500).json({ error: 'Voice manager not available' })
      }
      voiceManager.stopSpeaking()
      res.json({ success: true })
    } catch (error) {
      res.status(500).json({ error: String(error) })
    }
  })

  app.get('/api/tts/voices', async (_req: Request, res: Response) => {
    try {
      const voiceManager = getVoiceManager()
      if (!voiceManager) {
        return res.status(500).json({ error: 'Voice manager not available' })
      }
      const installed = voiceManager.getInstalledPiperVoices()
      const settings = voiceManager.getSettings()
      res.json({
        installed,
        currentVoice: settings.ttsVoice,
        currentEngine: settings.ttsEngine
      })
    } catch (error) {
      res.status(500).json({ error: String(error) })
    }
  })

  app.post('/api/tts/settings', async (req: Request, res: Response) => {
    try {
      const { voice, engine, speed } = req.body
      const voiceManager = getVoiceManager()
      if (!voiceManager) {
        return res.status(500).json({ error: 'Voice manager not available' })
      }
      if (voice) voiceManager.setTTSVoice(voice)
      if (engine) voiceManager.setTTSEngine(engine)
      if (speed) voiceManager.setTTSSpeed(speed)
      res.json({ success: true })
    } catch (error) {
      res.status(500).json({ error: String(error) })
    }
  })
}
