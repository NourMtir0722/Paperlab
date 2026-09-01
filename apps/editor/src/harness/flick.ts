import type { WashConfig } from 'paperlab'

/**
 * A flick, and the paint it throws.
 *
 * The library already has a full watercolour — `content.wash` is a real
 * pigment model with blooms, bleed, granulation and the edge darkening that
 * separates watercolour from an airbrush — and nothing has ever put it on
 * screen. A flick is the gesture that does, and it fits the medium: you load
 * a brush, you snap your wrist, and the paint leaves your hand. It is a
 * DISCRETE event, so it commits a wash rather than driving one.
 *
 * Telling a flick from a drag is the whole problem, because both are a pinch
 * that opens. Two things separate them and both are needed: a flick is FAST
 * at the moment it lets go, and it is BRIEF — you do not hold a flick. A yank
 * that tears an edge is fast too, but it is a pull you have been making for a
 * second by the time it gives, so the duration is what keeps a tear from
 * spattering the sheet.
 *
 * The tracker reports every release and leaves that judgement to the page,
 * because the same snap with the SHEET in your hand is a throw rather than a
 * flick — and there the duration says nothing, since you can hold a sheet as
 * long as you like and still whip it away at the end.
 */

/**
 * A pinch opening — every one of them, fast or slow, brief or held.
 *
 * The tracker reports the release and does not judge it, because the same
 * snap means two different things depending on what was in the hand: with the
 * sheet held it throws the SHEET, and in free air it throws paint. Only the
 * page knows which, so only the page decides — see {@link isFlick}.
 */
export interface Release {
  /**
   * How fast the hand was going, in PALM LENGTHS a second.
   *
   * In palms because that is the ruler everything else in this harness uses,
   * and for the reason `landmarks.ts` gives for using it: a hand leaning
   * toward the camera covers more of the frame without moving any faster, and
   * a gesture defined by speed must not fire because somebody sat forward.
   * This was the one measurement here still taken in camera widths.
   *
   * And aspect-corrected, which the same measurement was not. Normalised
   * landmarks divide x by the frame's WIDTH and y by its HEIGHT, so on a 4:3
   * camera a vertical snap has to be a third faster than a horizontal one to
   * report the same number — the flick had a preferred direction and nobody
   * had noticed, because every scripted flick in the tests travels sideways.
   */
  speed: number
  /** Direction of travel, aspect-corrected — mirrored, see `washFromFlick`. */
  dx: number
  dy: number
  /** How long the pinch was closed. A flick is brief; a pull is not. */
  heldMs: number
}

/** What `washFromFlick` needs, which is a release minus the part it ignores. */
export type Flick = Omit<Release, 'heldMs'>

/**
 * Whether a release was a FLICK — brief as well as fast.
 *
 * The duration is what keeps tearing an edge from spattering the sheet: a
 * yank is fast when it finally gives, but it is a pull you have been making
 * for a second by then. It is deliberately not applied to a throw, where the
 * duration says nothing: you can hold a sheet for as long as you like and
 * still whip it away at the end.
 */
export function isFlick(release: Release): boolean {
  return release.speed >= FLICK_SPEED && release.heldMs <= FLICK_HOLD_MS
}

/** How far back to look when measuring the release. */
export const FLICK_WINDOW_MS = 140

/**
 * Palm lengths a second. A deliberate snap clears this; a drag does not.
 *
 * A palm is about 10cm, so this is a hand moving at roughly 60cm a second.
 * A wrist snap manages three times that and a drag across the sheet is well
 * under half of it, which is the gap this sits in the middle of.
 */
export const FLICK_SPEED = 6

/** Longer than this and the pinch was a hold, whatever speed it ended at. */
export const FLICK_HOLD_MS = 600

interface Sample {
  /** Aspect-corrected camera coordinates — see {@link Release.speed}. */
  x: number
  y: number
  t: number
}

/**
 * Watches one hand's pinch for the moment it opens.
 *
 * Stateful because a flick is a transition, not a pose. Feed it every frame;
 * it answers with a flick on the single frame the snap completes and `null`
 * on every other.
 */
export class FlickTracker {
  private samples: Sample[] = []
  private closedAt: number | null = null
  /** The most recent palm length, which is what the release is measured in. */
  private palm = 1

