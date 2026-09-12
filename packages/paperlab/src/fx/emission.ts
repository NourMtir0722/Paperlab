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
 * The FLAME HEAT that counts as the hottest gas in a flame — the heat burning
 * made (see `REACT`), which is what a flame's colour is drawn from.
 *
 * It has no natural ceiling, so the render pass needs a reference before
 * "hot" can mean anything. Every band in `RENDER_FRAGMENT`
 * is a fraction of this, which is what gives a flame a core, a body and a
 * tip instead of one saturated colour.
 *
 * It is NOT independent of the solver's `cooling` and heat terms: this is a
 * reference temperature, and they decide how much gas ever reaches it.
 * `pnpm test:fire-budget` is what holds the pair honest.
 *
 * 0.65, measured: inside a flame (where its soot is visible) flame heat runs
 * 0.17 / 0.27 / 0.40 / 0.48 at the 10th / 50th / 90th / 99th percentile.
 * At 0.4 most of the flame sat past the core's threshold and was 36%
 * near-white; at 0.8 all of it sat in the tip's band and was 93% orange.
 * 0.65 puts the median in the body and only the top few percent in the core.
 */
export const FIRE_HEAT_SCALE = 0.65

/**
 * The soot density that counts as a full flame.
 *
 * Soot is what the render pass draws a flame FROM — its outline, its opacity,
 * how much light it can give — while temperature only picks the colour (see
 * `RENDER_FRAGMENT`). Like the heat, the solver's soot has no natural unit,
 * so this is the reference: `tip.from` is a fraction of it. At 1 the soot's
 * 90th percentile (~1.4) was already past it, so every tongue was solid to
 * its edge with a hard outline; 3 leaves the thin parts room to fade.
 */
export const FIRE_SOOT_SCALE = 3

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
 * How opaque flame gas must be before it glows at full strength, 0..1.
 *
 * Soot emits and absorbs together, so thin gas should glow in proportion to
 * how much of the background it covers; at a low value a nearly transparent
 * tip still emits fully and turns cream paper salmon, at a high value every
 * dim edge fades out before it can show its deep orange.
 */
export const FIRE_THIN = 0.55

/**
 * A flame, in four zones — drawn the way the sheet's burn is (ember line, ash
 * lip, char, scorch): each part named for what it is, with its own controls.
 * Base to tip, as a flame spreading over a sheet actually is:
 *
 *   root  the blue leading edge where fresh gas meets the air at the paper.
 *         Its light comes from excited molecules, not soot, so it is faint
 *         and blue — and it starts OFF, because blue light added over cream
 *         paper reads lavender.
 *   core  the hottest gas, where soot forms densest and glows pale. The only
 *         zone allowed to over-expose past the bloom threshold, and so the
 *         one that blooms.
 *   body  the luminous bulk: soot glowing yellow-orange as it rises.
 *   tip   where soot cools and burns off at the outer edge — orange-red,
 *         dimmer, tearing into tongues. What survives escapes as smoke.
 *
 * Colour and brightness are separate in every zone, the way professional
 * fire shading keeps an intensity ramp apart from a colour ramp. The DEFAULTS
 * keep the order a hot body glows in — each zone brighter and yellower than
 * the one outside it — because breaking it is how dim yellow turns olive;
 * `emission.test.ts` holds them to that.
 *
 * WHERE the flame is comes from its soot: it begins at `tip.from`, a fraction
 * of FIRE_SOOT_SCALE, over `tip.softness`. WHAT COLOUR it is comes from its
 * temperature (a fraction of FIRE_HEAT_SCALE): the tip gives way to the body
 * around `tip.to`, and the core begins at `core.from`. Brightness is in
 * multiples of paper white; colours are sRGB, the way a colour picker gives
 * them.
 *
 * The body is ABOVE paper white. It was once held below it, because under a
 * bright preset paper sits at the top of the tone curve and anything brighter
 * loses its colour — and a flame dimmer than the paper behind it, drawn
 * opaque, is a yellow decal on the sheet, not light. Fire photographed in a
 * bright room DOES wash out; that is the lighting's to answer (the lab shoots
 * under `noir`, as the references were), not the flame's.
 */
export interface FireZones {
  root: { color: string; amount: number; reach: number }
  core: { color: string; glow: number; from: number }
  body: { color: string; glow: number }
  tip: { color: string; glow: number; from: number; to: number; softness: number; tearing: number }
}

/** Any part of any zone, over the defaults. */
export type FireZonesInput = { [Z in keyof FireZones]?: Partial<FireZones[Z]> }

/**
 * The defaults reproduce the look arrived at by measurement against
 * Flame_base.png (yellow ~30%, orange ~40%, pale ~18% of a flame's pixels),
 * now expressed zone by zone. Each colour is the linear emission the previous
 * ramp used in that band, written as the sRGB a picker would show.
 */
export const FIRE_ZONES: FireZones = {
  root: { color: '#3b6bff', amount: 0, reach: 0.5 },
  // glow 6 (was 4.6): once the core became the hottest few percent of a
  // flame instead of its whole root, 4.6 no longer cleared the bloom
  // threshold — bloom's share of the peak frame fell to 0.48%, under the
  // budget. Brighter keeps the same small area: 1.47% bloom, near-white 0.8%.
  // Starting it lower (from 0.45) bloomed 6.4% but put near-white back at 4.7%.
  core: { color: '#fff7d4', glow: 6, from: 0.55 },
  // Saturated, because the tone curve takes saturation away from anything
  // above paper white: #ffdd7c at this glow came out pale yellow (s ~0.4),
  // and measured 7.5% yellow against Flame_base.png's 29%.
  body: { color: '#ffcf3a', glow: 1.3 },
  // to: 0.4, measured against Flame_base.png with bloom off (bloom's halo
  // counts as flame in any diff): near-white / pale / yellow / orange came out
  // 0.7 / 21 / 34 / 44% against the reference's 0.9 / 17 / 29 / 43. At 0.32
  // the body took half the flame and it was 51% yellow; at 0.45, 64% orange.
  tip: { color: '#ff9e2c', glow: 0.9, from: 0.08, to: 0.4, softness: 0.15, tearing: 0.35 },
}

/** The defaults with `input` laid over them, zone by zone. */
export function fireZones(input?: FireZonesInput): FireZones {
  return {
    root: { ...FIRE_ZONES.root, ...input?.root },
    core: { ...FIRE_ZONES.core, ...input?.core },
    body: { ...FIRE_ZONES.body, ...input?.body },
    tip: { ...FIRE_ZONES.tip, ...input?.tip },
  }
}

/** A `#rrggbb` colour as linear RGB — what a shader multiplies light by. */
export function hexToLinear(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  return [
    srgbToLinear(((n >> 16) & 255) / 255),
    srgbToLinear(((n >> 8) & 255) / 255),
    srgbToLinear((n & 255) / 255),
  ]
}
