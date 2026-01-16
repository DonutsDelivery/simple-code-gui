import { Project } from '../../stores/workspace.js'

export function adjustMenuPosition(
  menu: HTMLElement,
  position: { x: number; y: number },
  padding = 8
): { x: number; y: number } {
  const rect = menu.getBoundingClientRect()
  let { x, y } = position

  if (rect.right > window.innerWidth - padding) {
    x = window.innerWidth - rect.width - padding
  }
  if (rect.bottom > window.innerHeight - padding) {
    y = window.innerHeight - rect.height - padding
  }

  return {
    x: Math.max(padding, x),
    y: Math.max(padding, y)
  }
}

export function getLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255

  const toLinear = (c: number) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

export function getCategoryGradient(categoryProjects: Project[]): { background: string; textDark: boolean } {
  const colors = categoryProjects
    .map(p => p.color)
    .filter(Boolean) as string[]

  if (colors.length === 0) return { background: 'transparent', textDark: false }

  const avgLuminance = colors.reduce((sum, c) => sum + getLuminance(c), 0) / colors.length
  const textDark = avgLuminance > 0.4

  if (colors.length === 1) return { background: `${colors[0]}66`, textDark }

  const stops = colors.map((c, i) =>
    `${c}66 ${(i / (colors.length - 1)) * 100}%`
  ).join(', ')

  return { background: `linear-gradient(135deg, ${stops})`, textDark }
}

export function formatDate(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}
