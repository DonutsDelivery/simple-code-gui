export interface PtyGeometry {
  cols: number
  rows: number
  generation: number
  /** Whether this frontend may change the canonical PTY geometry. */
  canResize: boolean
}

export type PtyGeometryCallback = (geometry: PtyGeometry) => void
