import type { CreaseConfig, SurfaceConfig } from '../config/schema'
import { spanAlong } from '../core/tessellation'
import { MAX_SET } from '../deformers/memory'

/** How many crease lines the shader carries. */
const MAX_SHADED = 4

/**
 * One crease in the terms the crease shader wants — which are the terms
 * {@link CreaseConfig} and the `fold` deformer already use, and no longer a
 * translation of them.
 *
 * That is the whole point of this shape now. The shader used to be handed a
 * LINE direction and a 0..1 fraction across the sheet, so a remembered crease
 * had to be converted on the way in and the shader had to re-derive a
 * direction on the way out. Both conversions divided the sheet's own aspect
 * out, which is exact for a crease square to an edge and wrong for every
 * other one: a line scored at 45° across a 1.2 × 1.5 sheet came out at 51°.
 * Nobody noticed while creases only ever arrived from the built-in folds,
 * which are all axis-aligned. A fingertip scores them at any angle at all.
 *
 * So the shader now measures in the sheet's own local space, with the same
 * `dot(p.xy, dir) - offset` that `fold` displaces by, and the two cannot
 * disagree about where a line is because they are computing the same number.
 */
export interface CreaseShading {
  /** Direction the fold TRAVELS, degrees. The crease line runs across it. */
  angle: number
  /** Signed distance from the sheet's centre along `angle`, in world units. */
  offset: number
  /**
   * How hard it reads, −1..1, SIGNED: positive draws a ridge and negative a
   * groove.
   *
   * A fold toward the camera leaves paper that is concave from the front,
   * which is a valley — so a positive `depth` becomes a negative strength,
   * and the same crease seen from behind reads as the ridge it is. Unsigned
   * strength is why every crease used to render as the same grey smudge
   * whichever way the paper had been folded.
   */
  strength: number
}

/**
 * Everything that should draw as a crease line, from the two places creases
 * come from.
 *
 * `surface.creaseLines` is authored SHADING: a designer saying "put fold
 * marks here", with no geometry behind it. `memory.creases` is what the paper
 * has actually been folded along, and it bends the sheet as well as marking
 * it. They coexist because they answer different questions, and the authored
 * ones come first so that a hand-placed mark is never the one dropped at the
 * cap.
 *
 * The authored ones are the only ones converted, because they are the only
 * ones authored in a different language: `creaseLines` places lines as
 * fractions across the sheet, which is the right thing to type by hand and
 * the wrong thing to shade with.
 */
export function resolveCreases(
  surface: SurfaceConfig,
  creases: CreaseConfig[],
  sheet: { width: number; height: number },
): CreaseShading[] {
  const out: CreaseShading[] = []

  const lines = surface.creaseLines
  if (lines) {
    // `creaseLines.angle` is the direction of the LINE; everything downstream
    // speaks in the direction the fold travels, which is across it.
    const angle = lines.angle + 90
    const span = spanAlong(sheet, angle)
    for (const position of lines.positions) {
      out.push({ angle, offset: (position - 0.5) * span, strength: lines.strength })
    }
  }

  for (const crease of creases) {
    out.push(creaseShading(crease))
  }

  if (out.length > MAX_SHADED) out.length = MAX_SHADED
  return out
}

/**
 * A remembered crease as the fragment shader draws it — which is now the same
 * crease, with only its depth reinterpreted.
 *
 * A crease reads hardest around a right angle and then saturates: a sheet
 * folded flat and reopened is not four times the mark of one folded to 45°,
 * it is a slightly harder version of the same line. The divisor is the depth
 * a 90° fold leaves in paper that remembers everything — read off
 * {@link MAX_SET} rather than written out, so retuning how much paper keeps
 * cannot leave the shading calibrated against the old answer.
 *
 * The sign survives: see {@link CreaseShading.strength}.
 */
export function creaseShading(crease: CreaseConfig): CreaseShading {
  return {
    angle: crease.angle,
    offset: crease.offset,
    strength: Math.max(-1, Math.min(1, -crease.depth / (90 * MAX_SET))),
  }
}
