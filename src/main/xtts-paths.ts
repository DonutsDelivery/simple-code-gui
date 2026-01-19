import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { isWindows } from './platform.js'

// Directory structure
export const depsDir = path.join(app.getPath('userData'), 'deps')
export const xttsDir = path.join(depsDir, 'xtts')
export const xttsVoicesDir = path.join(xttsDir, 'voices')
export const xttsVenvDir = path.join(xttsDir, 'venv')
export const xttsPythonDir = path.join(xttsDir, 'python')
export const xttsScriptPath = path.join(xttsDir, 'xtts_helper.py')

// Standalone Python download URL (python-build-standalone)
export const STANDALONE_PYTHON_VERSION = '3.12.12'
export const STANDALONE_PYTHON_TAG = '20251217'
export const STANDALONE_PYTHON_URL = isWindows
  ? `https://github.com/astral-sh/python-build-standalone/releases/download/${STANDALONE_PYTHON_TAG}/cpython-${STANDALONE_PYTHON_VERSION}+${STANDALONE_PYTHON_TAG}-x86_64-pc-windows-msvc-install_only.tar.gz`
  : `https://github.com/astral-sh/python-build-standalone/releases/download/${STANDALONE_PYTHON_TAG}/cpython-${STANDALONE_PYTHON_VERSION}+${STANDALONE_PYTHON_TAG}-x86_64-unknown-linux-gnu-install_only.tar.gz`

// Hugging Face XTTS-v2 sample voices
export const XTTS_HF_BASE = 'https://huggingface.co/coqui/XTTS-v2/resolve/main/samples'

export function getStandalonePython(): string {
  return isWindows
    ? path.join(xttsPythonDir, 'python', 'python.exe')
    : path.join(xttsPythonDir, 'python', 'bin', 'python3')
}

export function getVenvPython(): string {
  return isWindows
    ? path.join(xttsVenvDir, 'Scripts', 'python.exe')
    : path.join(xttsVenvDir, 'bin', 'python')
}

export function getVenvPip(): string {
  return isWindows
    ? path.join(xttsVenvDir, 'Scripts', 'pip.exe')
    : path.join(xttsVenvDir, 'bin', 'pip')
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

// XTTS supported languages
export const XTTS_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'pl', name: 'Polish' },
  { code: 'tr', name: 'Turkish' },
  { code: 'ru', name: 'Russian' },
  { code: 'nl', name: 'Dutch' },
  { code: 'cs', name: 'Czech' },
  { code: 'ar', name: 'Arabic' },
  { code: 'zh-cn', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'ko', name: 'Korean' },
  { code: 'hi', name: 'Hindi' }
] as const

export type XTTSLanguage = typeof XTTS_LANGUAGES[number]['code']

export interface XTTSVoice {
  id: string
  name: string
  language: XTTSLanguage
  referencePath: string
  createdAt: number
}

export interface XTTSStatus {
  installed: boolean
  pythonPath: string | null
  modelDownloaded: boolean
  error?: string
}

export const XTTS_SAMPLE_VOICES = [
  { id: 'xtts-en-sample', name: 'English Sample', language: 'en', file: 'en_sample.wav' },
  { id: 'xtts-de-sample', name: 'German Sample', language: 'de', file: 'de_sample.wav' },
  { id: 'xtts-es-sample', name: 'Spanish Sample', language: 'es', file: 'es_sample.wav' },
  { id: 'xtts-fr-sample', name: 'French Sample', language: 'fr', file: 'fr_sample.wav' },
  { id: 'xtts-ja-sample', name: 'Japanese Sample', language: 'ja', file: 'ja-sample.wav' },
  { id: 'xtts-pt-sample', name: 'Portuguese Sample', language: 'pt', file: 'pt_sample.wav' },
  { id: 'xtts-tr-sample', name: 'Turkish Sample', language: 'tr', file: 'tr_sample.wav' },
  { id: 'xtts-zh-sample', name: 'Chinese Sample', language: 'zh-cn', file: 'zh-cn-sample.wav' }
] as const

