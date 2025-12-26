# Simple Claude GUI

A desktop app for managing multiple Claude Code sessions across different projects in a single window.

![Electron](https://img.shields.io/badge/Electron-28-47848F?logo=electron)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![AUR](https://img.shields.io/aur/version/simple-claude-gui)

## Features

- **Project Sidebar** - Save and organize your project folders for quick access
- **Tabbed Terminals** - Multiple Claude sessions open simultaneously with easy switching
- **Session Discovery** - Automatically finds existing Claude sessions from `~/.claude`
- **Session Resume** - Resume previous conversations where you left off
- **Workspace Persistence** - Restores your open tabs and layout on restart
- **Auto Icons** - Generates project icons based on folder names

## Installation

### Arch Linux (AUR)

```bash
yay -S simple-claude-gui
```

### From Source

```bash
git clone https://github.com/DonutsDelivery/simple-claude-gui.git
cd simple-claude-gui
npm install
npm run dev    # Development
npm run build  # Production build
```

## Requirements

- [Claude Code CLI](https://claude.ai/claude-code) installed and authenticated
- Node.js 18+

## Usage

1. Click **+ Add Project** to add a project folder
2. Click a project to open the most recent session (or start new)
3. Click the expand arrow (▶) to see all sessions for a project
4. Switch between tabs to work on multiple projects
5. Sessions auto-save - close and reopen anytime

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+C` | Copy from terminal |
| `Ctrl+Shift+V` | Paste to terminal |

## Tech Stack

- **Electron** - Desktop framework
- **React** - UI components
- **xterm.js** - Terminal emulation
- **node-pty** - Pseudo-terminal spawning
- **Zustand** - State management

## License

MIT
