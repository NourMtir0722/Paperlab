/**
 * How bright fire is, in one unit: **multiples of paper white.**
 *
 * `paperlab-fx-fire-spec.md` §4.3 makes exactly one quantitative claim about
 * what fire must look like — an ember is 4–8× brighter than the whitest paper
 * in the frame, which is what makes a bloom pass spread it and a tone curve
 * roll it to white. Everything else about the look is a colour or a
 * millimetre; this is the only number, and it is the one the first fire got
 * wrong twice.
 *
 * It got it wrong twice because until this file there was **no way to say it.**
 * The same claim was authored four different ways:
 *
 *   - `plEmberRamp` (`surface/compose.ts`) as sRGB hex through `plLinear`,
 *     scaled by a `DamageLook` multiplier;
 *   - `particlePresets.ember` as a raw linear triple, `[12, 4.2, 0.9]`;
 *   - the fluid's render pass as a `glow` curve times a blackbody;
 *   - and the bloom threshold as one absolute constant, 3.6.
 *
 * Four conventions, one threshold, and nothing converting between them. The
 * consequence was not that a number was slightly off. It was that **being 2×
 * under was invisible**: the fluid's flames — the biggest light in the frame —
 * peaked at a scene luminance of 1.68 against a threshold of 3.6, so they
 * never bloomed at all, and turning bloom on at the burn's peak changed 648 of
 * 960,000 pixels. Nobody could have seen that without doing this file's
 * arithmetic by hand, and somebody eventually did, in a review.
 *
 * So: emitters are authored HERE, in multiples of {@link PAPER_WHITE}, and
 * `emission.test.ts` asserts that each one lands in the band the spec asks
 * for. A number that drifts out of range now fails a test instead of waiting
 * for an afternoon with a screenshot and a calculator.
 *
 * Nothing in this file imports anything. It is the unit, so it has to be
 * readable from the sheet's shader constants, from a particle preset and from
 * the post pass alike — and `FxPostPass` is the only file in `paperlab/fx`
 * allowed to name `postprocessing`, so the threshold cannot live there and
 * still be public (see `boundary.test.ts`).
 */

/**
 * Rec. 709 luminance weights.
 *
 * Not an aesthetic choice: this is what `postprocessing`'s bloom pass
 * measures a pixel's brightness with, so it is what "brighter than paper"
 * has to mean for the threshold to do what it says.
 */
export const LUMA = [0.2126, 0.7152, 0.0722] as const

/**
 * The scene luminance of the brightest paper any built-in preset lights.
 *
 * **Measured, not chosen.** A clean sheet was photographed under every preset
 * with bloom on and bloom off, stepping the threshold until the two pictures
 * were identical: most presets are safe from 0.8–0.9, `studio` from 1.1, and
 * `window` — the brightest — only from 1.6. The brightest preset has to set
 * this, because a threshold that lets paper bloom under any preset brings back
 * the painted-glow failure of §0.
 *
 * Re-measure it with `pnpm test:fire-look` if a preset's lighting changes.
 */
export const PAPER_WHITE = 1.6

/**
 * The bloom threshold, in scene luminance before the tone curve.
 *
 * Paper white plus headroom for a highlight at a grazing angle that the test
 * camera does not happen to see. Stated as a multiple so that the reason for
 * the number survives: it is not "3.6", it is "clear of the brightest paper".
 *
 * **Do not lower it to make fire bloom.** That is the wrong end of the
 * problem, and the review that found the fluid's flames under it said so:
 * `window`'s paper blooms from 1.6, so lowering the threshold blooms paper,
 * which is the painted glow again. Raise what the fire EMITS.
 */
export const FX_BLOOM_THRESHOLD = PAPER_WHITE * 2.25

/**
 * What the spec asks a glowing part of a fire to reach, in multiples of paper
 * white (§4.3). The band `emission.test.ts` holds every emitter to.
 */
export const FIRE_GLOW = [4, 8] as const

/** One sRGB channel (0..1) to linear. The transfer function, not a gamma. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** Rec. 709 luminance of a linear colour. */
export function luminance(c: readonly [number, number, number]): number {
  return c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2]
}

/** How many times paper white a linear colour is — the inverse of {@link emit}. */
export function timesPaperWhite(c: readonly [number, number, number]): number {
  return luminance(c) / PAPER_WHITE
}

