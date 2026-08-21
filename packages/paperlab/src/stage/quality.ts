/**
 * Render quality tiers.
 *
 * A stage is the heaviest thing this library draws — tens of thousands of
 * subdivided vertices, a shadow pass, a translucent fragment shader and a
 * full-screen backdrop — and it has to run on machines nobody developing it
 * owns. Quality is deliberately NOT part of `stageSchema`: it describes the
 * device, not the artwork, so it must never travel in a preset or a shared
 * link. Two people opening the same link should see the same scene at
 * whatever fidelity their hardware can hold.
 *
 * The five knobs, in the order they actually cost:
 *
 * - `segments` — a CEILING on what `segments: 'auto'` may ask for along the
 *   direction a banner's folds run. Quadratic in principle, though a
 *   deformer's own floor holds the bottom: `drape` states it needs 48 across
 *   its folds, so `low` cannot take the banners below that and should not.
 *
 *   It used to be written straight over the sheet's `segments` as a number,
 *   and that made it **do nothing at all**. A number applies to BOTH axes,
 *   the field caps it at 48 on the way down, and the deformer floor raised
 *   it back to 48 on the way up — so every tier drew the identical 48 × 48
 *   banner. Measured before the fix: 143,644 triangles at `medium` whatever
 *   the tier said. Worth remembering as a shape of bug — a knob nobody had
 *   measured, in the file that exists to describe what things cost.
 * - `shadowMapSize` — the shadow pass re-renders the scene's geometry. 0
 *   turns shadows off, which on a weak machine is the difference between
 *   moving and not.
 * - `dpr` — fragment cost scales with the square of it, and this scene is
 *   fragment-heavy (translucency, fog, a full-screen backdrop).
 * - `environment` — the studio light. One prefiltered cube built once, then
 *   a texture read per fragment for every lit surface in the scene. Measured
 *   at a third of the frame at `medium` (51 ms → 33 ms with it off), which
 *   makes it the most expensive single thing here after the geometry, so the
 *   bottom tier falls back to the flat ambient it replaced.
 * - `surround` — one more full-screen draw; cheap, but free to drop.
 */

export const qualityNames = ['auto', 'low', 'medium', 'high'] as const
export type QualityName = (typeof qualityNames)[number]
export type QualityTier = Exclude<QualityName, 'auto'>

export interface QualitySettings {
  /** Cap on device pixel ratio. */
  dpr: number
  /** Shadow map resolution. 0 turns the shadow pass off entirely. */
  shadowMapSize: number
  /** Subdivisions along a sheet's long edge. */
  segments: number
  /** Draw the cyclorama behind everything. */
  surround: boolean
  /** Soft contact shadow under the scene — its own render pass. */
  contactShadow: boolean
  /** Light surfaces with the room (an environment map) as well as with the lamp. */
  environment: boolean
}

export const qualityTiers: Record<QualityTier, QualitySettings> = {
  /**
   * Anything with a GPU — and measured to mean it, since `auto` only arrives
   * here after holding 55 fps. `segments: 128` is where the banners' folds
   * actually resolve: the drape asks for 133 across and spent every previous
   * version of this file getting 72, which is the difference between paper
   * that bends and paper with facets. Free on hardware — an M4 Pro holds 120
   * banners at 16 megapixels on the panel's own clock — and unreachable on
   * anything that cannot, because the ladder never promotes a machine there.
   */
  high: {
    dpr: 2,
    shadowMapSize: 2048,
    segments: 128,
    surround: true,
    contactShadow: true,
    environment: true,
  },
  /** The default worth aiming at: an integrated laptop GPU from the last few years. */
  medium: {
    dpr: 1.5,
    shadowMapSize: 1024,
    segments: 48,
    surround: true,
    contactShadow: false,
    environment: true,
  },
  /**
   * Old integrated graphics, a throttled phone, a software rasterizer. The
   * scene still READS — banners, figure, backlight, walk — it just stops
   * paying for the parts nobody would miss at this framerate.
   */
  low: { dpr: 1, shadowMapSize: 0, segments: 28, surround: true, contactShadow: false, environment: false },
}

/** The tier to start `auto` from before anything has been measured. */
export const INITIAL_TIER: QualityTier = 'medium'

/**
 * Frames the watcher averages before it will move a tier.
 *
 * The FIRST judgement is deliberately made on far less evidence than the
 * rest. A machine that cannot hold the opening scene should not have to
 * stutter through a hundred frames — several seconds, at the frame rate
 * that is the whole problem — before anything is done about it. After that
 * first correction the window widens, because by then the cost is to be
 * measured carefully rather than reacted to.
 */
export const FIRST_WINDOW = 20
export const STEADY_WINDOW = 60
/** Frames ignored after a change, while new programs and shadow maps land. */
export const SETTLE_FRAMES = 45

export const TIER_ORDER: QualityTier[] = ['low', 'medium', 'high']

export function qualityFor(name: QualityName): QualitySettings {
  return qualityTiers[name === 'auto' ? INITIAL_TIER : name]
}

/** One step better, or the same tier if already at the top. */
export function tierUp(tier: QualityTier): QualityTier {
  return TIER_ORDER[Math.min(TIER_ORDER.indexOf(tier) + 1, TIER_ORDER.length - 1)]!
}

/** One step worse, or the same tier if already at the bottom. */
export function tierDown(tier: QualityTier): QualityTier {
  return TIER_ORDER[Math.max(TIER_ORDER.indexOf(tier) - 1, 0)]!
}

/** Below this, step down. Above the upper one, step up. */
export const FLOOR_FPS = 26
export const CEILING_FPS = 55

export interface TierVerdict {
  /** Where to go. Equal to `tier` when nothing should move. */
  tier: QualityTier
  /** The lowest tier now known to be too expensive here — carry it forward. */
  failed: QualityTier | null
}

/**
 * One verdict from one frame-rate reading: the whole of `auto`'s policy,
 * pulled out of the component so it can be tested rather than watched.
 *
 * `failed` is what keeps the ladder from pumping. The two thresholds cannot
 * do it alone: promotion asks for 55 fps and demotion fires below 26, so any
 * machine where the next tier up costs more than ~2.1× the current one
 * satisfies both conditions forever — rising until it stalls, sinking until
 * it is comfortable, and visibly changing the picture every few seconds. That
 * ratio is real: `high` measures 2.1× `medium` on a software rasterizer,
 * which is precisely the hardware this exists for. So a tier that has once
 * failed is never offered again, and the scene can only ever settle.
 */
export function settleTier(tier: QualityTier, fps: number, failed: QualityTier | null): TierVerdict {
  if (fps < FLOOR_FPS) {
    const next = tierDown(tier)
    // What we were just running is what could not be held.
    return next === tier ? { tier, failed } : { tier: next, failed: tier }
  }
  if (fps > CEILING_FPS) {
    const next = tierUp(tier)
    if (next !== tier && next !== failed) return { tier: next, failed }
  }
  return { tier, failed }
}
