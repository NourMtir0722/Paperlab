import { z } from 'zod'

/**
 * The walk — a path across the ground plane that a figure follows and that
 * layouts arrange paper along. Pure 2D math (x, z on the floor, y is always
 * up), no three.js, so it tests in node and is cheap enough to call from
 * inside a layout's pure `pose`.
 *
 * Centripetal Catmull-Rom through the control points — it will not cusp or
 * overshoot when two points bunch together, which a uniform spline does —
 * resampled to a uniform arc-length polyline. That resampling is the point:
 * `pointAt(s)` advances at constant SPEED, so a figure stepping `s` forward
 * at a steady rate covers ground at a steady rate. A raw spline parameter
 * would have it sprint through the straights and crawl around the corners.
 */

/** A point on the floor. */
export type Ground = [x: number, z: number]

export const walkPathSchema = z.object({
  /**
   * Control points on the ground plane, [x, z]. The default walks away from
   * the camera down -Z — the shot every reference image is composed on.
   */
  points: z
    .array(z.tuple([z.number(), z.number()]))
    .min(2)
    .default([
      [0, 9],
      [0, -9],
    ]),
  /** Join the last point back to the first: an endless walk, and the only form `phase` can slide. */
  closed: z.boolean().default(false),
})

export type WalkPathOptions = z.infer<typeof walkPathSchema>

export interface WalkPath {
  /** Total arc length in world units. */
  readonly length: number
  readonly closed: boolean
  /** `s` is normalized arc length: 0 = the start, 1 = the end. Closed paths wrap, open paths clamp. */
  pointAt(s: number): Ground
  /** Unit forward direction at `s`. */
  tangentAt(s: number): Ground
  /** Unit LEFT-hand normal at `s` — the side of the aisle a walker's left hand points to. */
  normalAt(s: number): Ground
}

/** Polyline resolution. 24 per segment holds a tight curve to well under a millimetre of chord error. */
const SAMPLES_PER_SEGMENT = 24

/** Coincident control points would collapse the knot spacing and divide by zero. */
const EPSILON = 1e-6

/** Centripetal: alpha = 0.5. (0 would be uniform, 1 chordal.) */
const ALPHA = 0.5

function knot(a: Ground, b: Ground, t: number): number {
  return t + Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), EPSILON) ** ALPHA
}

/** Linear interpolation in knot space — the Barry-Goldman building block. */
function lerpKnot(a: Ground, b: Ground, ta: number, tb: number, t: number): Ground {
  const span = tb - ta
  const k = span === 0 ? 0 : (t - ta) / span
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
}

/** One centripetal Catmull-Rom segment p1→p2, `u` in 0..1. */
function segmentPoint(p0: Ground, p1: Ground, p2: Ground, p3: Ground, u: number): Ground {
  const t0 = 0
  const t1 = knot(p0, p1, t0)
  const t2 = knot(p1, p2, t1)
  const t3 = knot(p2, p3, t2)
  const t = t1 + (t2 - t1) * u
  const a1 = lerpKnot(p0, p1, t0, t1, t)
  const a2 = lerpKnot(p1, p2, t1, t2, t)
  const a3 = lerpKnot(p2, p3, t2, t3, t)
  const b1 = lerpKnot(a1, a2, t0, t2, t)
  const b2 = lerpKnot(a2, a3, t1, t3, t)
  return lerpKnot(b1, b2, t1, t2, t)
}

/** The phantom control point beyond an open path's end: reflect the interior neighbor. */
function reflect(end: Ground, inner: Ground): Ground {
  return [2 * end[0] - inner[0], 2 * end[1] - inner[1]]
}

