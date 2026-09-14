import { palmsApart } from './landmarks'

/**
 * The match: a pinch held still in free air.
 *
 * The vocabulary ran out of poses long ago, and the way out has always been
 * the same one — a pinch means what WHERE and WHEN say it means. A pinch on
 * the paper takes hold of it. A pinch that opens fast throws paint. A pinch
 * held still over nothing is a hand holding something small, and what it is
 * holding is a match.
 *
 * **The dwell is not a nicety, it is the whole thing.** A flick starts as a
 * pinch, so without a dwell every snap of the fingers would summon a match on
 * its way past and the page would catch fire whenever somebody painted. The
 * two are separated by exactly what separates them physically: a flick MOVES
 * and a held match does not.
 *
 * It goes out the way a match goes out: let go of the pinch, or blow it out.
 * There is no button, no mode and no undo — see the fx plan on consequence.
 */

/** How long a pinch has to be held still in free air before it is a match. */
export const MATCH_DWELL_MS = 320

/**
 * How far it may drift while it arms, in palm lengths.
 *
 * Generous on purpose: a hand holding still is not still, and a threshold
 * tight enough to be sure would mean nobody could ever light one. A flick
 * crosses this many times over — `FLICK_SPEED` is measured in palms a second
 * and a flick is over in a fraction of one.
 */
export const MATCH_STILL = 0.5

/**
 * How hard you have to blow to put it out.
 *
 * Raised from 0.3, and paired with {@link BLOW_RISE}, because the first
 * version could not be lit at all by some people. `mouthPucker` does not read
 * zero on a resting face — lighting, a beard, the shape of a mouth all move
 * it — and a viewer whose rest sat above the old threshold had every match
 * blown out on the frame it lit, with nothing on screen saying why.
 */
export const BLOW_OUT = 0.55

/**
 * How much harder than it already was you have to blow, on top of that.
 *
 * A level alone cannot tell blowing from a face that always reads high. A
 * RISE can, whatever the rest reads: the match remembers what the breath was
 * when it lit, and only goes out if it climbs from there.
 */
export const BLOW_RISE = 0.15

export type MatchState = 'none' | 'arming' | 'lit'

export interface MatchInput {
  /** Is the acting hand pinching? */
  pinching: boolean
  /** Where the pinch is, in the camera's own coordinates. */
  at: { x: number; y: number } | null
  /** The hand's own ruler — drift is measured in palms, like everything here. */
  palm: number | null
  /** How hard the viewer is blowing, 0..1. */
  blow: number
  now: number
  aspect: number
}

export class Match {
  private state: MatchState = 'none'
  private origin: { x: number; y: number } | null = null
  private since = 0
  /**
   * Blown out, and not to be relit until the hand lets go.
   *
   * There used to be a second latch beside this one: a pinch that touched the
   * paper was a GRAB until the hand opened, so a tear that pulled off the
   * sheet's edge could not turn into a match half way. The grab went with the
   * rest of the gestures, and the latch stayed behind doing harm — it made
   * the sheet, the one place anyone aims a match, the one place a match would
   * not light.
   */
  private blownOut = false
  /** What the breath read when this match lit — see {@link BLOW_RISE}. */
  private blowWhenLit = 0

  get lit(): boolean {
    return this.state === 'lit'
  }

  push(input: MatchInput): MatchState {
    const { pinching, at, palm, blow, now, aspect } = input

    // Let go of the pinch and you have let go of the match. A new pinch may
    // light another one.
    if (!pinching || !at) {
      this.state = 'none'
      this.origin = null
      this.blownOut = false
      return this.state
    }

    // A lit match survives being moved — being moved over the paper is the
    // entire point of holding one.
    if (this.state === 'lit') {
      if (blow >= BLOW_OUT && blow >= this.blowWhenLit + BLOW_RISE) {
        this.state = 'none'
        this.origin = null
        // Out until the hand opens: a blow that merely paused it would let it
        // relight the moment the blowing stopped, with the pinch still held,
        // and blowing a flame out would not mean anything.
        this.blownOut = true
      }
      return this.state
    }

    // One already blown out stays out.
    if (this.blownOut) {
      this.state = 'none'
      this.origin = null
      return this.state
    }

    // Arming: still, anywhere — over the paper or beside it — for long enough. Any real drift starts the
    // clock again rather than failing outright — a hand that settles after
    // wandering is a hand holding still.
    const drift = this.origin && palm ? palmsApart(at, this.origin, palm, aspect) : 0
    if (!this.origin || drift > MATCH_STILL) {
      this.origin = at
      this.since = now
      this.state = 'arming'
      return this.state
    }
    if (now - this.since >= MATCH_DWELL_MS) {
      this.state = 'lit'
      this.blowWhenLit = blow
    } else {
      this.state = 'arming'
    }
    return this.state
  }

  reset(): void {
    this.state = 'none'
    this.origin = null
    this.since = 0
    this.blownOut = false
  }
}
