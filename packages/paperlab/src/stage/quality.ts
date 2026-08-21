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
 * The four knobs, in the order they actually cost:
 *
 * - `segments` — subdivisions along a banner's long edge. Quadratic: every
 *   sheet is a grid, so halving this quarters the vertex work.
 * - `shadowMapSize` — the shadow pass re-renders the scene's geometry. 0
 *   turns shadows off, which on a weak machine is the difference between
 *   moving and not.
 * - `dpr` — fragment cost scales with the square of it, and this scene is
 *   fragment-heavy (translucency, fog, a full-screen backdrop).
 * - `surround` — one more full-screen draw; cheap, but free to drop.
 * - `environment` — the studio light. One prefiltered cube built once, then
 *   a texture read per fragment for every lit surface in the scene. Cheap on
 *   anything with a GPU and not free on a software rasterizer, so the bottom
 *   tier falls back to the flat ambient it replaced.
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
  /** Anything with a GPU. */
  high: { dpr: 2, shadowMapSize: 2048, segments: 72, surround: true, contactShadow: true, environment: true },
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
