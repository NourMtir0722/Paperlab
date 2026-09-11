/**
 * What an effect is allowed to cost, per device class.
 *
 * Written WITH the field rather than after it, and the reason is in this
 * repo's own history rather than in a principle. `stage/quality.ts` records a
 * knob that was added late, never measured, and did nothing at all: a
 * `segments` cap written over both axes, clamped at 48 on the way down and
 * raised back to 48 by a deformer's own floor on the way up, so every tier
 * drew the identical 48 × 48 banner — 143,644 triangles wherever you set it.
 * A tier added after the effect is a tier that describes nothing.
 *
 * So these numbers are load-bearing from the first commit: the field is
 * ALLOCATED at `field` texels square and there is no path that resizes it
 * upward, and the emitter's pool is allocated at `particles` and cannot
 * exceed it. A tier is a size, not a suggestion.
 *
 * The budget these sit inside, which is what makes them small: on the target
 * device the page is already running a camera, a hand tracker, a cloth
 * simulation and a translucent fragment shader. The effects layer is the
 * fifth thing on a phone, not the first thing on a workstation.
 */

export const fxQualityNames = ['auto', 'low', 'medium', 'high'] as const
export type FxQualityName = (typeof fxQualityNames)[number]
export type FxQualityTier = Exclude<FxQualityName, 'auto'>

export interface FxQualitySettings {
  /**
   * The damage field's resolution, in texels along each edge.
   *
   * Quadratic in cost and the single number that decides everything else —
   * a diffusion step reads four neighbours per texel per channel, and the
   * texture is re-uploaded whenever it changes.
   *
   * It is deliberately far below the sheet's pixel size. The field carries
   * where the paper is wet and where it has charred, and those are soft
   * quantities with soft edges; the RAGGED edge a burn or a wet front reads
   * as does not come from resolution, it comes from the anisotropy and the
   * fibre noise, both of which survive being sampled coarsely. Detail that
   * would be lost here is detail the shader puts back at fragment rate.
   */
  field: number
  /**
   * Diffusion sub-steps per frame.
   *
   * Explicit diffusion is only stable below a step size set by the rate and
   * the cell size, so a fast front needs several small steps rather than one
   * big one. Lowering this does not slow the effect down — the step clamps
   * itself and the front simply advances more coarsely.
   */
  substeps: number
  /** Hard ceiling on live particles across every emitter at once. */
  particles: number
  /**
   * Simultaneous synthesised voices.
   *
   * A phone running MediaPipe and WebGL has no headroom for an unbounded
   * grain cloud, and a grain cloud is exactly what fire and crumple both
   * want to be. The ceiling is the whole design, not a safety net.
   */
  voices: number
}

export const fxQualityTiers: Record<FxQualityTier, FxQualitySettings> = {
  /**
   * A desktop GPU, or a phone that has measured its way up here.
   *
   * 128 is where the field stops being the limit on how thin a burn front
   * can be: at this resolution a front is a couple of texels across on a
   * sheet that occupies most of the viewport, which is finer than the char
   * shading blurs it to anyway.
   */
  high: { field: 128, substeps: 4, particles: 2000, voices: 16 },
  /** The default worth aiming at: a recent phone, or an integrated laptop GPU. */
  medium: { field: 96, substeps: 3, particles: 900, voices: 10 },
  /**
   * A throttled phone with the camera and the tracker already running, which
   * is the realistic case rather than the pessimistic one. Everything still
   * happens — it burns, it soaks, it drops embers — with a coarser front and
   * a thinner shower.
   */
  low: { field: 64, substeps: 2, particles: 350, voices: 6 },
}

/** Where `auto` starts before anything has been measured. */
export const FX_INITIAL_TIER: FxQualityTier = 'medium'

export const FX_TIER_ORDER: FxQualityTier[] = ['low', 'medium', 'high']

export function fxQualityFor(name: FxQualityName): FxQualitySettings {
  return fxQualityTiers[name === 'auto' ? FX_INITIAL_TIER : name]
}
