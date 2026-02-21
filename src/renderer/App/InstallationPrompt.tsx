import React from 'react'

interface InstallationPromptProps {
  claudeInstalled: boolean | null
  npmInstalled: boolean | null
  gitBashInstalled: boolean | null
  installing: 'node' | 'claude' | 'git' | null
  installError: string | null
  installMessage: string | null
  onInstallNode: () => void
  onInstallGit: () => void
  onInstallClaude: () => void
}

export function InstallationPrompt({
  claudeInstalled,
  npmInstalled,
  gitBashInstalled,
  installing,
  installError,
  installMessage,
  onInstallNode,
  onInstallGit,
  onInstallClaude
}: InstallationPromptProps): React.ReactElement {
  return (
    <div className="empty-state">
      <h2>{claudeInstalled === false ? 'Claude Code Not Found' : 'Git Required'}</h2>
      <p>{claudeInstalled === false
        ? 'Claude Code needs to be installed to use this application.'
        : 'Claude Code requires Git (git-bash) on Windows.'}</p>
      {installError && (
        <p className="error-message" role="alert" aria-live="assertive">{installError}</p>
      )}
      {installMessage && (
        <p className="install-message" role="status" aria-live="polite">{installMessage}</p>
      )}
      <div className="install-buttons">
        {gitBashInstalled === false && (
          <button
            className="install-btn"
            onClick={onInstallGit}
            disabled={installing !== null}
          >
            {installing === 'git' ? 'Installing Git...' : '1. Install Git'}
          </button>
        )}
        {!npmInstalled && (
          <button
            className="install-btn"
            onClick={onInstallNode}
            disabled={installing !== null}
          >
            {installing === 'node' ? 'Installing Node.js...' : gitBashInstalled === false ? '2. Install Node.js' : '1. Install Node.js'}
          </button>
        )}
        {claudeInstalled === false && (
          <button
            className="install-btn"
            onClick={onInstallClaude}
            disabled={installing !== null || !npmInstalled}
          >
            {installing === 'claude' ? 'Installing Claude...' :
              (!npmInstalled && gitBashInstalled === false) ? '3. Install Claude Code' :
              !npmInstalled ? '2. Install Claude Code' : 'Install Claude Code'}
          </button>
        )}
      </div>
      {(gitBashInstalled === false || !npmInstalled) && (
        <p className="install-note">
          {gitBashInstalled === false && !npmInstalled
            ? 'Git and Node.js are required for Claude Code.'
            : gitBashInstalled === false
              ? 'Git is required for Claude Code on Windows.'
              : 'Node.js is required to install Claude Code.'}
        </p>
      )}
    </div>
  )
}
