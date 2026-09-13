/**
 * A lighter, seen by the camera.
 *
 * The hand tracker knows where a hand is and nothing about what it is
 * holding. A flame, though, is the easiest thing in a room for a camera to be
 * sure about: it is the brightest thing in the frame, it is warm — red first,
 * green behind it, almost no blue — and, unlike a lamp or a window, it never
 * holds still. Those three together are the whole detector.
 *
 * The flicker is the part that earns its keep. Bright warm pixels alone call
 * a desk lamp, a candle-coloured bulb or sunlight on a wall a flame; a real
 * flame's pixel count wanders by a few percent from frame to frame while a
 * lamp's does not move at all. So a sighting is only reported once the count
 * has been seen to move — which costs about a quarter of a second before the
 * paper catches, and buys a page that does not light itself under a desk lamp.
 *
 * Pure arithmetic over a frame of pixels, so it runs in node under vitest and
 * the browser harness can drive it with a painted frame rather than a match.
 */

/** Where a flame is, in the frame's own coordinates: 0..1 from the left and the top. */
export interface FlameSighting {
  x: number
  y: number
  /** How much of the frame is flame, 0..1 — how close, or how big. */
  share: number
  /** The flame's extent in the frame, 0..1 from the left and the top — what the page draws a box round. */
  box: { x0: number; y0: number; x1: number; y1: number }
  /**
   * How sure the watch is, 0..1: how many of the recent frames saw it, and
   * how clearly it flickered. For the label on screen — the DECISION is the
   * hold and the flicker, and nothing reads this number to make it.
   */
  confidence: number
}

export interface LighterOptions {
  /** The least of the frame that counts as a flame rather than a speck of noise. */
  minShare?: number
  /**
   * And the most. Past this the "flame" is a lit wall, a window or a hand
   * held over the lens — a lighter at arm's length is a smudge, not a scene.
   */
  maxShare?: number
  /** How many of the last frames must have seen one before it is reported. */
  hold?: number
  /** How much the count has to wander to be a flame and not a lamp, as a fraction of itself. */
  flicker?: number
}

/**
 * Measured against the first real lighter this met, which the previous
 * numbers missed more often than they saw: a flame at arm's length is a
 * couple of dozen pixels of a 320×240 frame, a webcam's exposure clips most of
 * it to white, and a hand holding it still makes it flicker less than a flame
 * in a test does. So the floor on size is lower, the hold shorter, the
 * flicker gentler — and the white core counts, beside its warm fringe.
 */
const DEFAULTS: Required<LighterOptions> = { minShare: 0.0003, maxShare: 0.12, hold: 4, flicker: 0.03 }

/** How many frames of history the flicker is measured over — about half a second at the page's rate. */
const MEMORY = 8

/** The fewest warm pixels that make a fringe — below it, a white patch is only a white patch. */
const MIN_WARM = 3

/**
 * Is this pixel flame?
 *
 * Bright, and warm in the order a flame is: red over green over blue, with
 * the blue nearly gone. A white LED fails the last test and a warm wall the
 * first. The blue bound is a fraction of green, and a tight one, because the
 * warm thing a flame is most often confused with is a face lit by a warm
 * bulb — which is warm, bright, and moving, and keeps a good deal more blue
 * than a flame's fringe does.
 */
function isFlame(r: number, g: number, b: number): boolean {
  return r >= 200 && g >= 60 && g <= r * 0.94 && b <= g * 0.55 && r - b >= 110
}

/**
 * Is this pixel the white-hot core a webcam clips a flame to?
 *
 * On its own that is every lamp and every window, so it only counts inside
 * a warm fringe (see {@link LighterWatch.see}): a flame is white in the middle
 * and orange round the edge, and a lamp is white all the way out.
 */
function isCore(r: number, g: number, b: number): boolean {
  return r >= 240 && g >= 225 && b >= 150
}

export class LighterWatch {
  private readonly o: Required<LighterOptions>
  /** The share of the frame that was flame, over the last {@link MEMORY} frames. */
  private readonly shares: number[] = []

  constructor(options: LighterOptions = {}) {
    this.o = { ...DEFAULTS, ...options }
  }

  /** Forget everything: the camera stopped, or the sheet is a fresh one. */
  reset(): void {
    this.shares.length = 0
  }

  /**
   * Look at one frame of the camera, as RGBA rows from the top left — what
   * `CanvasRenderingContext2D.getImageData` hands back. Returns where the
   * flame is once it has been seen for long enough, or null.
   */
  see(pixels: Uint8ClampedArray | Uint8Array, width: number, height: number): FlameSighting | null {
    // The warm fringe first: where the flame is, and how big.
    let warm = 0
    let sx = 0
    let sy = 0
    let x0 = width
    let y0 = height
    let x1 = -1
    let y1 = -1
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        if (!isFlame(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!)) continue
        warm++
        sx += x
        sy += y
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }

    // Then the white core, but only in and around that fringe.
    let count = warm
    if (warm >= MIN_WARM) {
      const padX = Math.max(3, (x1 - x0) * 0.5)
      const padY = Math.max(3, (y1 - y0) * 0.5)
      const left = Math.max(0, Math.floor(x0 - padX))
      const right = Math.min(width - 1, Math.ceil(x1 + padX))
      const top = Math.max(0, Math.floor(y0 - padY))
      const bottom = Math.min(height - 1, Math.ceil(y1 + padY))
      for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
          const i = (y * width + x) * 4
          if (!isCore(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!)) continue
          count++
          sx += x
          sy += y
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
      }
    }

    const share = count / Math.max(1, width * height)
    const candidate = warm >= MIN_WARM && share >= this.o.minShare && share <= this.o.maxShare
    this.shares.push(candidate ? share : 0)
    if (this.shares.length > MEMORY) this.shares.shift()
    if (!candidate) return null

    // A lamp is a flame that never moves — and it has to have been seen NOT
    // moving before it can be ruled out, so the flicker is asked of every
    // sighting, not only once the history is full. It used to be only once
    // the history was full, which reported a steady warm lamp as a flame for
    // the first third of a second it was in view: harmless while a sighting
    // only aimed a flame, and a sheet set alight once a sighting started one.
    const lit = this.shares.filter((s) => s > 0)
    if (lit.length < this.o.hold) return null
    const mean = lit.reduce((sum, s) => sum + s, 0) / lit.length
    if (!(mean > 0)) return null
    const spread = Math.sqrt(lit.reduce((sum, s) => sum + (s - mean) ** 2, 0) / lit.length) / mean
    if (spread < this.o.flicker) return null

    const steady = Math.min(1, lit.length / MEMORY)
    const flick = Math.min(1, spread / (this.o.flicker * 4))
    return {
      x: sx / count / width,
      y: sy / count / height,
      share,
      box: { x0: x0 / width, y0: y0 / height, x1: (x1 + 1) / width, y1: (y1 + 1) / height },
      confidence: Math.min(0.99, 0.6 + 0.25 * steady + 0.14 * flick),
    }
  }
}
