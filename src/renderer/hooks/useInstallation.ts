import { useState, useCallback, useEffect } from 'react'

type InstallingType = 'node' | 'git' | 'claude' | null

interface UseInstallationReturn {
  claudeInstalled: boolean | null
  npmInstalled: boolean | null
  gitBashInstalled: boolean | null
  installing: InstallingType
  installError: string | null
  installMessage: string | null
  checkInstallation: () => Promise<void>
  handleInstallNode: () => Promise<void>
  handleInstallGit: () => Promise<void>
  handleInstallClaude: () => Promise<void>
}

export function useInstallation(): UseInstallationReturn {
  const [claudeInstalled, setClaudeInstalled] = useState<boolean | null>(null)
  const [npmInstalled, setNpmInstalled] = useState<boolean | null>(null)
  const [gitBashInstalled, setGitBashInstalled] = useState<boolean | null>(null)
  const [installing, setInstalling] = useState<InstallingType>(null)
  const [installError, setInstallError] = useState<string | null>(null)
  const [installMessage, setInstallMessage] = useState<string | null>(null)

  const checkInstallation = useCallback(async () => {
    const claudeStatus = await window.electronAPI?.claudeCheck?.()
    // In browser/HTTP mode, assume everything is installed (server handles this)
    setClaudeInstalled(claudeStatus?.installed ?? true)
    setNpmInstalled(claudeStatus?.npmInstalled ?? true)
    setGitBashInstalled(claudeStatus?.gitBashInstalled ?? true)
  }, [])

  const handleInstallNode = useCallback(async () => {
    setInstalling('node')
    setInstallError(null)
    setInstallMessage(null)
    try {
      const result = await window.electronAPI?.nodeInstall()
      if (result.success) {
        if (result.method === 'download') {
          setInstallMessage(result.message || 'Please complete the Node.js installation and restart Simple Code GUI.')
        } else {
          setNpmInstalled(true)
          setInstallMessage('Node.js installed! Click "Install Claude Code" to continue.')
        }
      } else {
        setInstallError(result.error || 'Installation failed')
      }
    } catch (e) {
      setInstallError(String(e))
    }
    setInstalling(null)
  }, [])

  const handleInstallClaude = useCallback(async () => {
    setInstalling('claude')
    setInstallError(null)
    setInstallMessage(null)
    try {
      const result = await window.electronAPI?.claudeInstall()
      if (result.success) {
        setClaudeInstalled(true)
      } else if (result.needsNode) {
        setInstallError('Node.js is required. Click "Install Node.js" first.')
      } else {
        setInstallError(result.error || 'Installation failed')
      }
    } catch (e) {
      setInstallError(String(e))
    }
    setInstalling(null)
  }, [])

  const handleInstallGit = useCallback(async () => {
    setInstalling('git')
    setInstallError(null)
    setInstallMessage(null)
    try {
      const result = await window.electronAPI?.gitInstall()
      if (result.success) {
        setGitBashInstalled(true)
        setInstallMessage(result.message || 'Git installed! Please restart Simple Code GUI.')
      } else if (result.method === 'download') {
        setInstallMessage(result.message || 'Please download and install Git, then restart Simple Code GUI.')
      } else {
        setInstallError(result.error || 'Installation failed')
      }
    } catch (e) {
      setInstallError(String(e))
    }
    setInstalling(null)
  }, [])

  return {
    claudeInstalled,
    npmInstalled,
    gitBashInstalled,
    installing,
    installError,
    installMessage,
    checkInstallation,
    handleInstallNode,
    handleInstallGit,
    handleInstallClaude
  }
}
