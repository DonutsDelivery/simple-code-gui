import { useEffect, useRef } from 'react'
import type { Terminal as XTerm } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import { getLastTerminalTheme } from '../../../themes.js'
import { setupXtermErrorHandler } from '../utils.js'
import type { UseTerminalSetupOptions, UseTerminalSetupReturn, PtyOperations } from './types.js'
import {
  initTerminal,
  handlePtyData,
  handlePtyExit,
  createInitState,
  cleanupTerminal,
} from './terminalInit.js'
import { createThemeUpdateHandler } from './eventHandlers.js'

// Setup error handler on module load
setupXtermErrorHandler()

/**
 * Creates PTY operations from the provided API or window.electronAPI.
 */
function createPtyOperations(api: UseTerminalSetupOptions['api']): PtyOperations {
  return {
    writePty: (id: string, data: string) => {
      if (api) {
        api.writePty(id, data)
      } else {
        window.electronAPI?.writePty(id, data)
      }
    },
    resizePty: (id: string, cols: number, rows: number) => {
      if (api) {
        api.resizePty(id, cols, rows)
      } else {
        window.electronAPI?.resizePty(id, cols, rows)
      }
    },
    onPtyData: (id: string, callback: (data: string) => void) => {
      if (api) {
        return api.onPtyData(id, callback)
      } else {
        return window.electronAPI?.onPtyData(id, callback)
      }
    },
    onPtyExit: (id: string, callback: (code: number) => void) => {
      if (api) {
        return api.onPtyExit(id, callback)
      } else {
        return window.electronAPI?.onPtyExit(id, callback)
      }
    },
  }
}

/**
 * Hook for setting up and managing the xterm.js terminal instance.
 * Handles terminal creation, PTY communication, WebGL addon, and event handlers.
 */
export function useTerminalSetup(options: UseTerminalSetupOptions): UseTerminalSetupReturn {
  const {
    ptyId,
    theme,
    api,
    onTTSChunk,
    onSummaryChunk,
    onAutoWorkMarker,
    resetTTSState,
  } = options

  const containerRef = useRef<HTMLDivElement>(null!)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const userScrolledUpRef = useRef(false)
  const currentLineInputRef = useRef<string>('')
  const inputSuppressedRef = useRef<boolean>(false)

  const ptyOperations = createPtyOperations(api)

  // Main terminal setup effect
  useEffect(() => {
    if (!containerRef.current) return

    const state = createInitState()
    let initCheckInterval: ReturnType<typeof setInterval> | null = null
    let cleanupData: (() => void) | undefined
    let cleanupExit: (() => void) | undefined

    // Reset TTS state for this terminal session
    resetTTSState()

    // Try to initialize terminal
    const tryInit = (): boolean => {
      return initTerminal(
        containerRef,
        terminalRef,
        fitAddonRef,
        userScrolledUpRef,
        currentLineInputRef,
        inputSuppressedRef,
        theme,
        ptyOperations,
        ptyId,
        options,
        state
      )
    }

    // PTY output handling
    cleanupData = ptyOperations.onPtyData(ptyId, (data) => {
      handlePtyData(
        data,
        state.terminal,
        state.fitAddon,
        containerRef,
        userScrolledUpRef,
        ptyOperations,
        ptyId,
        onTTSChunk,
        onSummaryChunk,
        onAutoWorkMarker,
        state
      )
    })

    // PTY exit handling
    cleanupExit = ptyOperations.onPtyExit(ptyId, (code) => {
      handlePtyExit(code, state.terminal, ptyId, state)
    })

    // Try to initialize terminal immediately, or poll until ready
    if (!tryInit()) {
      initCheckInterval = setInterval(() => {
        if (tryInit()) {
          clearInterval(initCheckInterval!)
          initCheckInterval = null
        }
      }, 50)
    }

    // Listen for theme customization updates
    let handleThemeUpdate: ((event: Event) => void) | null = null
    const setupThemeListener = () => {
      if (state.terminal) {
        handleThemeUpdate = createThemeUpdateHandler(
          state.terminal,
          containerRef,
          state.webglAddonRef
        )
        window.addEventListener('terminal-theme-update', handleThemeUpdate)
      } else {
        // Terminal not ready yet, check again soon
        setTimeout(setupThemeListener, 100)
      }
    }
    setupThemeListener()

    // Cleanup
    return () => {
      if (handleThemeUpdate) {
        window.removeEventListener('terminal-theme-update', handleThemeUpdate)
      }
      cleanupTerminal(containerRef, state, initCheckInterval, null, cleanupData, cleanupExit)
    }
  }, [ptyId])

  // Sync terminal theme when theme prop changes
  useEffect(() => {
    const cachedTheme = getLastTerminalTheme()
    console.log('[Terminal] useEffect[theme] fired, terminal:', !!terminalRef.current, 'cached:', !!cachedTheme, 'bg:', cachedTheme?.background)
    if (terminalRef.current && cachedTheme) {
      terminalRef.current.options.theme = cachedTheme
      // Force viewport background + repaint (WebGL addon workaround)
      const viewport = containerRef.current?.querySelector('.xterm-viewport') as HTMLElement
      if (viewport && cachedTheme.background) {
        viewport.style.backgroundColor = cachedTheme.background
      }
      terminalRef.current.refresh(0, terminalRef.current.rows - 1)
    }
  }, [theme])

  return {
    containerRef,
    terminalRef,
    fitAddonRef,
    userScrolledUpRef,
    currentLineInputRef,
    inputSuppressedRef,
  }
}
