/**
 * What an effect is allowed to cost to SHOW, per device class.
 *
 * Presentation only, deliberately. The simulation is not tiered: every device
 * runs the same damage field on the same grid at the same timestep, so every
 * device gets the same fire — which is also the only way a burn can be shared
 * or replayed and come out the same. See the note at the top of
 * `fx/field.ts`.
 *
 * That is a correction. The first version of this table tiered the field's
 * grid size and its substep count as two independent knobs, and they are not
 * independent: with explicit diffusion, halving the cell size quadruples the
 * cells AND the steps stability needs, so the same fire costs N⁴ — the 128
 * grid was sixteen times the 64 one. What the table actually produced was a
 * fire whose SPEED depended on the device. It is the same shape of mistake as
 * the `stage/quality.ts` knob this file's first preamble warned about, made
 * one file over.
 *
 * What remains here is what a weaker device can genuinely show less of
 * without the effect meaning something different: how many particles are in
 * the air, how many sounds play at once, and how finely a burnt edge is drawn.
 * A knob belongs here only when something reads it.
 */

export const fxQualityNames = ['auto', 'low', 'medium', 'high'] as const
export type FxQualityName = (typeof fxQualityNames)[number]
export type FxQualityTier = Exclude<FxQualityName, 'auto'>

export interface FxQualitySettings {
  /**
   * Hard ceiling on live particles across every emitter at once.
   *
   * Allocated at this size and never grown, so it is a size rather than a
   * suggestion. Read by the emitters, which arrive with fire.
   */
  particles: number
  /**
   * Simultaneous synthesised voices.
   *
   * A phone running MediaPipe and WebGL has no headroom for an unbounded
   * grain cloud, and a grain cloud is exactly what fire and crumple both
   * want to be. The ceiling is the whole design, not a safety net. Read by
   * `FxAudio`.
   */
  voices: number
  /**
   * How ragged a burnt edge is drawn, 0..1 — per-fragment noise that frays
   * the edge finer than the damage grid can. Handed to the sheet as the
   * field's `detail`. The one part of drawing damage that costs per PIXEL,
   * so the part a fill-rate-bound phone gives up first; at 0 the shader
   * skips the noise outright.
   */
  detail: number
  /**
   * The resolution bloom is drawn at, as a fraction of the frame.
   *
   * Bloom is a blur, and a blur at half resolution is a quarter of the
   * fill-rate for a glow that is soft anyway — the cheapest thing a phone
   * can give up that still leaves every zone and every flame on screen
   * (spec §12: tiers thin post quality, never what is shown). Read by
   * `FxPost`.
   */
  bloomScale: number
  /**
   * The most flames standing at once. The spec's §12 said 8 / 16 / 32; a ring
   * of fire that is dense in clusters and broken by gaps needs more tongues
   * than that, and Noor's direction (a living, uneven ring, never a crown)
   * came later and wins — 16 / 36 / 64. Every tier has real flames; a phone
   * gets fewer tongues, never the cheap version.
   * Read by `FxFlames`.
   */
  flames: number
  /**
   * The most of each particle kind in the air at once (spec §12), inside the
   * `particles` budget. Read by `FireEmitter` through its `caps` option.
   */
  caps: { ember: number; smoke: number; ash: number }
  /** Heat haze strength in pixels at 1080p; 0 turns it off (the low tier). Read by `FxPost`. */
  haze: number
  /**
   * The fire simulator's grids (`FxFireFluid`): a coarse velocity grid, a
   * fine one for what is drawn, and the pressure solve's iterations. Every
   * tier simulates a real fire; a phone solves a coarser one.
   */
  fluid: { velocity: readonly [number, number]; dye: readonly [number, number]; iterations: number }
}

export const fxQualityTiers: Record<FxQualityTier, FxQualitySettings> = {
  /** A desktop GPU, or a phone that has measured its way up here. */
  high: {
    particles: 2000,
    voices: 16,
    detail: 1,
    bloomScale: 1,
    flames: 64,
    caps: { ember: 200, smoke: 200, ash: 120 },
    haze: 3.8,
    fluid: { velocity: [96, 128], dye: [384, 512], iterations: 24 },
  },
  /** The default worth aiming at: a recent phone, or an integrated laptop GPU. */
  medium: {
    particles: 900,
    voices: 10,
    detail: 1,
    bloomScale: 1,
    flames: 36,
    caps: { ember: 80, smoke: 80, ash: 60 },
    haze: 3.8,
    fluid: { velocity: [72, 96], dye: [288, 384], iterations: 18 },
  },
  /**
   * A throttled phone with the camera and the tracker already running, which
   * is the realistic case rather than the pessimistic one. The fire is the
   * same fire; the shower is thinner, fewer crackles overlap, and its edge is
   * the grid's own.
   */
  low: {
    particles: 350,
    voices: 6,
    detail: 0,
    bloomScale: 0.5,
    flames: 16,
    caps: { ember: 30, smoke: 30, ash: 20 },
    haze: 0,
    fluid: { velocity: [48, 64], dye: [192, 256], iterations: 12 },
  },
}

/** Where `auto` starts before anything has been measured. */
export const FX_INITIAL_TIER: FxQualityTier = 'medium'

export const FX_TIER_ORDER: FxQualityTier[] = ['low', 'medium', 'high']

export function fxQualityFor(name: FxQualityName): FxQualitySettings {
  return fxQualityTiers[name === 'auto' ? FX_INITIAL_TIER : name]
}
