/**
 * The hand, as geometry.
 *
 * Everything here is a pure function of 21 landmarks, and everything is
 * normalised by the hand's own palm so that leaning toward the camera does
 * not read as a gesture. No DOM, no library, no MediaPipe types — the shape
 * below is all the tracker's output is, and keeping it that way is what makes
 * every threshold in `gestures.ts` testable with numbers typed by hand.
 */

export interface Landmark {
  x: number
  y: number
  z: number
}

// The landmarks this code names. MediaPipe's full 21 are wrist, then four
// per digit (base → tip) starting at the thumb.
export const WRIST = 0
export const THUMB_TIP = 4
export const INDEX_TIP = 8
export const MIDDLE_MCP = 9

/** Base knuckle and tip of the four fingers, in order. Thumb excluded — it abducts rather than curls. */
export const FINGERS = [
  { mcp: 5, tip: 8 }, // index
  { mcp: 9, tip: 12 }, // middle
  { mcp: 13, tip: 16 }, // ring
  { mcp: 17, tip: 20 }, // pinky
] as const

/**
 * Distance between two landmarks, corrected for the frame's aspect.
 *
 * Normalised landmarks divide x by the frame WIDTH and y by its HEIGHT, so on
 * anything but a square camera the space is anisotropic and a horizontal span
 * measures shorter than an identical vertical one. Every measurement here
 * goes through this, so the ratios below are aspect-free.
 */
export function distance(a: Landmark, b: Landmark, aspect: number): number {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y)
}

/**
 * The same distance, with DEPTH in it.
 *
 * The tracker reports a `z` per landmark — depth relative to the wrist, on
 * roughly the same scale as `x`, so it converts to the same units the same
 * way. Nothing here used it, and that is a bug rather than a simplification:
 * a span pointing at the camera projects SHORT, and a span that projects to
 * nothing reads as two landmarks touching.
 *
 * Used for the pinch and nowhere else, which is a deliberate asymmetry:
 *
 *   - The aperture is the measurement that decides whether the paper gets
 *     taken hold of, and there the collapse is a FALSE POSITIVE — turn your
 *     hand so the thumb hides behind the finger and the sheet is grabbed by a
 *     hand that never closed. Depth is also safe here in a way it is not
 *     elsewhere: a 3D distance is never shorter than its own projection, so
 *     a noisy `z` can only make a pinch harder to register, never invent one.
 *   - The curls have the same geometry and the opposite risk. They drive
 *     continuous values through a ratchet — the crush only ever climbs — so
 *     there inflation is the harm, and `z` is the noisiest axis the tracker
 *     reports. They stay in the image plane, and a finger pointed straight at
 *     the camera still reads as curled. That is a known limit, not an
 *     oversight; fixing it wants smoothing that the crush ratchet would have
 *     to be rewritten around.
 */
export function spatialDistance(a: Landmark, b: Landmark, aspect: number): number {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y, (a.z - b.z) * aspect)
}

/**
 * Wrist to middle knuckle — the one span on a hand that does not change when
 * the hand changes pose, and therefore the ruler everything else is measured
 * in. Returns `null` when it cannot be measured at all.
 */
export function palmLength(hand: readonly Landmark[], aspect: number): number | null {
  const wrist = hand[WRIST]
  const knuckle = hand[MIDDLE_MCP]
  if (!wrist || !knuckle) return null
  const palm = distance(wrist, knuckle, aspect)
  return palm > 0 ? palm : null
}

/**
 * How open the pinch is, in palm lengths — thumb tip to index tip.
 *
 * Dividing by the palm is what makes one threshold work at any distance from
 * the camera: lean in and both numbers grow together. The ruler stays in the
 * image plane because it has to be the STEADIEST span available, and the
 * span being measured does not, because it has to be the most honest one.
 */
export function pinchAperture(hand: readonly Landmark[], aspect: number): number | null {
  const thumb = hand[THUMB_TIP]
  const index = hand[INDEX_TIP]
  const palm = palmLength(hand, aspect)
  if (!thumb || !index || palm === null) return null
  // In three dimensions — see {@link spatialDistance}. Measured in the image
  // plane alone, a hand turned side-on to the camera closes its own pinch.
  return spatialDistance(thumb, index, aspect) / palm
}

