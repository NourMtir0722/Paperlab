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
 * The point on a sheet's drawn surface at `(u, v)`, in the geometry's local
 * space, written into `out`.
 *
 * `positions` is a `PlaneGeometry`-ordered grid of `cols × rows` vertices —
 * the order every sheet in the library is built in, cloth particles and strip
 * nodes included. That order runs its rows TOP first, while `v` runs from the
 * BOTTOM: `v = 0` is the bottom edge, as it is in the mesh's own `uv`
 * attribute and in row 0 of a `DamageSource`. The flip is done here, once, so
 * that nothing reading damage at a UV and asking where that is has to know.
 *
 * Interpolated across the TRIANGLE three draws, not bilinearly across the
 * cell. On a flat grid the two agree; on a deformed one they do not, and the
 * triangle is what is on screen — an ember that leaves a point a millimetre
 * inside the paper is an ember that leaves from behind it.
 *
 * `u` and `v` are clamped to the sheet.
 */
export function surfacePointAt(
  positions: ArrayLike<number>,
  cols: number,
  rows: number,
  u: number,
  v: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const fx = Math.min(1, Math.max(0, u)) * (cols - 1)
  const fy = (1 - Math.min(1, Math.max(0, v))) * (rows - 1)
  const ix = Math.min(Math.floor(fx), cols - 2)
  const iy = Math.min(Math.floor(fy), rows - 2)
  const tx = fx - ix
  const ty = fy - iy
  // PlaneGeometry's cell: a (ix, iy), b (ix, iy+1), c (ix+1, iy+1),
  // d (ix+1, iy), drawn as the triangles a-b-d and b-c-d — split along b-d.
  const a = (iy * cols + ix) * 3
  const b = a + cols * 3
  const c = b + 3
  const d = a + 3
  for (let axis = 0; axis < 3; axis++) {
    const pa = positions[a + axis]!
    const pb = positions[b + axis]!
    const pc = positions[c + axis]!
    const pd = positions[d + axis]!
    const value =
      tx + ty <= 1 ? pa + tx * (pd - pa) + ty * (pb - pa) : pc + (1 - tx) * (pb - pc) + (1 - ty) * (pd - pc)
    out.setComponent(axis, value)
  }
  return out
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
