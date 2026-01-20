import React, { useState, useEffect, useCallback } from 'react'

interface Extension {
  id: string
  name: string
  description: string
  type: 'skill' | 'mcp' | 'agent'
  repo?: string
  npm?: string
  commands?: string[]
  tags?: string[]
  configSchema?: Record<string, any>
}

interface InstalledExtension extends Extension {
  installedAt: number
  enabled: boolean
  scope: 'global' | 'project'
  projectPath?: string
  config?: Record<string, any>
}

interface ExtensionBrowserProps {
  projectPath: string
  projectName: string
  onClose: () => void
}

type TabType = 'skills' | 'mcps' | 'agents'

export function ExtensionBrowser({ projectPath, projectName, onClose }: ExtensionBrowserProps) {
  const [activeTab, setActiveTab] = useState<TabType>('skills')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Data
  const [registry, setRegistry] = useState<{
    skills: Extension[]
    mcps: Extension[]
    agents: Extension[]
  }>({ skills: [], mcps: [], agents: [] })
  const [installed, setInstalled] = useState<InstalledExtension[]>([])
  const [customUrl, setCustomUrl] = useState('')
  const [customUrls, setCustomUrls] = useState<string[]>([])

  // Operation states
  const [installing, setInstalling] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [configuring, setConfiguring] = useState<InstalledExtension | null>(null)

  // Load data
  const loadData = useCallback(async (forceRefresh = false) => {
    try {
      setLoading(!forceRefresh)
      setRefreshing(forceRefresh)
      setError(null)

      const [registryData, installedData, urlsData] = await Promise.all([
        window.electronAPI?.extensionsFetchRegistry(forceRefresh),
        window.electronAPI?.extensionsGetInstalled(),
        window.electronAPI?.extensionsGetCustomUrls()
      ])

      setRegistry({
        skills: registryData.skills || [],
        mcps: registryData.mcps || [],
        agents: registryData.agents || []
      })
      setInstalled(installedData || [])
      setCustomUrls(urlsData || [])
    } catch (e: any) {
      setError(e.message || 'Failed to load extensions')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Get extensions for current tab
  const getExtensionsForTab = () => {
    switch (activeTab) {
      case 'skills': return registry.skills
      case 'mcps': return registry.mcps
      case 'agents': return registry.agents
    }
  }

  // Check if extension is installed
  const isInstalled = (extId: string) => {
    return installed.some(e => e.id === extId)
  }

  // Check if extension is enabled for this project
  const isEnabledForProject = (extId: string) => {
    const ext = installed.find(e => e.id === extId)
    if (!ext) return false
    if (ext.scope === 'project' && ext.projectPath === projectPath) return true
    return ext.enabled
  }

  // Install extension
  const handleInstall = async (ext: Extension) => {
    setInstalling(ext.id)
    try {
      let result
      if (ext.type === 'skill' || ext.type === 'agent') {
        result = await window.electronAPI?.extensionsInstallSkill(ext, 'global')
      } else {
        result = await window.electronAPI?.extensionsInstallMcp(ext)
      }

      if (!result.success) {
        setError(result.error || 'Installation failed')
      } else {
        await loadData()
      }
    } catch (e: any) {
      setError(e.message || 'Installation failed')
    } finally {
      setInstalling(null)
    }
  }

  // Remove extension
  const handleRemove = async (extId: string) => {
    setRemoving(extId)
    try {
      const result = await window.electronAPI?.extensionsRemove(extId)
      if (!result.success) {
        setError(result.error || 'Removal failed')
      } else {
        await loadData()
      }
    } catch (e: any) {
      setError(e.message || 'Removal failed')
    } finally {
      setRemoving(null)
    }
  }

  // Toggle extension for project
  const handleToggle = async (extId: string, enabled: boolean) => {
    try {
      if (enabled) {
        await window.electronAPI?.extensionsEnableForProject(extId, projectPath)
      } else {
        await window.electronAPI?.extensionsDisableForProject(extId, projectPath)
      }
      await loadData()
    } catch (e: any) {
      setError(e.message || 'Failed to toggle extension')
    }
  }

  // Add custom URL
  const handleAddCustomUrl = async () => {
    if (!customUrl.trim()) return

    try {
      setInstalling('custom-url')

      // First fetch info from the URL
      const extInfo = await window.electronAPI?.extensionsFetchFromUrl(customUrl.trim())
      if (!extInfo) {
        setError('Could not fetch extension info from URL')
        return
      }

      // Install it
      const result = await window.electronAPI?.extensionsInstallSkill(extInfo, 'global')
      if (!result.success) {
        setError(result.error || 'Installation failed')
        return
      }

      // Save the custom URL
      await window.electronAPI?.extensionsAddCustomUrl(customUrl.trim())
      setCustomUrl('')
      await loadData()
    } catch (e: any) {
      setError(e.message || 'Failed to add custom URL')
    } finally {
      setInstalling(null)
    }
  }

  // Render extension item
  const renderExtensionItem = (ext: Extension) => {
    const installedExt = installed.find(e => e.id === ext.id)
    const isInst = !!installedExt
    const enabled = isEnabledForProject(ext.id)

    return (
      <div key={ext.id} className="extension-item">
        <div className="extension-header">
          {isInst && (
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => handleToggle(ext.id, e.target.checked)}
              title="Enable for this project"
            />
          )}
          <div className="extension-info">
            <div className="extension-name">{ext.name}</div>
            <div className="extension-description">{ext.description}</div>
            {ext.commands && ext.commands.length > 0 && (
              <div className="extension-commands">
                {ext.commands.slice(0, 3).map(cmd => (
                  <span key={cmd} className="command-tag">{cmd}</span>
                ))}
                {ext.commands.length > 3 && (
                  <span className="command-tag more">+{ext.commands.length - 3}</span>
                )}
              </div>
            )}
            {ext.repo && (
              <div className="extension-repo">{ext.repo.replace('https://github.com/', '')}</div>
            )}
          </div>
          <div className="extension-actions">
            {isInst ? (
              <>
                {installedExt?.type === 'mcp' && (
                  <button
                    className="icon-btn"
                    onClick={() => setConfiguring(installedExt)}
                    title="Configure"
                  >
                    <span>⚙</span>
                  </button>
                )}
                <button
                  className="icon-btn danger"
                  onClick={() => handleRemove(ext.id)}
                  disabled={removing === ext.id}
                  title="Remove"
                >
                  {removing === ext.id ? <span className="spinner">...</span> : <span>🗑</span>}
                </button>
              </>
            ) : (
              <button
                className="install-btn"
                onClick={() => handleInstall(ext)}
                disabled={installing === ext.id}
              >
                {installing === ext.id ? 'Installing...' : 'Install'}
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  const extensions = getExtensionsForTab()
  const installedForTab = installed.filter(e => {
    if (activeTab === 'skills') return e.type === 'skill'
    if (activeTab === 'mcps') return e.type === 'mcp'
    if (activeTab === 'agents') return e.type === 'agent'
    return false
  })
  const availableForTab = extensions.filter(e => !isInstalled(e.id))

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal extension-browser-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Extensions: {projectName}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-content">
          {error && (
            <div className="extension-error">
              {error}
              <button onClick={() => setError(null)}>×</button>
            </div>
          )}

          {/* Add from URL */}
          <div className="add-url-section">
            <input
              type="text"
              placeholder="Add from GitHub URL..."
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddCustomUrl()}
            />
            <button
              onClick={handleAddCustomUrl}
              disabled={!customUrl.trim() || installing === 'custom-url'}
            >
              {installing === 'custom-url' ? 'Adding...' : 'Add'}
            </button>
          </div>

          {/* Tabs */}
          <div className="extension-tabs">
            <button
              className={activeTab === 'skills' ? 'active' : ''}
              onClick={() => setActiveTab('skills')}
            >
              Skills
            </button>
            <button
              className={activeTab === 'mcps' ? 'active' : ''}
              onClick={() => setActiveTab('mcps')}
            >
              MCPs
            </button>
            <button
              className={activeTab === 'agents' ? 'active' : ''}
              onClick={() => setActiveTab('agents')}
            >
              Agents
            </button>
            <button
              className="refresh-btn"
              onClick={() => loadData(true)}
              disabled={refreshing}
              title="Refresh registry"
            >
              {refreshing ? '...' : '↻'}
            </button>
          </div>

          {loading ? (
            <div className="extension-loading">Loading extensions...</div>
          ) : (
            <div className="extension-list">
              {/* Installed section */}
              {installedForTab.length > 0 && (
                <>
                  <div className="extension-section-header">Installed</div>
                  {installedForTab.map(renderExtensionItem)}
                </>
              )}

              {/* Available section */}
              {availableForTab.length > 0 && (
                <>
                  <div className="extension-section-header">Available</div>
                  {availableForTab.map(renderExtensionItem)}
                </>
              )}

              {installedForTab.length === 0 && availableForTab.length === 0 && (
                <div className="extension-empty">
                  No {activeTab} available yet.
                  {activeTab === 'skills' && ' Add one from a GitHub URL above.'}
                </div>
              )}
            </div>
          )}
        </div>

        {/* MCP Configuration Modal */}
        {configuring && (
          <div className="config-overlay" onClick={() => setConfiguring(null)}>
            <div className="config-modal" onClick={e => e.stopPropagation()}>
              <h3>Configure: {configuring.name}</h3>
              <p className="hint">
                MCP configuration changes require restarting Claude Code to take effect.
              </p>
              <div className="config-content">
                <textarea
                  defaultValue={JSON.stringify(configuring.config || {}, null, 2)}
                  placeholder='{"key": "value"}'
                  rows={8}
                  id="mcp-config-textarea"
                />
              </div>
              <div className="config-actions">
                <button onClick={() => setConfiguring(null)}>Cancel</button>
                <button
                  className="primary"
                  onClick={async () => {
                    const textarea = document.getElementById('mcp-config-textarea') as HTMLTextAreaElement
                    try {
                      const config = JSON.parse(textarea.value || '{}')
                      await window.electronAPI?.extensionsSetConfig(configuring.id, config)
                      setConfiguring(null)
                      await loadData()
                    } catch (e) {
                      setError('Invalid JSON configuration')
                    }
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
