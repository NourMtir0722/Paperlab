import { FINGERS, fingerCurl, handCurl, isExtended, pinchAperture, type Landmark } from './landmarks'

/**
 * What the hand is doing, as a name and a few numbers.
 *
 * The names are chosen to match what the paper can actually be asked to do,
 * not to be a general hand-gesture library: a pinch takes hold, a fist
 * crushes, a point marks, an open palm is the resting state that means "not
 * now". Anything ambiguous is `none`, deliberately — a gesture layer that
 * guesses is worse than one that waits, because the paper keeps whatever it
 * was told and a wrong guess has to be undone by hand.
 */
export type GestureName = 'none' | 'pinch' | 'fist' | 'point' | 'palm'

export interface GestureFrame {
  name: GestureName
  /** Thumb-to-index in palm lengths; null when no hand is readable. */
  aperture: number | null
  /** Whole hand, 0 = flat open, 1 = tight fist. Drives a crush continuously. */
  curl: number | null
  /** Middle, ring and pinky only — the fingers a pinch does not use. */
  grasp: number | null
}

/** No readable hand. Exported so a caller with no hand at all can say so. */
export const NO_GESTURE: GestureFrame = { name: 'none', aperture: null, curl: null, grasp: null }

const EMPTY = NO_GESTURE

/**
 * Pinch thresholds, in palm lengths. Closing tighter than it opens is what
 * stops a hand held at the boundary from emitting a burst of grab/release
 * pairs — which the sim reads as repeatedly re-grabbing whichever particle
 * is nearest, and which looks like the paper snagging.
 */
const PINCH_CLOSE_AT = 0.45
const PINCH_OPEN_AT = 0.7

/**
 * How curled the three non-pinching fingers must be for the hand to count as
 * closed. This is the measurement that separates a fist from a pinch, and it
 * is needed because the obvious one does not work: in a fist the thumb and
 * index are ALSO touching, so the aperture alone reads a fist as a pinch.
 */
const GRASP_CLOSED = 0.7
const GRASP_OPEN = 0.35

/** Frames a new gesture must persist before it takes over. */
const HOLD_FRAMES = 3

/** Middle, ring and pinky — a pinch leaves them alone, a fist does not. */
function graspCurl(hand: readonly Landmark[], aspect: number): number | null {
  let total = 0
  for (const finger of FINGERS.slice(1)) {
    const curl = fingerCurl(hand, finger, aspect)
    if (curl === null) return null
    total += curl
  }
  return total / (FINGERS.length - 1)
}

/**
 * The pose, before any smoothing. `wasPinching` only widens the pinch
 * threshold — it never invents a gesture that the hand is not making.
 */
export function classify(hand: readonly Landmark[], aspect: number, wasPinching: boolean): GestureFrame {
  const aperture = pinchAperture(hand, aspect)
  const curl = handCurl(hand, aspect)
  const grasp = graspCurl(hand, aspect)
  if (aperture === null || curl === null || grasp === null) return EMPTY

  const frame = { aperture, curl, grasp }
  const indexOut = isExtended(hand, FINGERS[0], aspect)

  // Order matters. A point and a fist share three curled fingers and are told
  // apart only by the index, so the index has to be asked first.
  if (grasp > GRASP_CLOSED && indexOut) return { ...frame, name: 'point' }
  if (grasp > GRASP_CLOSED) return { ...frame, name: 'fist' }
  if (aperture < (wasPinching ? PINCH_OPEN_AT : PINCH_CLOSE_AT)) return { ...frame, name: 'pinch' }
  if (grasp < GRASP_OPEN && aperture >= PINCH_OPEN_AT) return { ...frame, name: 'palm' }
  return { ...frame, name: 'none' }
}

/**
 * Classification, steadied over time.
 *
 * A tracker that loses a fingertip for one frame should not drop the paper,
 * so a new gesture has to hold for a few frames before it takes over. The
 * exception is LETTING GO, which is immediate: a release that lags reads as
 * the paper being stuck to your hand, and no amount of stability is worth
 * that.
 */
export class GestureReader {
  private current: GestureName = 'none'
  private candidate: GestureName = 'none'
  private streak = 0

  read(hand: readonly Landmark[] | null, aspect: number): GestureFrame {
    if (!hand) {
      this.current = 'none'
      this.candidate = 'none'
      this.streak = 0
      return EMPTY
    }

    const frame = classify(hand, aspect, this.current === 'pinch')

    // Letting go happens the frame it happens.
    if (this.current === 'pinch' && frame.name !== 'pinch') {
      this.current = frame.name
      this.candidate = frame.name
      this.streak = 0
      return frame
    }

    if (frame.name === this.candidate) {
      this.streak++
    } else {
      this.candidate = frame.name
      this.streak = 1
    }
    if (this.streak >= HOLD_FRAMES) this.current = this.candidate

    return { ...frame, name: this.current }
  }

  /** Forget the hand — used when tracking stops, so nothing stays held. */
  reset(): void {
    this.current = 'none'
    this.candidate = 'none'
    this.streak = 0
  }
}
