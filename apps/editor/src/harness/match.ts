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

/** How hard you have to blow to put it out. Well under a gale. */
export const BLOW_OUT = 0.3

export type MatchState = 'none' | 'arming' | 'lit'

export interface MatchInput {
  /** Is the acting hand pinching? */
  pinching: boolean
  /** Did the pinch land on the paper? That is a grab, and it stays a grab. */
  onPaper: boolean
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
  /** Blown out, and not to be relit until the hand lets go. */
  private blownOut = false

  get lit(): boolean {
    return this.state === 'lit'
  }

  push(input: MatchInput): MatchState {
    const { pinching, onPaper, at, palm, blow, now, aspect } = input

    // Let go of the pinch and you have let go of the match. A new pinch may
    // light another one.
    if (!pinching || !at) {
      this.state = 'none'
      this.origin = null
      this.blownOut = false
      return this.state
    }

    // A lit match survives being moved — and being moved OVER THE PAPER is
    // the entire point of holding one, so the grab test below cannot apply
    // to it.
    if (this.state === 'lit') {
      if (blow >= BLOW_OUT) {
        this.state = 'none'
        this.origin = null
        // Out until the hand opens: a blow that merely paused it would let it
        // relight the moment the blowing stopped, with the pinch still held,
        // and blowing a flame out would not mean anything.
        this.blownOut = true
      }
      return this.state
    }

    // A pinch that landed on the paper is a grab, and one already blown out
    // stays out.
    if (this.blownOut || onPaper) {
      this.state = 'none'
      this.origin = null
      return this.state
    }

    // Arming: still, in free air, for long enough. Any real drift starts the
    // clock again rather than failing outright — a hand that settles after
    // wandering is a hand holding still.
    const drift = this.origin && palm ? palmsApart(at, this.origin, palm, aspect) : 0
    if (!this.origin || drift > MATCH_STILL) {
      this.origin = at
      this.since = now
      this.state = 'arming'
      return this.state
    }
    this.state = now - this.since >= MATCH_DWELL_MS ? 'lit' : 'arming'
    return this.state
  }

  reset(): void {
    this.state = 'none'
    this.origin = null
    this.since = 0
    this.blownOut = false
  }
}
