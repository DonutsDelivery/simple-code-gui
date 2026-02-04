<p align="center">
  <img src="assets/header-gui-v3.png" alt="simple-code-gui" width="600">
</p>

<p align="center">
  <a href="https://donutsdelivery.online/#simplecodegui"><img src="https://img.shields.io/badge/Website-donutsdelivery.online-blue?logo=googlechrome&logoColor=white" alt="Website"></a>
  <a href="https://discord.gg/ZhvPhXrdZ4"><img src="https://img.shields.io/badge/Discord-Join%20Server-5865F2?logo=discord&logoColor=white" alt="Discord"></a>
  <img src="https://img.shields.io/github/v/release/DonutsDelivery/simple-code-gui" alt="GitHub Release">
  <img src="https://img.shields.io/github/downloads/DonutsDelivery/simple-code-gui/total" alt="Downloads">
  <img src="https://img.shields.io/badge/Electron-33-47848F?logo=electron" alt="Electron">
  <img src="https://img.shields.io/aur/version/simple-code-gui" alt="AUR">
</p>

A desktop GUI for managing multiple AI coding assistant sessions across different projects in a single window. Supports **Claude Code**, **Gemini CLI**, **Codex**, and **OpenCode**.

Stop juggling terminal tabs. Simple Code GUI lets you run AI coding assistants on multiple projects simultaneously, instantly resume past conversations, and switch between sessions with a click. Features voice input/output, image pasting, task tracking with Beads integration, and 9 color themes.

![Main Interface - Tiled View](https://donutsdelivery.online/assets/mockups/thumbs/simplecodegui-mockup-1.svg)

## Features

### Multi-Backend Support
- **Claude Code** - Anthropic's Claude AI assistant
- **Gemini CLI** - Google's Gemini AI
- **Codex** - OpenAI Codex
- **OpenCode** - Open source alternative

### Session Management
- **Tabbed Interface** - Multiple AI sessions open simultaneously
- **Session Resume** - Pick up conversations where you left off
- **Session Discovery** - Auto-finds existing sessions
- **Tiled View** - See multiple terminals side-by-side (toggle with grid button)
- **Workspace Persistence** - Restores your open tabs and layout on restart

### Project Organization
- **Project Sidebar** - Save and organize project folders for quick access
- **Create Projects** - Make new project directories without leaving the app
- **Session History** - Expand projects to see all past sessions with timestamps
- **Project Icons** - Custom emoji icons for each project
- **Per-Project Settings** - Override global settings per project (backend, permissions, voice)
- **Run Executable** - Launch your app directly from the sidebar

### Voice Features
- **Speech-to-Text** - Whisper models for voice input (tiny to large)
- **Text-to-Speech** - Piper voices and XTTS voice clones for spoken responses
- **Voice Cloning** - Clone your own voice for personalized TTS
- **Speed Control** - Adjust TTS playback speed

### Terminal
- **GPU Acceleration** - WebGL-accelerated rendering for smooth terminal output
- **Image & File Paste** - Paste screenshots and copied files with Ctrl+V
- **Drag & Drop** - Drop files from file manager into terminal
- **Smart Ctrl+C** - Copies selection if text selected, sends SIGINT otherwise
- **Right-Click Menu** - Copy selection or paste with right-click
- **Full Color Support** - xterm-256color with 10,000 line scrollback

### Customization
- **9 Color Themes** - Including RGB Gamer mode with animations
- **Settings Panel** - Configure themes, permissions, backend, and voice
- **Window Memory** - Remembers size and position

### Task Tracking (Beads Integration)
- **Task Panel** - Manage project tasks without leaving the app
- **Create Tasks** - Add tasks with title, description, and priority
- **Track Progress** - Start, complete, and delete tasks
- **Auto-Refresh** - Task list updates automatically

### Setup & Updates
- **Auto-Install Dependencies** - Installs Claude Code, Node.js, Git if missing
- **Auto Updates** - Downloads and installs updates automatically
- **Cross-Platform** - Windows, macOS (Apple Silicon), and Linux

## Installation

### Windows / macOS / Linux

Download from [GitHub Releases](https://github.com/DonutsDelivery/simple-code-gui/releases):

| Platform | Download |
|----------|----------|
| Windows | `.exe` installer or portable |
| macOS (untested)| `.dmg` (Apple Silicon) |
| Linux | `.AppImage` or `.deb` |

If you download Simple Code GUI on macOS and get a message like:
	•	“Simple Code GUI.app is damaged and can’t be opened”
	•	“…can’t be opened because it is damaged”

…it’s usually not actually corrupted. This is macOS Gatekeeper reacting to a quarantined download (common when downloaded via Safari) plus an app that’s not notarized / not Developer ID signed (many Electron apps built locally are “ad-hoc signed”).

Why it happens

macOS attaches a com.apple.quarantine attribute to apps downloaded from the internet. When Gatekeeper evaluates a quarantined app that isn’t notarized (or is ad-hoc signed), the user sometimes gets the misleading “damaged” dialog instead of a clearer “unidentified developer” warning.
Fix: Remove the quarantine attribute and reopen the app:
sudo xattr -dr com.apple.quarantine "/Applications/Simple Code GUI.app"
open "/Applications/Simple Code GUI.app"

### Arch Linux (AUR)

```bash
yay -S simple-code-gui
```

### From Source

```bash
git clone https://github.com/DonutsDelivery/simple-code-gui.git
cd simple-code-gui
npm install
npm run dev
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+C` | Copy selection (or SIGINT if no selection) |
| `Ctrl+V` | Paste text, files, or images |
| `Ctrl+Shift+C` | Copy from terminal |
| `Ctrl+Shift+V` | Paste to terminal |
| `F12` | Toggle DevTools |

## License

[PolyForm Noncommercial 1.0.0](LICENSE) - Free for personal use. Commercial distribution requires permission from the author.
