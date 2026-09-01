import type { StockName } from 'paperlab'

/**
 * Turning your hand to change what the paper is made of.
 *
 * Six stocks ship and the demo has only ever shown one. `stock` is not a
 * geometry dependency — it feeds the material and the content texture, not
 * the tessellation — so it is one of the very few things that can be swapped
 * LIVE under a sheet that is being held, with the sim untouched and the drape
 * kept. The material visibly changes in your hand, which is a claim about the
 * library no still frame can make.
 *
 * The gesture is a dial rather than a cycle: hold an open hand up and turn it,
 * and the stock follows the angle. A cycle would need a discrete trigger, and
 * every discrete trigger available here is already spoken for.
 *
 * An open palm is the pose because in cloth mode it means nothing else. In
 * crush mode it already means "put the paper back", and that reading wins —
 * a dial is worth less than the way out of a crush.
 */

/**
 * The dial's stops, in the order a hand sweeps through them.
 *
 * Ordered by weight rather than alphabetically, so turning one way makes the
 * paper heavier and the other way makes it thinner — the sweep reads as a
 * range of materials instead of as a list.
 */
export const DIAL: readonly StockName[] = [
  'kraft',
  'newsprint',
  'printer',
  'photo-gloss',
  'thermal',
  'sticker',
  'vellum',
]

/** Degrees of roll, end to end. A comfortable wrist covers about this much. */
export const DIAL_SPAN = 140

/** Degrees of turn between one stock and the next. */
export const DIAL_STEP = DIAL_SPAN / (DIAL.length - 1)

/**
 * How far past a stop the hand must turn before the dial moves.
 *
 * Above half a step, so a hand sitting exactly between two stocks picks one
 * and stays there. Without it a resting hand rattles between two materials,
 * which — because a stock change repaints the content texture — is the one
 * kind of jitter here that costs real work every frame.
 */
export const DETENT = 0.62

/** The shortest way round from one angle to another, in degrees. */
export function turnedBy(from: number, to: number): number {
  return ((((to - from + 180) % 360) + 360) % 360) - 180
}

/**
 * Where the dial lands, given how far the hand has turned SINCE IT WENT UP.
 *
 * Relative, not absolute, and that is the whole design. An absolute dial
 * means every open palm snaps the stock to whatever the wrist happened to be
 * doing — including the open palm that means "put the paper back", which
 * would change the material every time someone came out of a crush. Measuring
 * from where the hand engaged means raising it changes nothing and only
 * TURNING it does.
 *
 * Pure, and takes both the anchor it is turning from and the stock it is on,
 * because the hysteresis IS the behaviour: the same angle can mean two
 * different stocks depending on which one you are coming from.
 */
export function dialIndex(turnedDeg: number, anchor: number, current: number): number {
  const last = DIAL.length - 1
  const position = Math.min(last, Math.max(0, anchor + turnedDeg / DIAL_STEP))
  const held = Math.min(last, Math.max(0, current))
  return Math.abs(position - held) > DETENT ? Math.round(position) : held
}

export function dialStock(index: number): StockName {
  return DIAL[Math.min(DIAL.length - 1, Math.max(0, index))]!
}