  /**
   * Feed one frame.
   *
   * `palm` is the hand's own wrist-to-knuckle span, the ruler the release is
   * measured in; a frame without one is a frame without a hand, and is treated
   * as such. `aspect` squares the camera's coordinates up so that a snap means
   * the same thing in every direction.
   */
  push(
    anchor: { x: number; y: number } | null,
    closed: boolean,
    now: number,
    aspect: number,
    palm: number | null,
  ): Release | null {
    if (!anchor || palm === null || palm <= 0) {
      this.samples = []
      this.closedAt = null
      return null
    }
    this.palm = palm

    // Time going BACKWARDS means this is not the same clock — the harness
    // drives `drive()` with its own timestamps so a flick can be scripted
    // exactly, and the samples left over from a wall-clock run are then all
    // in the future. Trimming by age cannot see that (the differences come
    // out negative and nothing is dropped), and the speed computed across the
    // seam is negative seconds, which reads as no flick at all. Start again.
    if (this.samples.length > 0 && now < this.samples.at(-1)!.t) {
      this.samples = []
      this.closedAt = null
    }
    this.samples.push({ x: anchor.x * aspect, y: anchor.y, t: now })
    while (this.samples.length > 1 && now - this.samples[0]!.t > FLICK_WINDOW_MS) this.samples.shift()

    if (closed) {
      this.closedAt ??= now
      return null
    }

    const closedAt = this.closedAt
    this.closedAt = null
    if (closedAt === null) return null

    const first = this.samples[0]!
    const last = this.samples.at(-1)!
    const seconds = (last.t - first.t) / 1000
    if (seconds <= 0) return null
    const dx = last.x - first.x
    const dy = last.y - first.y
    return { speed: Math.hypot(dx, dy) / this.palm / seconds, dx, dy, heldMs: now - closedAt }
  }

  reset(): void {
    this.samples = []
    this.closedAt = null
    this.palm = 1
  }
}

/**
 * Four pigment pairs, chosen by which way the paint went.
 *
 * Pairs rather than single colours because the wash alternates between them
 * and multiplies the overlaps into a third — the reason it reads as pigment
 * in water rather than as two gradients.
 */
export const PIGMENTS = [
  { color: '#3f5aa6', secondary: '#b8615f' }, // →  indigo and rose
  { color: '#c08a3e', secondary: '#6f7a45' }, // ↓  ochre and olive
  { color: '#2f7d7a', secondary: '#7a5aa6' }, // ←  teal and violet
  { color: '#a83a45', secondary: '#d0a24a' }, // ↑  crimson and gold
] as const

/** Speed at which a flick is throwing as much paint as it ever will, in palms a second. */
const FASTEST = 18

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t))
}

/**
 * The wash a flick lays down.
 *
 * Direction picks the pigment, speed sets how much of it lands. The direction
 * is read in SCREEN terms — the camera image is mirrored, so a flick to your
 * right travels toward decreasing camera x — because the pigment that appears
 * should be the one the gesture aimed at.
 *
 * `seed` is the caller's, and it has to change between flicks: the wash is a
 * pure function of its options, so two flicks with the same seed paint the
 * same picture twice and read as nothing having happened.
 */
export function washFromFlick(flick: Flick, seed: number): WashConfig {
  const angle = Math.atan2(flick.dy, -flick.dx)
  // Four quadrants centred on the axes rather than straddling them, so a
  // flick straight along one direction is unambiguously that direction.
  const quadrant = Math.round(angle / (Math.PI / 2) + 4) % 4
  const pigment = PIGMENTS[quadrant]!
  const hard = (flick.speed - FLICK_SPEED) / (FASTEST - FLICK_SPEED)
  return {
    color: pigment.color,
    secondary: pigment.secondary,
    // A harder flick throws more, smaller pools; a lazy one leaves a few big
    // ones. That is the difference between spattering and pouring.
    blooms: Math.round(lerp(4, 14, hard)),
    spread: lerp(0.75, 0.4, hard),
    bleed: lerp(0.65, 0.35, hard),
    intensity: lerp(0.35, 0.85, hard),
    // Not driven by the flick: the ring of pigment left where a pool dried is
    // the signature of the medium, and turning it down turns watercolour into
    // an airbrush whatever else is set.
    edge: 0.7,
    granulation: 0.45,
    seed: ((seed % 100) + 100) % 100,
  }
}
