import type { Theme } from '../../themes.js'
import type { Api } from '../../api/types.js'
import type { TileNode, ComputedRect, TileLeaf } from '../tile-tree.js'
import type { DropZone, OpenTab } from '../tiled-layout-utils.js'

export interface Project {
  path: string
  name: string
  icon?: string
  color?: string
}

export type { OpenTab }

export interface TiledTerminalViewProps {
  tabs: OpenTab[]
  projects: Project[]
  theme: Theme
  focusedTabId?: string | null
  onCloseTab: (id: string) => void
  onRenameTab: (id: string, title: string) => void
  onFocusTab: (id: string) => void
  tileTree: TileNode | null
  onTreeChange: (tree: TileNode | null) => void
  onOpenSessionAtPosition?: (projectPath: string, dropZone: DropZone | null, containerSize: { width: number, height: number }, currentTree?: TileNode | null) => void
  onAddTab?: (projectPath: string, tileId: string) => void
  onUndoCloseTab?: () => void
  api?: Api
}

export interface TileResizeState {
  branchId: string
  childIndex: number
  direction: 'horizontal' | 'vertical'
  startMouse: number // clientX or clientY depending on direction
}

export type ResizeEdge = 'right' | 'bottom' | 'left' | 'top' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export type ClientToCanvasPercent = (clientX: number, clientY: number) => { x: number; y: number }

export { TileNode, ComputedRect, TileLeaf }
export type { DropZone }
