/**
 * Turning a drag across the sheet into something the paper keeps.
 *
 * The library already models a crease as `{ angle, offset, depth }` and
 * already remembers it — `memory.creases` is what "the sheet keeps what you
 * fold into it" means. Nothing here adds a capability; it converts two points
 * on the surface into that triple, which is the one piece the library cannot
 * do for us because it has no idea a finger was involved.
 *
 * All of it is pure, and deliberately so: getting the crease convention wrong
 * produces a line at the right angle in the wrong place, which is exactly the
 * bug that looks like a rendering problem and is not.
 */

import type { PaperEdge } from 'paperlab'

/** A point on the sheet, as the raycaster reports it: 0..1 across each axis. */
export interface UV {
  u: number
  v: number
}

export interface SheetDims {
  width: number
  height: number
}

export interface Crease {
  angle: number
  offset: number
  depth: number
}

/**
 * How hard a scored line reads, in degrees of residual fold.
 *
 * A score is not a fold — you have marked the paper, not bent it — so this is
 * well below the 90° that saturates the crease shading. It is enough to catch
 * the light and no more.
 */
export const SCORE_DEPTH = 16

/** Below this, in sheet units, a drag is a tap and not a line. */
export const MIN_SCORE_LENGTH = 0.12

/** Wrap into [0, 180), flipping the offset with it — see the note in `creaseFromDrag`. */
function canonical(angleDeg: number, offset: number): { angle: number; offset: number } {
  let angle = angleDeg
  let flipped = offset
  while (angle < 0) {
    angle += 180
    flipped = -flipped
  }
  while (angle >= 180) {
    angle -= 180
    flipped = -flipped
  }
  return { angle, offset: flipped }
}

/** Sheet-local world position of a UV point. Matches the library's own mapping. */
function toLocal(point: UV, sheet: SheetDims): { x: number; y: number } {
  return { x: (point.u - 0.5) * sheet.width, y: (point.v - 0.5) * sheet.height }
}

/**
 * The crease left by dragging a fingertip from one point to another.
 *
 * Two conventions have to be honoured, and both are easy to get backwards.
 * `angle` is the direction the fold TRAVELS, not the direction of the line
 * you drew — they are perpendicular, which is why there is a +90 here and a
 * -90 inside the library's own shading conversion. And `offset` is a signed
 * WORLD distance from the sheet's centre measured along that travel
 * direction, not a fraction; the library divides it by the sheet's span
 * itself.
 *
 * `(angle, offset)` and `(angle + 180, -offset)` describe the same physical
 * line, so the result is wrapped into a single canonical half-turn. That is
 * cosmetic for the renderer and load-bearing for the tests.
 *
 * Returns `null` for a drag too short to be a line.
 */
export function creaseFromDrag(from: UV, to: UV, sheet: SheetDims): Crease | null {
  const a = toLocal(from, sheet)
  const b = toLocal(to, sheet)
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.hypot(dx, dy) < MIN_SCORE_LENGTH) return null

  // The line runs a → b; the fold travels across it.
  const travel = Math.atan2(dy, dx) + Math.PI / 2
  // Signed distance from the centre to the line, along the travel direction.
  const offset = a.x * Math.cos(travel) + a.y * Math.sin(travel)
  const { angle, offset: wrapped } = canonical((travel * 180) / Math.PI, offset)
  return { angle, offset: wrapped, depth: SCORE_DEPTH }
}

/**
 * The furthest a fingertip can travel between frames and still be drawing the
 * same line, in UV.
 *
 * This exists because the gesture reader debounces: it keeps reporting
 * `point` for a few frames after the hand has actually stopped pointing, and
 * in those frames the hand is already moving away. Without this the score
 * follows it there, and the line you drew collapses to wherever you happened
 * to relax your hand — which reads as "scoring is unreliable" rather than as
 * a timing bug.
 *
 * Generous against real drawing (a fast stroke across the sheet is well under
 * this per frame) and tight against a pose change, which jumps.
 */
export const MAX_SCORE_STEP = 0.12

/** Whether `next` continues the stroke, or is the hand having left it. */
export function continuesScore(previous: UV, next: UV): boolean {
  return Math.hypot(next.u - previous.u, next.v - previous.v) <= MAX_SCORE_STEP
}

