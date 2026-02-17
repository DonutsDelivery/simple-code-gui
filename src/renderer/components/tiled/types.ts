import type { Theme } from '../../themes.js'
import type { Api } from '../../api/types.js'
import type { TileLayout, DropZone, OpenTab } from '../tiled-layout-utils.js'

export interface Project {
  path: string
  name: string
  color?: string
}

export type { OpenTab }

export interface TiledTerminalViewProps {
  tabs: OpenTab[]
  projects: Project[]
  theme: Theme
  focusedTabId?: string | null
  onCloseTab: (id: string) => void
  onFocusTab: (id: string) => void
  layout: TileLayout[]
  onLayoutChange: (layout: TileLayout[]) => void
  onOpenSessionAtPosition?: (projectPath: string, dropZone: DropZone | null, containerSize: { width: number, height: number }, currentLayout?: TileLayout[]) => void
  onAddTab?: (projectPath: string) => void
  onUndoCloseTab?: () => void
  api?: Api
}

export interface TileResizeState {
  tileId: string
  edge: 'right' | 'bottom' | 'left' | 'top' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  startX: number
  startY: number
  startLayout: TileLayout
  tilesLeftOfRightDivider: TileLayout[]
  tilesRightOfRightDivider: TileLayout[]
  tilesLeftOfLeftDivider: TileLayout[]
  tilesRightOfLeftDivider: TileLayout[]
  tilesAboveBottomDivider: TileLayout[]
  tilesBelowBottomDivider: TileLayout[]
  tilesAboveTopDivider: TileLayout[]
  tilesBelowTopDivider: TileLayout[]
  rightDividerPos: number
  leftDividerPos: number
  bottomDividerPos: number
  topDividerPos: number
}

export type ResizeEdge = TileResizeState['edge']

export { TileLayout, DropZone }
