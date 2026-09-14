import { Suspense, lazy } from 'react'
import type { ComponentType } from 'react'
import type { DamageField } from './field'
import type { SurfaceLocator } from './fire'
import type { FxQualityTier } from './quality'

/** The rig's film. Mirrors `FilmName` — which fx cannot import; see `boundary.test.ts`. */
export type FxFilm = 'agx' | 'neutral' | 'filmic'

export interface FxPostProps {
  /**
   * The film the scene's lighting uses. The composer takes the tone curve off
   * the renderer, so the pass has to be told which one to put back. Every
   * built-in preset uses `neutral`.
   */
  film?: FxFilm
  /** How much the pass may cost — bloom is drawn at half resolution on `low`. */
  quality?: FxQualityTier
  /** Bloom strength; 0 keeps the tone curve and drops the bloom. */
  bloom?: number
  /** Bloom threshold in scene luminance. Must stay above paper white. */
  threshold?: number
  /**
   * The burning field, and where its sheet is — for the heat haze above its
   * flames and the frame's warm grade as it grows. Leave both out and
   * the pass is bloom and the tone curve alone.
   */
  field?: DamageField
  locate?: SurfaceLocator
  /** Heat haze in pixels at 1080p, overriding the tier's; 0 turns it off. */
  haze?: number
  /**
   * Shallow focus on the burn, 0..1; 0 keeps everything sharp.
   *
   * A macro lens held close to a burning edge has a few millimetres of
   * focus and nothing else (§K4): the rim is sharp, the rest of the sheet
   * goes soft. It focuses on the fire itself — the burning rim is what the
   * shot is about — so it needs `field` and `locate` like the haze does.
   */
  focus?: number
}

/**
 * Bloom and the tone curve for a burn, loaded only if they are going to run.
 *
 * Put it inside the same `<Canvas>` as the burning sheet — as a child of
 * `<Paper>`. It is optional in exactly the way stage's print pass is:
 * `@react-three/postprocessing` and `postprocessing` are optional peers, this
 * reaches them through a dynamic import, and without them it renders nothing
 * and says so once. The fire still burns; it just does not glow.
 */
const Pass = lazy(() =>
  import('./FxPostPass')
    .then((m) => ({ default: m.FxPostPass as ComponentType<FxPostProps> }))
    .catch((error: unknown) => {
      warnOnce(error)
      return { default: (() => null) as ComponentType<FxPostProps> }
    }),
)

let warned = false
/** Says why, with the real error, rather than blaming two packages that may be installed. */
function warnOnce(cause?: unknown) {
  if (warned) return
  warned = true
  console.warn(
    '[paperlab/fx] Rendering without FxPost — fire will not bloom.\n' +
      'It needs two optional peers:\n' +
      '  npm i @react-three/postprocessing postprocessing\n' +
      'Leave <FxPost> out to go without it deliberately and silence this.',
    ...(cause === undefined ? [] : [cause]),
  )
}

/**
 * `fallback={null}`: the scene behind it is already drawn. One frame without
 * the pass, then one with it.
 */
export function FxPost(props: FxPostProps) {
  return (
    <Suspense fallback={null}>
      <Pass {...props} />
    </Suspense>
  )
}
