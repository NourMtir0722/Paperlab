/**
 * How finely a sheet has to be subdivided for a deformer to look like the
 * surface it is approximating instead of like the polygons it is made of.
 *
 * A deformed mesh is a piecewise-linear stand-in for a curved surface, and the
 * error is the **sagitta**: the gap between a chord and the arc it cuts
 * across. For a chord of length `h` on a circle of radius `r` that gap is
 * `h²/8r` to well under a percent for any chord worth drawing. Invert it and
 * the whole question — "how many segments does this need?" — has a closed
 * form: pick the error you are willing to see, and the segment count falls
 * out of the radius.
 *
 * That is the difference between this and `minSegments`. `minSegments` is a
 * correctness FLOOR — the density below which a deformer stops working at
 * all. This is a QUALITY TARGET, and unlike a floor it has to depend on the
 * options: a bend at `curvature: 0.05` and a roll at `radius: 0.02` are not
 * remotely the same request, and one constant per deformer cannot answer for
 * both.
 */

import type { SheetDims } from '../deformers/types'

/**
 * The error we are willing to see, in world units (a letter sheet is 1 × 1.4,
 * so 1 unit ≈ 216 mm and this is ≈ 0.09 mm).
 *
 * Calibrated, not picked: at `segments: 'auto'`'s old flat 72, the default
 * `roll` (radius 0.12 across a 1.4 span) already ran at a sagitta of 3.9e-4.
 * Setting the tolerance there means the tightest configuration in common use
 * keeps exactly the density it ships with today, and everything gentler —
 * which was paying for that same grid and getting fourteen times the
 * precision it needed — stops paying. The number is a statement about the
 * status quo, so changing it re-lights every preset in the library.
 */
export const SAG_TOL = 4e-4

/**
 * Ceiling for `'auto'`, and deliberately the value `'auto'` used to hand out
 * flat: **this change only ever subdivides less, never more.**
 *
 * The arithmetic below asks for more than this in the tight cases (a
 * `radius: 0.01` roll wants ~350), and it may well be right — but raising the
 * ceiling changes how every existing preset looks and costs, which is a
 * separate decision with its own evidence. Capping here keeps this change to
 * the half that is provably safe: nothing gets coarser than it needs, nothing
 * gets finer than it already was. Set `segments` to a number to go past it.
 */
export const AUTO_CEILING = 72

/**
 * What a sheet gets when nothing deforms it. A flat plane is exact at one
 * segment; this is the small margin that keeps anything interpolated across
 * the quad (lighting terms, translucency) from reading the corners only.
 */
export const FLAT_SEGMENTS = 8

/**
 * Resolved counts are snapped to this ladder. Without it the grid would be a
 * continuous function of the options, so dragging a curvature slider would
 * rebuild the geometry — a new `PlaneGeometry`, a fresh base-position copy,
 * and a disposed buffer — on every tick. Snapped, a drag crosses a step
 * rarely and holds one buffer the rest of the time.
 */
const LADDER = [FLAT_SEGMENTS, 12, 16, 24, 32, 48, 64, AUTO_CEILING] as const

/** Smallest ladder step at or above `n`, clamped to the ceiling. */
export function quantizeSegments(n: number): number {
  for (const step of LADDER) if (n <= step) return step
  return AUTO_CEILING
}

/**
 * Extent of the sheet along a direction in its own plane, degrees. For a
 * rectangle centered on the origin this is exactly `|w·cos| + |h·sin|` — the
 * projection of both half-extents onto the axis, doubled.
 */
export function spanAlong(sheet: SheetDims, angleDeg: number): number {
  const rad = (angleDeg * Math.PI) / 180
  return Math.abs(sheet.width * Math.cos(rad)) + Math.abs(sheet.height * Math.sin(rad))
}

/**
 * Segments needed to hold a circular arc of radius `r` across `span` within
 * `tol`. Straight inversion of `sag = h²/8r`.
 *
 * A flat or near-flat arc (huge radius) needs nothing, hence the 0 — callers
 * take the max against the floor, so 0 means "this deformer is not the reason
 * for any subdivision", which is exactly true of a bend at curvature 0.
 */
export function segmentsForArc(span: number, radius: number, tol = SAG_TOL): number {
  if (!(span > 0) || !(radius > 0) || !Number.isFinite(radius)) return 0
  return span / Math.sqrt(8 * radius * tol)
}

/**
 * Same question for a sinusoid, which is the shape `wave` and `drape` both
 * make. Peak curvature of `A·sin(2πx/λ)` is `A(2π/λ)²` at the crest, so the
 * tightest radius on the curve is its reciprocal and the arc form takes over
 * from there.
 */
export function segmentsForSine(span: number, amplitude: number, wavelength: number, tol = SAG_TOL): number {
  if (!(amplitude > 0) || !(wavelength > 0)) return 0
  const k = (2 * Math.PI) / wavelength
  const peakCurvature = amplitude * k * k
  if (!(peakCurvature > 0)) return 0
  return segmentsForArc(span, 1 / peakCurvature, tol)
}
