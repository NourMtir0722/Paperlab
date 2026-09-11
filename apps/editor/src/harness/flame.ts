/**
 * How hot the match is.
 *
 * Its own module, with a test, because the first version of these numbers was
 * simply too cold: the flame deposited heat forever and the paper never
 * caught. Nothing in the gesture layer was wrong — the match lit, it was
 * carried to the sheet, the field was painted every frame — and every unit
 * test passed, because none of them knew what the page's own constants were.
 * The browser gate found it, which is the most expensive place to find a
 * number.
 *
 * The field ignites above a fraction of each texel's own tinder (`IGNITION`,
 * 0.35), and heat is lost to the room every step — so what matters is not how
 * much a flame deposits but whether its RATE beats the cooling. At 1.6 a
 * second the heat settled at 0.234 and nothing ever charred.
 */

/**
 * Heat a flame held against the paper deposits a second, at its centre.
 *
 * Measured, not guessed: 1.6 never ignites, 4 is roughly the floor, and this
 * lights a sheet in about a fifth of a second once the flame has settled —
 * which is what a match against paper does.
 */
export const FLAME_HEAT = 5

/** How wide it lands, in UV. About a centimetre of a sheet this size. */
export const FLAME_RADIUS = 0.055

/**
 * How long the flame has to be in contact with the paper to deposit at its
 * full rate, in seconds.
 *
 * It gates the flame's ARRIVAL, which is what keeps a hand crossing the sheet
 * from setting it alight: a few frames over any one place, at the bottom of
 * this ramp, leave a scorch rather than a fire. It deliberately does not
 * reset as the flame moves ALONG the paper — a match already in contact
 * lights a trail behind it, which is what a match does — and it starts again
 * from zero the moment the flame leaves the sheet or goes out.
 */
export const FLAME_DWELL = 0.35

/** What to paint into the heat channel this frame. */
export function flameHeat(heldSeconds: number, dt: number): number {
  return FLAME_HEAT * Math.min(1, heldSeconds / FLAME_DWELL) * dt
}