export function createWalkPath(options: WalkPathOptions): WalkPath {
  const pts = options.points as Ground[]
  const n = pts.length
  const closed = options.closed && n > 2
  const segments = closed ? n : n - 1

  // Resample the spline into a uniformly-indexed polyline, carrying the
  // cumulative arc length so `s` can be inverted by search.
  const samples: Ground[] = []
  const cumulative: number[] = []
  let total = 0
  for (let seg = 0; seg < segments; seg++) {
    const p1 = pts[seg]!
    const p2 = pts[(seg + 1) % n]!
    const p0 = closed ? pts[(seg - 1 + n) % n]! : seg > 0 ? pts[seg - 1]! : reflect(pts[0]!, pts[1]!)
    const p3 = closed ? pts[(seg + 2) % n]! : seg + 2 < n ? pts[seg + 2]! : reflect(pts[n - 1]!, pts[n - 2]!)
    // The last sample of a segment is the first of the next — emit it only
    // at the very end of an open path, where nothing follows to repeat it.
    const last = seg === segments - 1 && !closed ? SAMPLES_PER_SEGMENT : SAMPLES_PER_SEGMENT - 1
    for (let k = 0; k <= last; k++) {
      const point = segmentPoint(p0, p1, p2, p3, k / SAMPLES_PER_SEGMENT)
      const previous = samples[samples.length - 1]
      if (previous) total += Math.hypot(point[0] - previous[0], point[1] - previous[1])
      samples.push(point)
      cumulative.push(total)
    }
  }
  if (closed) {
    // Close the ring: the start point repeats as the final sample so a
    // search near s = 1 has a segment to land in.
    const first = samples[0]!
    const previous = samples[samples.length - 1]!
    total += Math.hypot(first[0] - previous[0], first[1] - previous[1])
    samples.push([first[0], first[1]])
    cumulative.push(total)
  }

  const length = total

  function normalize(s: number): number {
    if (!Number.isFinite(s)) return 0
    if (!closed) return Math.min(Math.max(s, 0), 1)
    const wrapped = s - Math.floor(s)
    return wrapped
  }

  function pointAt(s: number): Ground {
    const target = normalize(s) * length
    if (length === 0) return [samples[0]![0], samples[0]![1]]
    // Binary search for the first sample at or past the target distance.
    let low = 0
    let high = cumulative.length - 1
    while (low < high) {
      const mid = (low + high) >> 1
      if (cumulative[mid]! < target) low = mid + 1
      else high = mid
    }
    const i = Math.max(low, 1)
    const before = cumulative[i - 1]!
    const span = cumulative[i]! - before
    const k = span <= 0 ? 0 : (target - before) / span
    const a = samples[i - 1]!
    const b = samples[i]!
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
  }

  /** Central difference over a fixed world-space step — stable at any path length. */
  function tangentAt(s: number): Ground {
    const ds = length > 0 ? Math.min(0.01, 0.5 / length) : 0.01
    const here = normalize(s)
    const a = pointAt(closed ? here - ds : Math.max(here - ds, 0))
    const b = pointAt(closed ? here + ds : Math.min(here + ds, 1))
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const len = Math.hypot(dx, dz)
    // A degenerate path has no direction to report; -Z is the house forward.
    return len < EPSILON ? [0, -1] : [dx / len, dz / len]
  }

  function normalAt(s: number): Ground {
    const [tx, tz] = tangentAt(s)
    // Left of forward, with +Y up: right = forward × up, so left is its negation.
    return [tz, -tx]
  }

  return { length, closed, pointAt, tangentAt, normalAt }
}

/**
 * Building the arc-length table costs a few hundred flops, and `pose` runs
 * per sheet per frame — so paths are memoized by value. Same options in,
 * same object out, which keeps layouts pure from the outside.
 */
const cache = new Map<string, WalkPath>()
const CACHE_LIMIT = 32

export function getWalkPath(options: WalkPathOptions): WalkPath {
  const key = `${options.closed ? 'c' : 'o'}|${options.points.map((p) => `${p[0]},${p[1]}`).join(';')}`
  const hit = cache.get(key)
  if (hit) return hit
  const path = createWalkPath(options)
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, path)
  return path
}