/**
 * Keep the most recent creases, newest last.
 *
 * The schema caps `memory.creases` at four because that is what the crease
 * shader carries. Dropping the OLDEST rather than refusing the newest is the
 * behaviour paper has: keep scoring it and the early marks are the ones that
 * stop mattering.
 */
export const MAX_CREASES = 4

export function addCrease(existing: readonly Crease[], crease: Crease): Crease[] {
  return [...existing, crease].slice(-MAX_CREASES)
}

/** Within this fraction of an edge, a grab counts as being ON that edge. */
export const EDGE_MARGIN = 0.18

/**
 * Which edge a point is nearest, if it is near one at all.
 *
 * Ties go to the closer axis, and the middle of the sheet is `null` rather
 * than an arbitrary edge — tearing the paper because a grab drifted toward
 * the centre-left would be worse than not tearing it.
 */
export function nearestEdge(point: UV, margin = EDGE_MARGIN): PaperEdge | null {
  const distances: [PaperEdge, number][] = [
    ['left', point.u],
    ['right', 1 - point.u],
    ['bottom', point.v],
    ['top', 1 - point.v],
  ]
  let best: [PaperEdge, number] | null = null
  for (const candidate of distances) {
    if (candidate[1] < margin && (best === null || candidate[1] < best[1])) best = candidate
  }
  return best?.[0] ?? null
}

/**
 * How much further apart two hands must travel, in palm lengths, before a
 * perforation gives.
 *
 * A perforation is torn with BOTH hands pulling in opposite directions, which
 * is the one thing about it that is not like tearing a raw edge — you hold the
 * paper still on one side of the dotted line and pull the other side away. So
 * the measurement is the GROWTH in the gap between the hands rather than how
 * far either one moved: two hands travelling together across the frame is the
 * sheet being carried, not ripped.
 *
 * In palms rather than pixels so that leaning toward the camera does not tear
 * the paper.
 */
export const PERF_PULL = 1.5

export function ripsApart(startGap: number, gap: number): boolean {
  return gap - startGap > PERF_PULL
}

/**
 * The same crease line, named so that the SMALLER side is the one that moves.
 *
 * `fold` displaces everything beyond its hinge in the travel direction — `s =
 * d - offset; if (s <= 0) return` — so which half of the sheet swings is
 * decided entirely by which way `angle` points. `creaseFromDrag` wraps into a
 * canonical half-turn, and that wrap is blind to this: a line scored below
 * the centre comes back with a negative offset, and folding it rotates the
 * whole sheet about a line near its bottom edge instead of lifting the strip
 * below it.
 *
 * `(angle, offset)` and `(angle + 180, -offset)` are the same physical line,
 * so choosing the one with a non-negative offset costs nothing and picks the
 * flap a person would actually lift.
 */
export function foldAlong(crease: Crease): { angle: number; offset: number } {
  return crease.offset < 0
    ? { angle: crease.angle + 180, offset: -crease.offset }
    : { angle: crease.angle, offset: crease.offset }
}

/** The four corners, named as `peel` names them. */
export const paperCorners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const
export type PaperCorner = (typeof paperCorners)[number]

/** Within this fraction of BOTH edges, a grab counts as being on that corner. */
export const CORNER_MARGIN = 0.26

/**
 * Which corner a point is in, if it is in one at all.
 *
 * The vocabulary here is not short of hand POSES — it is short of meanings
 * per pose, and a pinch aimed at a corner does not mean what the same pinch
 * aimed at the middle of the sheet means. Paper is indexed by where you take
 * hold of it, which is why this and {@link nearestEdge} exist and why there
 * is no separate "peel gesture" to learn.
 *
 * Deliberately roomier than {@link nearestEdge}'s margin: a corner is a
 * target you aim at with a whole hand from a metre away.
 */
export function nearestCorner(point: UV, margin = CORNER_MARGIN): PaperCorner | null {
  const left = point.u < margin
  const right = point.u > 1 - margin
  const bottom = point.v < margin
  const top = point.v > 1 - margin
  if (!(left || right) || !(top || bottom)) return null
  return `${top ? 'top' : 'bottom'}-${left ? 'left' : 'right'}`
}
