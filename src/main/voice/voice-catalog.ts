// Voice catalog - fetching and downloading from Hugging Face

import * as path from 'path'

import { piperVoicesDir, VOICES_CATALOG_URL, HF_BASE_URL } from './paths.js'
import { downloadFile, fetchJson, ensureDir } from './download.js'
import type { VoiceCatalogEntry, ProgressCallback } from './types.js'

const CATALOG_CACHE_DURATION = 1000 * 60 * 10 // 10 minutes

let voicesCatalogCache: Record<string, VoiceCatalogEntry> | null = null
let catalogCacheTime = 0

export async function fetchVoicesCatalog(forceRefresh: boolean = false): Promise<VoiceCatalogEntry[]> {
  try {
    // Use cache if fresh (unless force refresh requested)
    const now = Date.now()
    if (!forceRefresh && voicesCatalogCache && (now - catalogCacheTime) < CATALOG_CACHE_DURATION) {
      return Object.values(voicesCatalogCache)
    }

    // Fetch from Hugging Face
    const catalog = await fetchJson<Record<string, VoiceCatalogEntry>>(VOICES_CATALOG_URL)
    voicesCatalogCache = catalog
    catalogCacheTime = now

    return Object.values(catalog)
  } catch (e: any) {
    console.error('Failed to fetch voice catalog:', e)
    // Return cached data if available, even if stale
    if (voicesCatalogCache) {
      return Object.values(voicesCatalogCache)
    }
    throw e
  }
}

export async function downloadVoiceFromCatalog(
  voiceKey: string,
  onProgress?: ProgressCallback
): Promise<{ success: boolean; error?: string }> {
  try {
    // Fetch catalog if not cached
    if (!voicesCatalogCache) {
      await fetchVoicesCatalog()
    }

    const voiceEntry = voicesCatalogCache?.[voiceKey]
    if (!voiceEntry) {
      return { success: false, error: `Voice "${voiceKey}" not found in catalog` }
    }

    ensureDir(piperVoicesDir)

    // Find .onnx and .onnx.json files
    const files = Object.entries(voiceEntry.files)
    const onnxFile = files.find(([p]) => p.endsWith('.onnx') && !p.endsWith('.onnx.json'))
    const configFile = files.find(([p]) => p.endsWith('.onnx.json'))

    if (!onnxFile || !configFile) {
      return { success: false, error: 'Voice files not found in catalog entry' }
    }

    const [onnxPath, onnxMeta] = onnxFile
    const [configPath] = configFile

    // Construct file names and URLs
    const onnxFileName = path.basename(onnxPath)
    const configFileName = path.basename(configPath)
    const onnxUrl = `${HF_BASE_URL}/${onnxPath}`
    const configUrl = `${HF_BASE_URL}/${configPath}`

    const localOnnxPath = path.join(piperVoicesDir, onnxFileName)
    const localConfigPath = path.join(piperVoicesDir, configFileName)

    // Download model file (larger, show progress)
    const sizeMB = Math.round(onnxMeta.size_bytes / (1024 * 1024))
    onProgress?.(`Downloading ${voiceEntry.name} (${sizeMB}MB)...`, 0)

    await downloadFile(onnxUrl, localOnnxPath, (percent) => {
      onProgress?.('Downloading voice model...', Math.round(percent * 0.9))
    })

    // Download config file
    onProgress?.('Downloading config...', 95)
    await downloadFile(configUrl, localConfigPath)

    onProgress?.('Voice installed successfully', 100)
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}
