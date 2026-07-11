import * as THREE from 'three'
import type { SheetConfig } from '../config/schema'

/** Longest side gets this many segments in 'auto' mode (hero path). */
const AUTO_LONG_SIDE_SEGMENTS = 72

/**
 * Resolve the subdivision grid for a sheet. Deformers can raise the floor via
 * `minSegments` (a tight roll needs density along the roll direction).
 */
export function resolveSegments(sheet: SheetConfig, minSegments = 2): [number, number] {
  if (sheet.segments !== 'auto') {
    const s = Math.max(sheet.segments, minSegments)
    return [s, s]
  }
  const long = Math.max(sheet.width, sheet.height)
  const sx = Math.round((sheet.width / long) * AUTO_LONG_SIDE_SEGMENTS)
  const sy = Math.round((sheet.height / long) * AUTO_LONG_SIDE_SEGMENTS)
  return [Math.max(sx, minSegments, 2), Math.max(sy, minSegments, 2)]
}

/**
 * Geometry factory. The sheet lives in its local XY plane, centered on the
 * origin, facing +Z. Deformers displace these vertices; the base (flat)
 * positions are kept by the caller for re-deformation each frame.
 */
export function createSheetGeometry(sheet: SheetConfig, minSegments = 2): THREE.PlaneGeometry {
  const [sx, sy] = resolveSegments(sheet, minSegments)
  return new THREE.PlaneGeometry(sheet.width, sheet.height, sx, sy)
}
