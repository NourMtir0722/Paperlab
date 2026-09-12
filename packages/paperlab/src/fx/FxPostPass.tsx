import { Bloom, EffectComposer, ToneMapping } from '@react-three/postprocessing'
import { useFrame } from '@react-three/fiber'
import { ToneMappingMode } from 'postprocessing'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { FX_BLOOM, FX_BLOOM_THRESHOLD, PAPER_WHITE } from './emission'
import type { FxPostProps } from './FxPost'
import { flameAnchors, type FlameAnchor } from './flames'
import { HAZE_SOURCES, HazeGradeEffect } from './haze'
import { fxQualityFor } from './quality'

/**
 * Where fire's glow comes from: bloom on the HDR frame, the heat haze and the
 * warm grade, then the tone curve.
 *
 * The ONLY file in `paperlab/fx` that imports `@react-three/postprocessing`
 * (with `haze.ts`, which only this imports), and nothing imports it
 * statically — `FxPost` reaches it through a dynamic import, so the two peers
 * stay optional the way stage's `Grade` keeps them. Importing this from
 * anywhere else would put the specifier back into fx's module graph and a
 * consumer without the peers could no longer load fx.
 *
 * Why it exists, in the words of `paperlab-fx-fire-spec.md` §0 and §7: the
 * first fire's glow was PAINT — a warm colour added to `csm_Emissive` over
 * paper that had not burnt — and red added to white makes pink. Real glow is
 * light too bright for the film: an ember is brighter than the whitest paper
 * in the frame, the lens spreads it, and the curve rolls it off to white.
 * Nothing on the sheet paints glow any more; anything that wants to glow
 * emits past paper white and this makes it bloom.
 *
 * Order is the whole argument: bloom reads the frame while it is still HDR —
 * which is what lets a threshold mean "brighter than paper" — the haze bends
 * the light above the flames and the grade warms the frame, and the curve
 * lands the result last.
 *
 * **The composer takes the tone curve off the renderer, so this gives it
 * back.** `<EffectComposer>` sets `gl.toneMapping = NoToneMapping` while it is
 * mounted; without the `<ToneMapping>` below, mounting this pass would
 * silently throw away the rig's film and the unburnt sheet would change. The
 * spec's own test for this pass is that it does not: with no fire in frame,
 * post on and post off are the same picture (§14.3, `pnpm test:fire-look`).
 */

const modes = {
  agx: ToneMappingMode.AGX,
  neutral: ToneMappingMode.NEUTRAL,
  filmic: ToneMappingMode.ACES_FILMIC,
} as const

const root = new THREE.Vector3()
const top = new THREE.Vector3()

export function FxPostPass({
  film = 'neutral',
  quality = 'medium',
  bloom = FX_BLOOM,
  threshold = FX_BLOOM_THRESHOLD,
  field,
  locate,
  haze: hazeOverride,
}: FxPostProps) {
  const { bloomScale, haze: tierHaze } = fxQualityFor(quality)
  const hazePx = hazeOverride ?? tierHaze
  const haze = useMemo(() => new HazeGradeEffect(), [])
  const anchors = useRef<FlameAnchor[]>([])

  // The flames, in screen space, for the haze; the front, for the grade.
  useFrame(({ camera }) => {
    if (!field || !locate) {
      haze.count = 0
      haze.grade = 0
      return
    }
    const n = hazePx > 0 ? flameAnchors(field, locate, HAZE_SOURCES, anchors.current) : 0
    const sources = haze.sources
    for (let i = 0; i < n; i++) {
      const a = anchors.current[i]!
      root.set(a.x, a.y, a.z).project(camera)
      top.set(a.x, a.y + a.height, a.z).project(camera)
      sources[i]!.set(root.x * 0.5 + 0.5, root.y * 0.5 + 0.5, Math.max(0, (top.y - root.y) * 0.5), a.heat)
    }
    haze.count = n
    haze.time = field.time
    haze.amount = hazePx
    // A few percent at most, and only as the fire grows (§7).
    haze.grade = Math.min(1, field.lastStats.front / 0.03)
  })

  return (
    <EffectComposer>
      {bloom > 0 ? (
        <Bloom
          intensity={bloom}
          luminanceThreshold={threshold}
          // Nearly a hard knee. A wide one reaches BELOW the threshold, and
          // below it is paper: the whole point of the threshold is that paper
          // never blooms (§7), and a soft knee would bloom it a little.
          luminanceSmoothing={0.02}
          mipmapBlur
          resolutionScale={bloomScale}
        />
      ) : null}
      <primitive object={haze} />
      <ToneMapping mode={modes[film]} />
    </EffectComposer>
  )
}

/**
 * Re-exported, not defined here.
 *
 * It moved to `emission.ts` because it is half of a unit — "brighter than
 * paper" is only meaningful beside the paper white it is measured against,
 * and every emitter now authors itself in multiples of that same number. It
 * also could not be public from here: this file is the only one in
 * `paperlab/fx` allowed to import `postprocessing` (see `boundary.test.ts`),
 * so anything exported from it is unreachable for a consumer who has not
 * installed the optional peers.
 */
export { FX_BLOOM, FX_BLOOM_THRESHOLD, PAPER_WHITE }
