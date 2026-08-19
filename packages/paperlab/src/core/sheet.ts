import * as THREE from 'three'
import type { SheetConfig } from '../config/schema'
import { FLAT_SEGMENTS, LEGACY_FLAT_SEGMENTS, quantizeSegments } from './tessellation'

/**
 * Resolve the subdivision grid for a sheet.
 *
 * `minSegments` is the correctness floor the active deformers require, and it
 * applies however `segments` is set. `autoSegments` is what those deformers
 * WANT for the options they are carrying, and it is what `'auto'` resolves
 * to — see `stackAutoSegments` and `core/tessellation.ts`.
 *
 * `'auto'` used to hand the long side a flat 72 whatever was on the sheet, so
 * a blank page was tessellated exactly as finely as a crumpled one and every
 * `minSegments` in the library was dead weight — nothing could ever raise a
 * grid that already started at the highest value anyone asked for. It now
 * sizes to the work, quantized onto a ladder so that dragging a slider does
 * not rebuild the mesh, and capped at what it used to give flat so this can
 * only ever subdivide less.
 *
 * Omitting `autoSegments` keeps the old flat 72, which is what a caller with
 * no deformer stack in hand should get — this helper is exported, and its
 * answer to an unchanged call should not have changed.
 */
export function resolveSegments(
  sheet: SheetConfig,
  minSegments = 2,
  autoSegments = LEGACY_FLAT_SEGMENTS,
): [number, number] {
  if (sheet.segments !== 'auto') {
    const s = Math.max(sheet.segments, minSegments)
    return [s, s]
  }
  const target = quantizeSegments(Math.max(autoSegments, FLAT_SEGMENTS))
  const long = Math.max(sheet.width, sheet.height)
  const sx = Math.round((sheet.width / long) * target)
  const sy = Math.round((sheet.height / long) * target)
  return [Math.max(sx, minSegments, 2), Math.max(sy, minSegments, 2)]
}

/**
 * Geometry factory. The sheet lives in its local XY plane, centered on the
 * origin, facing +Z. Deformers displace these vertices; the base (flat)
 * positions are kept by the caller for re-deformation each frame.
 */
export function createSheetGeometry(
  sheet: SheetConfig,
  minSegments = 2,
  autoSegments = LEGACY_FLAT_SEGMENTS,
): THREE.PlaneGeometry {
  const [sx, sy] = resolveSegments(sheet, minSegments, autoSegments)
  return new THREE.PlaneGeometry(sheet.width, sheet.height, sx, sy)
}
