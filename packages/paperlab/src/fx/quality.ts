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
}

export const fxQualityTiers: Record<FxQualityTier, FxQualitySettings> = {
  /** A desktop GPU, or a phone that has measured its way up here. */
  high: { particles: 2000, voices: 16, detail: 1 },
  /** The default worth aiming at: a recent phone, or an integrated laptop GPU. */
  medium: { particles: 900, voices: 10, detail: 1 },
  /**
   * A throttled phone with the camera and the tracker already running, which
   * is the realistic case rather than the pessimistic one. The fire is the
   * same fire; the shower is thinner, fewer crackles overlap, and its edge is
   * the grid's own.
   */
  low: { particles: 350, voices: 6, detail: 0 },
}

/** Where `auto` starts before anything has been measured. */
export const FX_INITIAL_TIER: FxQualityTier = 'medium'

export const FX_TIER_ORDER: FxQualityTier[] = ['low', 'medium', 'high']

export function fxQualityFor(name: FxQualityName): FxQualitySettings {
  return fxQualityTiers[name === 'auto' ? FX_INITIAL_TIER : name]
}
