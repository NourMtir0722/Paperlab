/**
 * `paperlab/fx` — what happens TO the paper.
 *
 * **Exported as of the release that ships fire**, and not before: it was
 * built but deliberately absent from `exports` while there was nothing in it
 * to use, because a subpath cannot be taken back once it is published. A
 * missing changeset would not have held it back — the next release for any
 * reason publishes whatever `exports` names — so the map was the thing that
 * did, and `test:consumer` pinned that.
 *
 * The main entry point is paper as a thing: a sheet, its stock, its shape,
 * the way it moves. This one is the events that damage it — burning, soaking,
 * tearing, the particles they throw off and the sounds they make.
 *
 * Its own subpath for the same reason stage has one, and it is worth stating
 * precisely because the first version of that argument was wrong. A subpath
 * saves nobody a byte: tree-shaking already removes what a `<Paper>` bundle
 * does not import, and it always did. What a subpath does is keep the import
 * SPECIFIER out of the main entry's module graph — and a specifier is the one
 * thing tree-shaking cannot remove, because resolving it happens before
 * anything knows whether it is used.
 *
 * That matters here the moment any of this reaches for something a `<Paper>`
 * consumer has not installed. Nothing does today; the damage field is plain
 * arithmetic over a Float32Array. It is the sound layer and the emitters that
 * will, and the time to draw the line is before there is anything on the
 * wrong side of it.
 *
 * The rule that keeps it true, and it wants to be a lint rule rather than a
 * promise: **nothing under `src/fx/` may be imported from `src/index.ts` or
 * anything it reaches.** The library was last measured near 38 KB gzipped
 * with its peers external and that number is part of what it is for.
 */

export {
  DamageField,
  CHAR,
  SATURATION,
  HEAT,
  PRESENCE,
  FIELD_SIZE,
  FIXED_DT,
  type DamageFieldOptions,
  type FieldStats,
} from './fx/field'

// Re-exported rather than defined here: the contract belongs to the sheet,
// which is what draws it. See `surface/damageContract.ts`.
export {
  DAMAGE_CHANNELS,
  DAMAGE_LOOK_DEFAULTS,
  type DamageLook,
  type DamageSource,
} from './surface/damageContract'

export {
  ParticlePool,
  particlePresets,
  type ParticlePreset,
  type ParticlePresetName,
  type ParticleTarget,
} from './fx/particles'

export {
  FireEmitter,
  fireEmitterDefaults,
  type FireEmitterOptions,
  type SurfaceLocator,
} from './fx/fire'

export { FxParticles, type FxParticlesProps } from './fx/FxParticles'

export { FxPost, type FxFilm, type FxPostProps } from './fx/FxPost'

/**
 * How bright fire is, in one unit. The threshold lives here rather than in the
 * post pass so that a consumer authoring their own emissive can read it
 * without installing the pass's optional peers.
 */
export {
  PAPER_WHITE,
  FX_BLOOM,
  FX_BLOOM_THRESHOLD,
  FIRE_HEAT_SCALE,
  FIRE_STREAK,
  FIRE_EDGE,
  FIRE_BLUE,
  FIRE_GLOW,
  FIRE_BODY,
  FIRE_CORE,
  emit,
  emitHex,
  luminance,
  srgbToLinear,
  timesPaperWhite,
} from './fx/emission'

export { Afterglow, type AfterglowOptions } from './fx/afterglow'
export { FxFlames, type FxFlamesProps } from './fx/FxFlames'
export { FxWisps, type FxWispsProps } from './fx/FxWisps'
export { FxFireFluid, type FxFireFluidProps } from './fx/FxFireFluid'
export { FireFluid, type FluidGrid } from './fx/fluid/FireFluid'
export {
  fireFluidControls,
  fireFluidDefaults,
  solverUniforms,
  type FireFluidParams,
  type SolverUniforms,
} from './fx/fluid/params'
export { FxFireLight, type FxFireLightProps } from './fx/FxFireLight'
export { FxMatchFlame, type FxMatchFlameProps, type MatchFlameState } from './fx/FxMatchFlame'
export { flameAnchors, flamePuff, FLAME_HEIGHT, type FlameAnchor } from './fx/flames'

export {
  FxAudio,
  createAudioContext,
  type AudioLike,
  type BiquadFilterLike,
  type FxAudioOptions,
  type PannerLike,
  type Voice,
} from './fx/sfx/graph'

export { FireSound, type FireSoundOptions, type SoundAt } from './fx/sfx/fire'

export {
  fxQualityNames,
  fxQualityFor,
  fxQualityTiers,
  FX_INITIAL_TIER,
  FX_TIER_ORDER,
  type FxQualityName,
  type FxQualitySettings,
  type FxQualityTier,
} from './fx/quality'
