# Simple Claude GUI

A desktop app for managing multiple Claude Code sessions across different projects in a single window.

![GitHub Release](https://img.shields.io/github/v/release/DonutsDelivery/simple-claude-gui)
![Downloads](https://img.shields.io/github/downloads/DonutsDelivery/simple-claude-gui/total)
![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron)
![AUR](https://img.shields.io/aur/version/simple-claude-gui)

## Features

- **Image & File Paste** - Paste screenshots and files directly into terminal with Ctrl+V
- **Drag & Drop Files** - Drop files from your file manager into the terminal
- **Tabbed Sessions** - Multiple Claude sessions open simultaneously with easy tab switching
- **Project Sidebar** - Save and organize your project folders for quick access
- **Session Resume** - Resume previous conversations where you left off
- **9 Color Themes** - Dark, light, and RGB Gamer mode with animations
- **Beads Integration** - Task tracking panel for managing project tasks
- **Create Projects** - Make new project directories without leaving the app
- **Session Discovery** - Automatically finds existing Claude sessions from `~/.claude`
- **Auto Updates** - Automatic updates on Windows, macOS, and Linux

## Installation

### Windows / macOS / Linux

Download the latest release from [GitHub Releases](https://github.com/DonutsDelivery/simple-claude-gui/releases):

- **Windows**: `.exe` installer or portable
- **macOS**: `.dmg` (Apple Silicon)
- **Linux**: `.AppImage` or `.deb`

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
| `Ctrl+C` | Copy selection (or SIGINT if no selection) |
| `Ctrl+V` | Paste text, files, or images |
| `Ctrl+Shift+C` | Copy from terminal |
| `Ctrl+Shift+V` | Paste to terminal |
| `F12` | Toggle DevTools |

## Tech Stack

- **Electron** - Desktop framework
- **React** - UI components
- **xterm.js** - Terminal emulation
- **node-pty** - Pseudo-terminal spawning
- **Zustand** - State management

## License

MIT
