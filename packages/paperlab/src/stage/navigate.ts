import { z } from 'zod'

/**
 * Moving through a stage.
 *
 * The scene was a picture you watched: the camera is stationed on the walk,
 * the walk is driven by `progress`, and if nobody supplied one it ran on a
 * clock. There was nothing to touch. This is the other half — the viewer
 * drives the walk themselves, by dragging, by wheel, by arrow key, or by
 * clicking the paper they want to stand in front of.
 *
 * It drives ONE number: distance walked. Everything else in the scene is
 * already derived from that — the figure, the camera, the light at the end —
 * so navigation cannot pull the parts of the scene away from each other,
 * which is the failure this whole component is arranged to prevent. In
 * particular the camera is still not something anything else may move: there
 * is no orbit here, and dragging does not look around. It walks.
 *
 * Pure math lives here so it tests in node; the listeners are in `useWalk`.
 */

export const stageMotionSchema = z.object({
  /**
   * Who drives the walk. Same three names as a field's, and they mean the
   * same things — a stage and a field are the same contract seen from two
   * distances.
   *
   * - `drag` — the viewer. Pointer, wheel, arrow keys, or a click on a paper.
   *   It DRIFTS on the clock until the first time they touch it, and then it
   *   is theirs for good. That is one behaviour rather than two drivers, and
   *   it is the default because the alternatives are each half wrong: a stage
   *   that only autoplays cannot be touched, and one that only waits opens as
   *   a still photograph of itself.
   * - `autoplay` — the clock, and only the clock. It never hands over.
   * - `none` — nothing. The walk stands wherever it was left.
   *
   * An explicit `progress` prop outranks all three: a stage bound to page
   * scroll is a controlled component, and a driver fighting the page for the
   * same number is the bug you would spend an afternoon on.
   */
  driver: z.enum(['autoplay', 'drag', 'none']).default('drag'),
  /** Multiplier on the pace: the figure's walking speed for `autoplay`, the hand for `drag`. */
  speed: z.number().min(0).max(6).default(1),
  /**
   * Whether the walk takes the WHEEL and the TOUCH away from the page.
   *
   * True for a stage that fills the screen — it is the page, so there is
   * nothing to take it from. False for one sitting in a column of prose,
   * where capturing them means a reader who scrolls past it has their scroll
   * eaten and a reader on a phone has their finger trapped. Dragging with a
   * mouse and stepping with the arrow keys work either way, because neither
   * is a gesture the page also wants.
   *
   * Even when captured, the wheel is handed BACK at the ends of an open
   * walk: scrolling past the last banner should carry on down the page
   * rather than press silently into a wall.
   */
  capture: z.boolean().default(true),
})

export type StageMotion = z.infer<typeof stageMotionSchema>
export type StageMotionInput = z.input<typeof stageMotionSchema>

/**
 * How far a drag of one pixel carries you, as a fraction of the whole walk.
 *
 * Set from the gesture rather than from the world: a full-height drag on a
 * laptop is roughly 800px, and it should cover a good stretch of the hall
 * without throwing you to the far end — a fifth of it. Scaling by the walk's
 * LENGTH instead would make a long walk feel like treacle and a short one
 * uncontrollable, since the hand doing the dragging is the same size either
 * way.
 */
const WALK_PER_PIXEL = 0.2 / 800

/** A wheel notch is ~100 deltaY; make one notch a comfortable pace. */
const WALK_PER_WHEEL = 0.2 / 1400

/**
 * How fast a flick dies, as a time constant in seconds. Long enough that a
 * throw coasts and reads as weight, short enough that letting go never feels
 * like losing the wheel.
 */
const COAST_TAU = 0.32

/** Below this, in walks per second, coasting has stopped. */
const COAST_FLOOR = 0.0015

/**
 * Distance covered by a drag, in normalized walk. Dragging UP goes forward,
 * as pushing a page up does.
 *
 * Vertical only, and it takes only the axis it uses: a diagonal drag reading
 * off both would do something neither axis promised, and every scroll
 * convention this borrows from — the page, the reel, the deck — is
 * one-dimensional.
 */
export function dragWalk(dy: number, speed: number): number {
  return -dy * WALK_PER_PIXEL * speed
}

/** Distance covered by a wheel event. Wheel down goes forward, as on a page. */
export function wheelWalk(deltaY: number, speed: number): number {
  return deltaY * WALK_PER_WHEEL * speed
}

/** A flick's remaining velocity after `dt`, or exactly zero once it is spent. */
export function coast(velocity: number, dt: number): number {
  const next = velocity * Math.exp(-dt / COAST_TAU)
  return Math.abs(next) < COAST_FLOOR ? 0 : next
}

/**
 * Keep a position on the walk.
 *
 * A closed walk wraps, because it has no ends. An open one CLAMPS — dragging
 * past the last banner into unlit nothing is not a place the stage has
 * anything to show, and the camera extrapolates straight past the end of the
 * path rather than stopping, so without this the viewer can pull themselves
 * out of the room entirely.
 */
export function holdOnWalk(walk: number, closed: boolean): number {
  if (!closed) return Math.min(1, Math.max(0, walk))
  return ((walk % 1) + 1) % 1
}

/**
 * The stop before or after where you are.
 *
 * Ties are broken FORWARD deliberately: standing exactly on a stop and
 * pressing "next" has to move you, and floating point means "exactly" is a
 * question of the last bit. The epsilon is what stops an arrow key from
 * landing you back where you started.
 */
export function nextStop(stops: readonly number[], from: number, direction: 1 | -1, closed = false): number {
  if (stops.length === 0) return from
  const sorted = [...stops].sort((a, b) => a - b)
  const EPS = 1e-4
  const found =
    direction > 0 ? sorted.find((s) => s > from + EPS) : [...sorted].reverse().find((s) => s < from - EPS)
  if (found !== undefined) return found
  // Off the end: a closed walk comes round, an open one stays at the last one
  // it has rather than snapping to the other end of the room.
  if (closed) return direction > 0 ? sorted[0]! : sorted[sorted.length - 1]!
  return direction > 0 ? sorted[sorted.length - 1]! : sorted[0]!
}

/** The stop nearest a position — where a release settles when snapping. */
export function nearestStop(stops: readonly number[], from: number): number {
  if (stops.length === 0) return from
  return stops.reduce((best, s) => (Math.abs(s - from) < Math.abs(best - from) ? s : best), stops[0]!)
}

/** How long a step between stops takes, seconds. */
export const TRAVEL_SECONDS = 0.75

/**
 * Ease for a step: fast out of the old stop, gentle into the new one.
 *
 * A step between two banners is a camera move, and a camera move that starts
 * and ends abruptly reads as a cut that failed. This is the standard
 * smootherstep — zero velocity AND zero acceleration at both ends, so the
 * move has no visible seam at either.
 */
export function travelEase(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * x * (x * (x * 6 - 15) + 10)
}

/**
 * Interpolate along the walk the short way round.
 *
 * On a closed walk the two stops either side of the seam are ADJACENT, and
 * lerping their numbers takes the long way through the whole room. Stepping
 * from the last banner to the first has to be one step, not eighteen.
 */
export function travelBetween(from: number, to: number, t: number, closed: boolean): number {
  let delta = to - from
  if (closed) {
    if (delta > 0.5) delta -= 1
    if (delta < -0.5) delta += 1
  }
  return holdOnWalk(from + delta * t, closed)
}
