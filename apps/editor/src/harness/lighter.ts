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
 * has been seen to move — which costs about a third of a second before the
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

const DEFAULTS: Required<LighterOptions> = { minShare: 0.0006, maxShare: 0.12, hold: 3, flicker: 0.05 }

/** How many frames of history the flicker is measured over — about a third of a second. */
const MEMORY = 10

/**
 * Is this pixel flame?
 *
 * Bright, and warm in the order a flame is: red over green over blue, with
 * the blue nearly gone. A white LED fails the last test, a warm wall fails
 * the first, and the yellow-white core of the flame itself passes on
 * brightness alone — which is why the blue bound is a fraction of green
 * rather than a fixed number.
 */
function isFlame(r: number, g: number, b: number): boolean {
  return r >= 180 && g >= 70 && g <= r * 0.95 && b <= g * 0.8
}

export class LighterWatch {
  private readonly o: Required<LighterOptions>
  /** The share of the frame that was flame, over the last {@link MEMORY} frames. */
  private readonly shares: number[] = []
  /** How many of the recent frames saw anything at all. */
  private seen = 0

  constructor(options: LighterOptions = {}) {
    this.o = { ...DEFAULTS, ...options }
  }

  /** Forget everything: the camera stopped, or the sheet is a fresh one. */
  reset(): void {
    this.shares.length = 0
    this.seen = 0
  }

  /**
   * Look at one frame of the camera, as RGBA rows from the top left — what
   * `CanvasRenderingContext2D.getImageData` hands back. Returns where the
   * flame is once it has been seen for long enough, or null.
   */
  see(pixels: Uint8ClampedArray | Uint8Array, width: number, height: number): FlameSighting | null {
    let count = 0
    let sx = 0
    let sy = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        if (!isFlame(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!)) continue
        count++
        sx += x
        sy += y
      }
    }
    const share = count / Math.max(1, width * height)
    const candidate = share >= this.o.minShare && share <= this.o.maxShare
    this.shares.push(candidate ? share : 0)
    if (this.shares.length > MEMORY) this.shares.shift()
    this.seen = this.shares.filter((s) => s > 0).length
    if (!candidate || this.seen < this.o.hold) return null
    // A lamp is a flame that never moves. Measured over the frames that saw
    // something, so a flame leaving the frame and coming back does not read
    // as a wobble all of its own.
    const lit = this.shares.filter((s) => s > 0)
    const mean = lit.reduce((sum, s) => sum + s, 0) / lit.length
    if (!(mean > 0)) return null
    const spread = Math.sqrt(lit.reduce((sum, s) => sum + (s - mean) ** 2, 0) / lit.length) / mean
    if (lit.length >= MEMORY && spread < this.o.flicker) return null
    return { x: sx / count / width, y: sy / count / height, share }
  }
}
