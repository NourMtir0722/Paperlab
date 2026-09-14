import { HEAT, type DamageField } from 'paperlab/fx'

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

/**
 * Below this much breath nothing cools: a gentle blow leans the flames and
 * stirs the smoke, and only a real one puts a fire out.
 */
export const BLOW_COOL_FROM = 0.3

/**
 * Heat a full blow takes off the sheet a second, at its strongest.
 *
 * The field is bistable, and this number sits on the right side of it: a
 * burning rim either drops under the ignition threshold everywhere at once
 * and the fire is out, or keeps a few cells alight and recovers — and then
 * eats the sheet, only later. Swept with a 0.6–1 s full blow: 0.9, 1.2 and
 * 1.6 a second all recovered, 2.4 put a fire out only at the very end of
 * the range, and a bigger fire than the one it was tuned on came back. 3.5
 * ends a sustained blow's fire with margin, and still leaves a gentle breath
 * (under `BLOW_COOL_FROM`) doing nothing but leaning the flames.
 *
 * What smoulders afterwards is not the field's — its heat is gone in a
 * fraction of a second either way. The beads that go out one by one are
 * drawn by `Afterglow` in `paperlab/fx`.
 */
export const BLOW_COOL = 3.5

/**
 * Blowing on a burning sheet, as heat taken off the field.
 *
 * Through the field's own public paint with a negative amount, so the
 * simulation is exactly the one the plan defines and a blown-out burn
 * replays like any other. A soft disc over the whole sheet rather than a
 * stamp: the breath arrives strongest where it is aimed, and the edges of
 * the disc cool less — which is what leaves isolated beads to smoulder.
 * Shared by `/hands` (a real mouth) and `/fx-lab` (a scripted one), so the
 * lab's ending is the product's.
 */
export function coolFromBlow(field: DamageField, blow: number, dt: number): void {
  const strength = (blow - BLOW_COOL_FROM) / (1 - BLOW_COOL_FROM)
  if (!(strength > 0) || !(dt > 0)) return
  field.paint(HEAT, 0.5, 0.45, 0.85, -BLOW_COOL * strength * dt, 0.35)
}