/**
 * An emissive colour, authored as a hue and a brightness.
 *
 * `srgb` is the colour it should LOOK — the ordinary 0..1 sRGB you would pick
 * in a colour picker — and `times` is how many times paper white it should
 * BE. The two are independent on purpose: hue is a judgement about fire, and
 * brightness is a number the spec fixes and a test can check. Authoring them
 * together in one linear triple is what let `[12, 4.2, 0.9]` sit at 3.5×
 * paper white under a comment claiming it cleared 4×.
 *
 * The returned triple has exactly `times * PAPER_WHITE` luminance, so it can
 * be handed straight to a shader.
 */
export function emit(srgb: readonly [number, number, number], times: number): [number, number, number] {
  const linear: [number, number, number] = [
    srgbToLinear(srgb[0]),
    srgbToLinear(srgb[1]),
    srgbToLinear(srgb[2]),
  ]
  const lum = luminance(linear)
  // A colour with no luminance has no hue to scale — black stays black rather
  // than becoming a division by zero.
  if (lum <= 1e-6) return [0, 0, 0]
  const gain = (times * PAPER_WHITE) / lum
  return [linear[0] * gain, linear[1] * gain, linear[2] * gain]
}

/** `emit` from a `#rrggbb` string, for colours sampled off a reference still. */
export function emitHex(hex: string, times: number): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  return emit([((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255], times)
}

/**
 * The flame body's gain, in multiples of paper white — how much light the
 * emission ramp (`flameEmission` in the render pass) is scaled by.
 *
 * Its history is worth keeping, because each value was a real mistake. At
 * 1.3 the whole flame sat in the tone curve's roll-off and came out pastel.
 * At 0.45, with hue chosen apart from brightness, the dim parts of every
 * tongue were dark YELLOW, which is olive. Colour follows intensity now, the
 * way a hot body's does, and the gain decides how far up that ramp a flame
 * reaches. Measured against Flame_base.png: 0.5 -> 13% yellow, 0.8 -> 9%,
 * 1.2 -> 2% (bright yellow is taken to pale by the curve), so it stays well
 * under paper white and the cores, via {@link FIRE_CORE}, do the over-exposing.
 */
export const FIRE_BODY = 0.6

/**
 * The hottest cores, in multiples of paper white — added to the body, so the
 * peak is `FIRE_BODY + FIRE_CORE`.
 *
 * With the body at 0.45 this puts the peak at 4.45× paper white — inside
 * §4.3's 4–8 band, at the bottom of it. It was 8 at one point, and 9.6× paper
 * was far too much: the bloom of that much area tinted the whole black stage
 * olive, the tone curve took every flame to cream, and the gate's own check
 * failed with "the fire light pushes paper past the bloom threshold".
 *
 * This is the ONLY term allowed to over-expose. The body stays in the
 * mid-tones where the curve still has colour; the cores, which are a small
 * part of a flame's area, go past white and bloom. That division is what
 * makes fire read as fire rather than as a bright stain.
 */
export const FIRE_CORE = 4

/**
 * The solver temperature that counts as the hottest gas in a flame.
 *
 * The fluid's heat has no natural ceiling — the rim releases 22 a second and
 * burning adds three times what it consumes — so the render pass needs a
 * reference before "hot" can mean anything. Every band in `RENDER_FRAGMENT`
 * is a fraction of this, which is what gives a flame a core, a body and a
 * tip instead of one saturated colour.
 *
 * Tuned by sweeping it against the peak frame at 2, 4, 8 and 16: at 2 the
 * whole flame is cream again, at 16 the fire goes grey and thin because
 * nothing reaches the core band.
 *
 * It is NOT independent of the solver's `cooling`, and that is worth stating
 * because the two were tuned apart and fought. This is a reference
 * temperature; cooling decides how much gas ever reaches it. At cooling 0.92
 * a scale of 5 put 77% of the frame past the bloom threshold — the blown-out
 * frame — so the scale went to 8; then cooling went to 1.15 to stop the
 * tongues merging, and at 8 almost nothing reached the core band any more and
 * bloom touched 0.01% of the frame. Measured together (bloom's share of the
 * frame): scale 5 gives 77% / 11% / 4% at cooling 0.92 / 1.15 / 1.4, and
 * scale 8 gives 1.2% / 0.6% / 0.2%. `pnpm test:fire-budget` is what holds the
 * pair honest now.
 */
export const FIRE_HEAT_SCALE = 5

/**
 * How strongly light past {@link FX_BLOOM_THRESHOLD} spreads.
 *
 * It lives beside the threshold because the two are one setting: bloom is a
 * multiplier on whatever clears the threshold, so its right value depends
 * entirely on how much fire is authored above it. 1.55 was tuned when the
 * flames were UNDER the threshold and bloom had almost nothing to work on —
 * measured, 0.07% of the frame. Once the flames cleared it, that same 1.55
 * tinted the entire black stage olive. Swept at 0.25, 0.6 and 1.2 against the
 * peak frame; past about 0.4 the stage stops being black.
 */
export const FX_BLOOM = 0.55

/**
 * How much darker a flame's mid-tones are than a linear ramp would make them.
 *
 * A gamma on the normalised temperature. 1 is the ramp as the solver hands it
 * over; above 1 the body falls away from the core faster, below 1 mid
 * temperatures are lifted up the emission ramp. It was 1.15 while the gradient
 * of temperature WAS the look; now that the sheets and the outline carry the
 * contrast, 0.9 gives fuller tongues and a little more amber and yellow.
 */
export const FIRE_CONTRAST = 0.9

/**
 * How hard the render pass carves the gas into filaments, 0..2.
 *
 * Multiplicative, and weighted toward thin gas, so it opens holes through the
 * flame instead of dimming it evenly — a fire is optically thin and the black
 * you see through it is half of its contrast.
 */
export const FIRE_DETAIL = 0.35

/**
 * How opaque the densest flame gas is, as an extinction coefficient.
 *
 * Fire used to be pure added light, which is why a tongue standing in front
 * of the sheet came out salmon: orange added to cream paper is pink, the one
 * colour §13.3 forbids. A flame is thin at the tip and nearly opaque through
 * its bright heart, and that opacity is what lets it read as its own colour
 * instead of as a tint on whatever is behind it. 0 restores the old purely
 * additive fire.
 *
 * 2.2 left the body of a flame about half see-through at mid temperature
 * (1 - e^-(0.3 x 2.2) ~ 0.5), so half of every tongue in front of the sheet
 * was cream paper — which is what turned orange into PEACH. Measured on the
 * flame's own pixels, 35-44% of them were pale against the reference's 17%.
 * At 5 the body covers what is behind it and only the thin edges and tips
 * stay translucent.
 */
export const FIRE_OPACITY = 5

/**
 * How much darker the gas is BETWEEN a flame's sheets of light than on them,
 * 0..1. A flame's light comes from the thin sheet where the burning is, seen
 * as streaks running up the tongue; 0 is a smooth, gradient-lit flame — the
 * blob this replaced.
 */
export const FIRE_STREAK = 0

/**
 * How soft a flame's outline is, as a width in normalised temperature.
 * Smaller is a crisper silhouette; a wide fall-off reads as a glow, not a
 * tongue.
 */
export const FIRE_EDGE = 0.1

/**
 * How much blue at the root of each tongue, where fresh gas leaves the paper
 * and burns before it has heated through (Flame_base.png). 0 removes it.
 */
export const FIRE_BLUE = 0

/**
 * How opaque flame gas must be before it glows at full strength, 0..1.
 *
 * Soot emits and absorbs together, so thin gas should glow in proportion to
 * how much of the background it covers; at a low value a nearly transparent
 * tip still emits fully and turns cream paper salmon, at a high value every
 * dim edge fades out before it can show its deep orange.
 */
export const FIRE_THIN = 0.55

/**
 * Where a flame's pale, over-exposed core begins, as a fraction of the
 * hottest gas (FIRE_HEAT_SCALE). The core is the one part of a flame that is
 * brighter than white — the reason it blooms — so if this sits above what the
 * gas actually reaches, nothing over-exposes and nothing blooms, which is
 * what `test:fire-budget` catches.
 */
// Swept against the budget's own measurement (bloom on vs off, share of the
// frame that changes): 0.75 -> 0.01%, 0.6 -> 0.6%, 0.6 with a core of 6 ->
// 1.5%, 0.5 -> 3.2%. How MUCH gas reaches the core decides it, not how bright
// the core is made.
export const FIRE_PALE_FROM = 0.5
