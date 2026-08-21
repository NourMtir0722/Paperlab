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
 * Ceiling for `'auto'` in hero mode, and it is a CPU budget rather than a
 * round number.
 *
 * Hero mode re-deforms every vertex in JS on the main thread, every frame,
 * for any animated stack — and `wave` is animated, so a hanging poster pays
 * it forever rather than only while something plays. Measured, one sheet,
 * one re-deform (`drape + wave`, and `crumple` tracks it within 5%), before
 * and after the loop was rewritten around a single-function inner call site
 * and `computeSheetNormals`:
 *
 * |  grid |  verts | was  | now  |
 * | ----: | -----: | ---: | ---: |
 * |    72 |  3,796 | 0.74 | 0.27 |
 * |   128 | 11,868 | 2.30 | 0.84 |
 * |   192 | 26,634 | 5.01 | 1.89 |
 * |   256 | 47,288 | 8.74 | 3.38 |
 *
 * **192, raised from 128, and the price is why.** 128 was picked when it cost
 * 2.30 ms — the last step that still left room for a scene around it. 192 now
 * costs 1.89 ms, which is less than 128 ever did, so the old line was drawn
 * against a price that no longer exists.
 *
 * The reason it is nearly free in practice is the axis split: a demand lands
 * on the direction that bends and the other axis stays at `FLAT_SEGMENTS`. A
 * `drape` at its own defaults wants 154 across and two segments down, so the
 * raise costs it 0.02 ms rather than the 1.89 ms a square 192 grid implies.
 * The square case is reachable — a stack that bends both ways, `wave` over
 * `drape` — and it is opt-in through options rather than something a preset
 * hands anybody.
 *
 * What it buys, all of it previously capped: `drape` at its defaults (154),
 * `roll` and `fold` at `radius: 0.02` (175), `curl` at `radius: 0.02` (142).
 * No preset that ships reaches even 128 after the axis split, so this changes
 * nothing already in the library — it stops punishing people who ask for a
 * tighter crease than any preset uses.
 *
 * Still NOT high enough for everything the arithmetic asks: `wave` at
 * `amplitude: 0.3` wants 272 and a 16-fold `drape` at full depth wants 1377.
 * Those stay capped, and the gap is real rather than hidden. Set `segments`
 * to a number (up to the schema's 256) to go past it.
 *
 * A field is capped far lower and separately, because a field draws this
 * geometry N times — see `FIELD_AUTO_CEILING`.
 */
export const AUTO_CEILING = 192

/**
 * What a sheet gets when nothing deforms it. A flat plane is exact at one
 * segment; this is the small margin that keeps anything interpolated across
 * the quad (lighting terms, translucency) from reading the corners only.
 */
export const FLAT_SEGMENTS = 8

/**
 * What `'auto'` handed out flat, on every sheet, before it learned to adapt.
 *
 * Still load-bearing in two places: it is what `resolveSegments` assumes when
 * a caller has no deformer stack to ask (so the exported helper answers today
 * exactly what it answered before), and it is what a field is allowed to ask
 * for, since a field draws its buffer once per instance.
 */
export const LEGACY_FLAT_SEGMENTS = 72

/**
 * Resolved counts are snapped to this ladder. Without it the grid would be a
 * continuous function of the options, so dragging a curvature slider would
 * rebuild the geometry — a new `PlaneGeometry`, a fresh base-position copy,
 * and a disposed buffer — on every tick. Snapped, a drag crosses a step
 * rarely and holds one buffer the rest of the time.
 */
const LADDER = [FLAT_SEGMENTS, 12, 16, 24, 32, 48, 64, LEGACY_FLAT_SEGMENTS, 96, 128, AUTO_CEILING] as const

/** Smallest ladder step at or above `n`, clamped to the ceiling. */
export function quantizeSegments(n: number): number {
  for (const step of LADDER) if (n <= step) return step
  return AUTO_CEILING
}

/**
 * A resolved grid: segments along the sheet's own X and Y.
 *
 * Two numbers rather than one because a sheet is not subdivided by a single
 * density. A banner 1.5 wide and 8.5 tall, draped in folds that run across
 * its width, needs the folds resolved ACROSS and needs almost nothing down
 * the drop — and a single number, however it is distributed, answers one of
 * those questions by getting the other one wrong.
 */
export type SegmentPair = [x: number, y: number]

/**
 * Split a deformer's segment demand onto the sheet's two axes.
 *
 * A deformer curves along ONE direction — `roll`, `bend`, `fold` and `wave`
 * all name it `angle`, `drape`'s folds run across the width, `curl` works
 * down a corner diagonal — and `segmentsForArc` answers in segments along
 * THAT direction. Turning that into a grid is a projection: the demand is
 * really a density (segments per world unit along the curve), and each axis
 * needs enough of it that a grid edge's component along the curve stays
 * inside the chord the sagitta bound allows.
 *
 * Hence `width·|cos θ|·density` and `height·|sin θ|·density`. A bend across
 * x asks everything of x and nothing of y, which is exactly right: the sheet
 * does not move along y, so subdividing it there buys a bigger buffer and an
 * identical picture.
 *
 * `null` is for a deformer with no single direction — `crumple`'s creases
 * run every way at once. That case keeps the old behaviour of spreading the
 * demand by aspect ratio, which is the honest answer when the demand really
 * is isotropic.
 */
export function axialSegments(sheet: SheetDims, angleDeg: number | null, n: number): SegmentPair {
  if (!(n > 0)) return [0, 0]
  if (angleDeg === null) {
    const long = Math.max(sheet.width, sheet.height)
    if (!(long > 0)) return [n, n]
    return [(sheet.width / long) * n, (sheet.height / long) * n]
  }
  const span = spanAlong(sheet, angleDeg)
  if (!(span > 0)) return [n, n]
  const rad = (angleDeg * Math.PI) / 180
  const density = n / span
  return [sheet.width * Math.abs(Math.cos(rad)) * density, sheet.height * Math.abs(Math.sin(rad)) * density]
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
