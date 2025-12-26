// Map of keywords to emojis for project icons
const keywordIcons: Record<string, string> = {
  // Web & Frontend
  web: '🌐',
  website: '🌐',
  frontend: '🎨',
  react: '⚛️',
  vue: '💚',
  angular: '🅰️',
  next: '▲',
  svelte: '🔥',
  html: '📄',
  css: '🎨',
  tailwind: '💨',

  // Backend & API
  api: '⚡',
  server: '🖥️',
  backend: '⚙️',
  express: '🚂',
  fastapi: '⚡',
  django: '🎸',
  flask: '🧪',
  node: '💚',
  deno: '🦕',

  // AI & ML
  ai: '🤖',
  ml: '🧠',
  machine: '🧠',
  learning: '🧠',
  neural: '🧠',
  model: '🤖',
  llm: '🤖',
  claude: '🟠',
  gpt: '🤖',
  comfy: '🎨',
  comfyui: '🎨',
  diffusion: '🎨',
  stable: '🎨',
  lora: '✨',

  // Data
  data: '📊',
  database: '🗄️',
  sql: '🗄️',
  mongo: '🍃',
  postgres: '🐘',
  redis: '🔴',

  // Mobile
  mobile: '📱',
  ios: '🍎',
  android: '🤖',
  flutter: '💙',
  'react-native': '📱',

  // DevOps & Tools
  docker: '🐳',
  kubernetes: '☸️',
  k8s: '☸️',
  aws: '☁️',
  cloud: '☁️',
  ci: '🔄',
  cd: '🔄',
  deploy: '🚀',

  // Languages
  python: '🐍',
  rust: '🦀',
  go: '🐹',
  java: '☕',
  kotlin: '🎯',
  swift: '🦅',
  typescript: '💙',
  javascript: '💛',

  // Game & Graphics
  game: '🎮',
  unity: '🎮',
  unreal: '🎮',
  graphics: '🖼️',
  opengl: '🖼️',

  // Other
  test: '🧪',
  docs: '📚',
  documentation: '📚',
  config: '⚙️',
  util: '🔧',
  utils: '🔧',
  tool: '🔧',
  tools: '🔧',
  lib: '📦',
  library: '📦',
  package: '📦',
  plugin: '🔌',
  extension: '🔌',
  addon: '🔌',
  cli: '💻',
  terminal: '💻',
  shell: '💻',
  script: '📜',
  bot: '🤖',
  scraper: '🕷️',
  crawler: '🕷️',
  chat: '💬',
  email: '📧',
  auth: '🔐',
  security: '🔒',
  crypto: '🔐',
  blockchain: '⛓️',
  music: '🎵',
  audio: '🔊',
  video: '🎬',
  image: '🖼️',
  photo: '📷',
}

// Generate a consistent color based on string hash
function hashColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }

  // Generate HSL color with good saturation and lightness
  const h = Math.abs(hash % 360)
  const s = 60 + (Math.abs(hash >> 8) % 20) // 60-80%
  const l = 45 + (Math.abs(hash >> 16) % 15) // 45-60%

  return `hsl(${h}, ${s}%, ${l}%)`
}

export interface ProjectIcon {
  emoji: string | null
  letter: string
  color: string
}

export function getProjectIcon(projectName: string): ProjectIcon {
  const nameLower = projectName.toLowerCase()
  const words = nameLower.split(/[-_\s]+/)

  // Look for keyword matches
  for (const word of words) {
    if (keywordIcons[word]) {
      return {
        emoji: keywordIcons[word],
        letter: projectName[0].toUpperCase(),
        color: hashColor(projectName)
      }
    }
  }

  // Check if any keyword is contained in the name
  for (const [keyword, emoji] of Object.entries(keywordIcons)) {
    if (nameLower.includes(keyword)) {
      return {
        emoji,
        letter: projectName[0].toUpperCase(),
        color: hashColor(projectName)
      }
    }
  }

  // No match - return letter with color
  return {
    emoji: null,
    letter: projectName[0].toUpperCase(),
    color: hashColor(projectName)
  }
}
