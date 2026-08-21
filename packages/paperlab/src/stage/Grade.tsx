import {
  EffectComposer,
  Bloom,
  DepthOfField,
  Vignette,
  Noise,
  ToneMapping,
} from '@react-three/postprocessing'
import { BlendFunction, ToneMappingMode } from 'postprocessing'
import type { FilmName } from '../config/schema'
import type { StageGradeConfig } from './schema'

/**
 * The print pass: tone curve, bloom, vignette, grain.
 *
 * Kept in its own module for one reason — it is the ONLY file in the library
 * that imports `@react-three/postprocessing`, and it is reached only from
 * `<PaperStage>`. Adding an import here is fine; importing this from
 * anywhere outside stage mode is not.
 *
 * **The composer takes the tone curve away from the renderer, so this file
 * has to give it back.** `<EffectComposer>` sets `gl.toneMapping =
 * NoToneMapping` for as long as it is mounted — it has to, because tone
 * mapping belongs at the END of a post chain rather than at the end of the
 * scene pass, and a frame mapped twice is wrong twice. What that means here
 * is that mounting a composer without a `<ToneMapping>` effect silently
 * throws away `light.film` entirely: the stage's own grade would have been
 * the one thing capable of un-doing the AgX curve everything else reads.
 *
 * Why the rest of it is needed, in the order it shows up in a frame:
 *
 * - **Bloom.** The source at the end of the walk is a `meshBasicMaterial`
 *   with `toneMapped: false`, deliberately, because it is light rather than
 *   an object. Nothing rolls it off, so without bloom it clips to a flat
 *   shape with a boundary — a lit panel hanging in the room. `Surround`
 *   already spends a seven-stop alpha ramp fighting that in geometry, which
 *   is the wrong layer to fight it in.
 * - **Vignette.** A frame with no edge reads as a viewport.
 * - **Grain.** The one texture the render and the subject have in common.
 */

/** The rig's film, as a postprocessing mode. Mirrors `toneMappings` in PaperLighting. */
const toneMappingModes: Record<FilmName, ToneMappingMode> = {
  agx: ToneMappingMode.AGX,
  neutral: ToneMappingMode.NEUTRAL,
  filmic: ToneMappingMode.ACES_FILMIC,
}

export function Grade({ grade, film }: { grade: StageGradeConfig; film: FilmName }) {
  const bloom = grade.bloom > 0
  const depth = grade.depth > 0
  const vignette = grade.vignette > 0
  const grain = grade.grain > 0

  // A composer is a full-screen render target and a second pass over every
  // pixel. A stage graded to nothing should not pay for one — and crucially,
  // must not MOUNT one, because an empty composer would still take the tone
  // curve off the renderer and hand back nothing.
  if (!bloom && !depth && !vignette && !grain) return null

  return (
    <EffectComposer>
      {/*
        Order is the whole correctness argument here.

        Bloom reads the scene while it is still HDR — that is what lets a
        threshold near 1.0 mean "brighter than paper" rather than "brighter
        than whatever the curve happened to flatten paper to". Tone mapping
        then lands the result in display range, and vignette and grain come
        after it because both are darkroom moves on a finished print, not
        light in the room.
      */}
      {bloom ? (
        <Bloom
          intensity={grade.bloom}
          luminanceThreshold={grade.threshold}
          luminanceSmoothing={0.22}
          mipmapBlur
        />
      ) : null}
      {/*
        Depth goes with bloom on the HDR side, before the curve, because a
        blur of tone-mapped pixels averages DISPLAY values and a blur of
        scene values averages light. Only the second one puts a bright
        highlight's glow into the soft region, which is the entire reason a
        real lens's out-of-focus areas look the way they do.

        `focusDistance` is normalized against the camera's far plane, and the
        stage's camera stands ON the walk looking down it — so the focal
        plane sits a little ahead of the viewer and both ends fall away.
      */}
      {depth ? (
        <DepthOfField
          // Normalized against the camera's far plane, which this scene sets
          // to 400 — so 0.008 is roughly three units out, which is where the
          // banner you are standing in front of actually is. The first pass
          // at this focused eight units away and put the focal plane in the
          // empty air past the paper, so nothing in frame was sharp.
          focusDistance={0.008}
          focalLength={0.02 + grade.depth * 0.04}
          bokehScale={grade.depth * 2.5}
        />
      ) : null}
      <ToneMapping mode={toneMappingModes[film]} />
      {vignette ? <Vignette offset={0.32} darkness={grade.vignette} /> : null}
      {/*
        OVERLAY rather than NORMAL: grain added flat lifts the blacks and
        turns a dark hall grey. Overlay leaves them where they are and puts
        the texture into the midtones, which is where film grain lives.
      */}
      {grain ? <Noise opacity={grade.grain} blendFunction={BlendFunction.OVERLAY} /> : null}
    </EffectComposer>
  )
}