/**
 * Where the fingers actually hold — the midpoint of the pinch, not the index
 * fingertip. A grab that tracks the fingertip drifts sideways as the thumb
 * closes, because the fingertip travels and the hold does not.
 */
export function pinchPoint(hand: readonly Landmark[]): { x: number; y: number } | null {
  const thumb = hand[THUMB_TIP]
  const index = hand[INDEX_TIP]
  if (!thumb || !index) return null
  return { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 }
}

/**
 * One landmark, as a plain point. The anchor a gesture is aimed from depends
 * on the gesture — a pinch holds at the midpoint of the fingers, a pointing
 * hand is aimed from the fingertip — so the choice belongs to the caller.
 */
export function landmarkPoint(hand: readonly Landmark[], index: number): { x: number; y: number } | null {
  const point = hand[index]
  return point ? { x: point.x, y: point.y } : null
}

/**
 * A curled fingertip returns toward its own knuckle; an extended one reaches
 * roughly a palm past it. Measured from the WRIST rather than the knuckle,
 * because the knuckle-to-tip distance barely changes when a finger folds —
 * it is the same bones either way — while the wrist sees the whole fold.
 *
 * Straight is about 2 palms, tight is about 1. `curl` maps that to 0..1.
 */
const EXTENDED = 2
const CURLED = 1

/** 0 = straight, 1 = folded into the palm, for one finger. */
export function fingerCurl(
  hand: readonly Landmark[],
  finger: (typeof FINGERS)[number],
  aspect: number,
): number | null {
  const wrist = hand[WRIST]
  const tip = hand[finger.tip]
  const palm = palmLength(hand, aspect)
  if (!wrist || !tip || palm === null) return null
  const reach = distance(wrist, tip, aspect) / palm
  return Math.min(1, Math.max(0, (EXTENDED - reach) / (EXTENDED - CURLED)))
}

/**
 * How closed the hand is overall, 0 = flat open, 1 = tight fist.
 *
 * Continuous on purpose. A fist that only ever reads true or false can start
 * a crumple but cannot drive one, and "squeeze harder and the paper crushes
 * further" is the whole difference between a gesture and a button.
 */
export function handCurl(hand: readonly Landmark[], aspect: number): number | null {
  let total = 0
  for (const finger of FINGERS) {
    const curl = fingerCurl(hand, finger, aspect)
    if (curl === null) return null
    total += curl
  }
  return total / FINGERS.length
}

/** A finger counts as extended below this much curl. */
export const EXTENDED_BELOW = 0.4

/** True when this finger is reaching rather than folded. */
export function isExtended(
  hand: readonly Landmark[],
  finger: (typeof FINGERS)[number],
  aspect: number,
): boolean {
  const curl = fingerCurl(hand, finger, aspect)
  return curl !== null && curl < EXTENDED_BELOW
}

/**
 * Which way the hand is turned, in degrees, with the fingers up as zero.
 *
 * Measured on the same wrist-to-knuckle span everything else is normalised
 * by — the one line on a hand that does not move when the fingers do — so a
 * roll reads the same whether the hand is open, closed or half way.
 *
 * Reported in SCREEN terms rather than camera terms: the feed is mirrored, so
 * a positive angle is the hand turned the way it appears to turn on screen,
 * which is the direction anyone aiming at a dial will expect.
 */
export function palmRoll(hand: readonly Landmark[], aspect: number): number | null {
  const wrist = hand[WRIST]
  const knuckle = hand[MIDDLE_MCP]
  if (!wrist || !knuckle) return null
  const dx = (knuckle.x - wrist.x) * aspect
  const dy = knuckle.y - wrist.y
  if (dx === 0 && dy === 0) return null
  // -dx mirrors the camera; -dy puts "fingers up" at zero.
  return (Math.atan2(-dx, -dy) * 180) / Math.PI
}

/**
 * How far apart two points are, in one hand's palm lengths.
 *
 * The ruler for anything two-handed: hands pulling apart have to be measured
 * against something that does not change when you lean toward the camera,
 * and the palm is the only such span in frame.
 */
export function palmsApart(
  a: { x: number; y: number },
  b: { x: number; y: number },
  palm: number,
  aspect: number,
): number {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y) / palm
}