// Python helper script content - runs as a persistent server to keep model loaded
export const XTTS_HELPER_SCRIPT = `#!/usr/bin/env python3
"""XTTS-v2 helper script for Claude Terminal - Server Mode"""
import sys
import json
import os

# Global TTS instance to keep model loaded
_tts = None
_device = None

def check_installation():
    """Check if TTS library is installed"""
    try:
        import torch
        from TTS.api import TTS
        return {"installed": True, "torch_version": torch.__version__}
    except ImportError as e:
        return {"installed": False, "error": str(e)}

def get_tts():
    """Get or create TTS instance (loads model once)"""
    global _tts, _device
    if _tts is None:
        import torch
        from TTS.api import TTS

        # Check if user wants to force CPU mode
        force_cpu = os.environ.get("XTTS_FORCE_CPU", "").lower() in ("1", "true", "yes")

        # Try CUDA first, fall back to CPU if OOM or other CUDA errors
        if not force_cpu and torch.cuda.is_available():
            try:
                _device = "cuda"
                _tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(_device)
            except (torch.cuda.OutOfMemoryError, RuntimeError) as e:
                # CUDA failed, fall back to CPU
                if _tts is not None:
                    del _tts
                torch.cuda.empty_cache()
                _device = "cpu"
                _tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(_device)
        else:
            _device = "cpu"
            _tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(_device)
    return _tts, _device

def speak(text, reference_audio, language, output_path, temperature=0.65, speed=1.0, top_k=50, top_p=0.85, repetition_penalty=2.0):
    """Generate speech using XTTS-v2 voice cloning"""
    try:
        tts, device = get_tts()
        # Build kwargs, only including supported parameters
        # Some TTS versions don't support all parameters
        kwargs = {
            "text": text,
            "speaker_wav": reference_audio,
            "language": language,
            "file_path": output_path,
        }
        # Try with all parameters first, fall back to basic call if it fails
        try:
            tts.tts_to_file(
                **kwargs,
                temperature=float(temperature),
                speed=float(speed),
                top_k=int(top_k),
                top_p=float(top_p),
                repetition_penalty=float(repetition_penalty)
            )
        except (TypeError, ValueError) as param_error:
            # Some parameters might not be supported, try without them
            sys.stderr.write(f"Parameter error, trying basic call: {param_error}\\n")
            sys.stderr.flush()
            tts.tts_to_file(**kwargs)
        return {"success": True, "path": output_path, "device": device}
    except Exception as e:
        return {"success": False, "error": str(e)}

def run_server():
    """Run as a server, reading JSON commands from stdin"""
    sys.stdout.write(json.dumps({"status": "ready"}) + "\\n")
    sys.stdout.flush()

    for line in sys.stdin:
        try:
            cmd = json.loads(line.strip())
            action = cmd.get("action")

            if action == "speak":
                result = speak(
                    cmd.get("text", ""),
                    cmd.get("reference_audio", ""),
                    cmd.get("language", "en"),
                    cmd.get("output_path", ""),
                    temperature=cmd.get("temperature", 0.65),
                    speed=cmd.get("speed", 1.0),
                    top_k=cmd.get("top_k", 50),
                    top_p=cmd.get("top_p", 0.85),
                    repetition_penalty=cmd.get("repetition_penalty", 2.0)
                )
            elif action == "check":
                result = check_installation()
            elif action == "ping":
                result = {"status": "alive"}
            elif action == "quit":
                result = {"status": "goodbye"}
                sys.stdout.write(json.dumps(result) + "\\n")
                sys.stdout.flush()
                break
            else:
                result = {"error": f"Unknown action: {action}"}

            sys.stdout.write(json.dumps(result) + "\\n")
            sys.stdout.flush()
        except json.JSONDecodeError as e:
            sys.stdout.write(json.dumps({"error": f"Invalid JSON: {e}"}) + "\\n")
            sys.stdout.flush()
        except Exception as e:
            sys.stdout.write(json.dumps({"error": str(e)}) + "\\n")
            sys.stdout.flush()

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No command specified"}))
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "check":
        result = check_installation()
        print(json.dumps(result))
    elif cmd == "server":
        run_server()
    elif cmd == "speak":
        # Legacy single-shot mode (for backwards compatibility)
        if len(sys.argv) < 6:
            result = {"error": "Usage: speak <text> <reference_audio> <language> <output_path>"}
        else:
            result = speak(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
        print(json.dumps(result))
    else:
        result = {"error": f"Unknown command: {cmd}"}
        print(json.dumps(result))

if __name__ == "__main__":
    main()
`
