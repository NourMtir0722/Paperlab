/**
 * `paperlab/fx` — what happens TO the paper.
 *
 * **Built, not exported.** It is in the tsup entries so the boundary test and
 * `test:consumer` cover it, and absent from `exports` so no release can
 * publish it before it has an effect in it. Export it in the commit that
 * ships fire, and not before.
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
  type DamagePixels,
  type FieldStats,
} from './fx/field'

export {
  FxAudio,
  createAudioContext,
  type AudioLike,
  type FxAudioOptions,
  type Voice,
} from './fx/sfx/graph'

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
