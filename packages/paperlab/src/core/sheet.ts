import * as THREE from 'three'
import type { SheetConfig } from '../config/schema'
import { FLAT_SEGMENTS, LEGACY_FLAT_SEGMENTS, quantizeSegments, type SegmentPair } from './tessellation'

/**
 * Resolve the subdivision grid for a sheet.
 *
 * `minSegments` is the correctness floor the active deformers require, and it
 * applies however `segments` is set. `autoSegments` is what those deformers
 * WANT for the options they are carrying, and it is what `'auto'` resolves
 * to — see `stackAutoSegments` and `core/tessellation.ts`.
 *
 * Both are per axis, because a demand is a demand along a DIRECTION. A
 * banner draped in folds across its width needs those folds resolved across
 * and needs almost nothing down its drop; a single number spread by aspect
 * ratio gives the drop the density and the folds the leftovers, which is
 * both the expensive answer and the wrong-looking one. A bare number is
 * still accepted and still means "this many, both ways".
 *
 * `'auto'` used to hand the long side a flat 72 whatever was on the sheet, so
 * a blank page was tessellated exactly as finely as a crumpled one and every
 * `minSegments` in the library was dead weight — nothing could ever raise a
 * grid that already started at the highest value anyone asked for. It now
 * sizes to the work, quantized onto a ladder so that dragging a slider does
 * not rebuild the mesh.
 *
 * Omitting `autoSegments` keeps the old flat 72, which is what a caller with
 * no deformer stack in hand should get — this helper is exported, and its
 * answer to an unchanged call should not have changed.
 */
export function resolveSegments(
  sheet: SheetConfig,
  minSegments: number | SegmentPair = 2,
  autoSegments: number | SegmentPair = LEGACY_FLAT_SEGMENTS,
): [number, number] {
  // A bare floor is a floor both ways — it says nothing about direction.
  const [minX, minY] = typeof minSegments === 'number' ? [minSegments, minSegments] : minSegments
  if (sheet.segments !== 'auto') {
    return [Math.max(sheet.segments, minX, 2), Math.max(sheet.segments, minY, 2)]
  }
  // A bare TARGET is the old contract: one density for the long edge, spread
  // over the short one by aspect, snapped to the ladder once. Callers with a
  // stack in hand pass a pair instead, and each axis is then snapped on its
  // own — which is the point of asking per axis at all.
  const [wantX, wantY] =
    typeof autoSegments === 'number'
      ? spreadByAspect(sheet, quantizeSegments(Math.max(autoSegments, FLAT_SEGMENTS)))
      : [
          quantizeSegments(Math.max(wantOrFlat(autoSegments[0]), FLAT_SEGMENTS)),
          quantizeSegments(Math.max(wantOrFlat(autoSegments[1]), FLAT_SEGMENTS)),
        ]
  return [Math.max(wantX, minX, 2), Math.max(wantY, minY, 2)]
}

const wantOrFlat = (n: number) => (Number.isFinite(n) ? n : FLAT_SEGMENTS)

function spreadByAspect(sheet: SheetConfig, target: number): [number, number] {
  const long = Math.max(sheet.width, sheet.height)
  if (!(long > 0)) return [target, target]
  return [Math.round((sheet.width / long) * target), Math.round((sheet.height / long) * target)]
}

/**
 * Geometry factory. The sheet lives in its local XY plane, centered on the
 * origin, facing +Z. Deformers displace these vertices; the base (flat)
 * positions are kept by the caller for re-deformation each frame.
 */
export function createSheetGeometry(
  sheet: SheetConfig,
  minSegments: number | SegmentPair = 2,
  autoSegments: number | SegmentPair = LEGACY_FLAT_SEGMENTS,
): THREE.PlaneGeometry {
  const [sx, sy] = resolveSegments(sheet, minSegments, autoSegments)
  return new THREE.PlaneGeometry(sheet.width, sheet.height, sx, sy)
}
