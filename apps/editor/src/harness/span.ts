/**
 * Sizing the sheet by how far apart your hands are.
 *
 * The gesture everyone tries first, and the one with the most library
 * underneath it: `sheet.width` and `sheet.height` are a GEOMETRY dependency,
 * so changing them rebuilds the mesh — and, in cloth, the sim with it. Which
 * of those matters depends entirely on what the sheet is:
 *
 *   - as a SHAPE, a rebuild is invisible. A deformer is a pure function of
 *     its options, so the sheet simply redraws at the new size with the fold
 *     or the crush exactly where it was.
 *   - as a SIMULATION, a rebuild used to throw the drape away and start flat.
 *     `ClothSim.adopt` carries it over now, which is what lets a hanging
 *     sheet be resized while it hangs.
 *
 * Two open hands rather than two pinches, because two pinches already mean
 * something: gripping the paper on both sides of a perforation and pulling it
 * in two. You do not grip a thing you are sizing — you frame it.
 */

/**
 * How far the sheet can be taken from the size it started at.
 *
 * The ceiling is set by the CAMERA, not by the schema — `sheet.width` goes to
 * 20 and the library's camera is fixed and head-on, so a sheet much past this
 * grows straight out of the frame and the gesture stops being visible. Both
 * ends sit exactly on the step grid below, so the range is reachable rather
 * than one rounding short of itself.
 */
export const SCALE_MIN = 0.44
export const SCALE_MAX = 1.64

/**
 * Published in steps, and coarse ones.
 *
 * Every step is a new mesh — and in cloth a new sim — so this is the most
 * expensive number on the page to change. Twenty-odd sizes across the whole
 * range is more than anyone can aim at, and it turns a continuous gesture
 * into a few rebuilds instead of one every frame.
 */
export const SCALE_STEP = 0.08

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * Snapped to a grid anchored at 1, not at 0.
 *
 * Anchoring at zero leaves the sheet's own size off the grid — 1 would round
 * to 1.04 — so the first step of a resize jumps before the hands have really
 * moved, and the size can never be put back exactly.
 */
export function quantiseScale(scale: number): number {
  return Math.round((1 + Math.round((scale - 1) / SCALE_STEP) * SCALE_STEP) * 100) / 100
}

/**
 * The scale two hands are asking for.
 *
 * Relative, like the stock dial and for the same reason: the gesture is
 * SPREADING your hands, not holding them at some absolute width. Raising them
 * anchors wherever they happen to be, so the sheet does not jump the moment
 * they come up, and lowering them keeps the size they left it at.
 */
export class Span {
  private from: number | null = null
  private scale = 1

  /** Feed the gap between the hands in palm lengths, or `null` for no span. */
  push(gap: number | null): number {
    if (gap === null || gap <= 0) {
      this.from = null
      return this.scale
    }
    // Anchored against the CURRENT scale, so picking the gesture back up
    // continues from the size the sheet is rather than resetting it.
    this.from ??= gap / this.scale
    const raw = clamp(gap / this.from, SCALE_MIN, SCALE_MAX)
    if (Math.abs(raw - this.scale) > SCALE_STEP * 0.6) this.scale = quantiseScale(raw)
    return this.scale
  }

  get value(): number {
    return this.scale
  }

  /** Whether a span is being held right now — the sheet is being sized. */
  get engaged(): boolean {
    return this.from !== null
  }

  reset(): void {
    this.from = null
    this.scale = 1
  }
}
