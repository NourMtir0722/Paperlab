import { z } from 'zod'
import type { Deformer } from './types'
import { segmentsForSine } from '../core/tessellation'

export const drapeOptionsSchema = z.object({
  /** Fold depth at the free edge, world units. */
  amplitude: z.number().min(0).max(0.6).default(0.12),
  /** How many folds run down the drop. */
  folds: z.number().min(0.5).max(16).default(4),
  /**
   * How fast folds deepen away from the pinned edge. 1 is linear; higher
   * holds the top flat and gathers all the movement at the free end, which
   * is what a sheet hung from a rod actually does.
   */
  falloff: z.number().min(0.3).max(4).default(1.6),
  /** How much a second, non-harmonic fold breaks the regularity. */
  irregular: z.number().min(0).max(1).default(0.45),
  /** How much the sheet narrows as its folds deepen. */
  gather: z.number().min(0).max(1).default(0.5),
  pinnedEdge: z.enum(['top', 'bottom']).default('top'),
})

export type DrapeOptions = z.infer<typeof drapeOptionsSchema>

const TAU = Math.PI * 2

/**
 * Hung paper: vertical folds running the length of the drop, shallow at the
 * fixed edge and deepening toward the free one.
 *
 * `wave` can put ripples on a sheet, but a traveling sine is a flag, not a
 * curtain — it kinks the sheet ACROSS its drop and it is uniform end to end.
 * Cloth hung from an edge does the opposite: the folds run WITH the drop and
 * they grow as they get further from whatever is holding the sheet up. Two
 * details do most of the work:
 *
 * - the folds are not harmonic. A pure sine reads as corrugated metal, so a
 *   second wave at an incommensurate frequency breaks the repeat.
 * - gathered paper is narrower than flat paper. Pulling the surface toward
 *   its centerline in proportion to fold depth is what stops the drape from
 *   looking like a texture painted on a rectangle.
 */
export const drape: Deformer<DrapeOptions> = {
  id: 'drape',
  label: 'Drape',
  defaults: drapeOptionsSchema.parse({}),
  optionsSchema: drapeOptionsSchema,
  geometry: {
    minSegments: 48,
    // `folds` fold across the width, so the wavelength is width/folds, and
    // the irregular term rides at 1.7x that frequency. Same reasoning as
    // wave: the faster term usually wins despite the smaller amplitude.
    autoSegments: (o, sheet) => {
      if (o.folds <= 0) return 0
      const lambda = sheet.width / o.folds
      return Math.max(
        segmentsForSine(sheet.width, o.amplitude, lambda),
        segmentsForSine(sheet.width, o.amplitude * 0.6 * o.irregular, lambda / 1.7),
      )
    },
  },
  displace(out, uv, o) {
    if (o.amplitude === 0) return
    // Distance from the pinned edge, 0 at the fixing and 1 at the free end.
    const drop = o.pinnedEdge === 'top' ? 1 - uv.y : uv.y
    const depth = drop ** o.falloff
    const u = uv.x * TAU * o.folds
    const fold = Math.sin(u) + o.irregular * 0.6 * Math.sin(u * 1.7 + 2.1)
    out.z += o.amplitude * depth * fold
    const pinch = o.gather * depth * Math.min(o.amplitude * o.folds * 0.8, 0.6)
    out.x *= 1 - pinch
  },
  glsl: {
    chunk: /* glsl */ `
void FN(inout vec3 p, vec2 uv, float t) {
  if (U_amplitude == 0.0) return;
  float drop = U_pin == 1.0 ? 1.0 - uv.y : uv.y;
  float depth = pow(drop, U_falloff);
  float u = uv.x * 6.283185307179586 * U_folds;
  float fold = sin(u) + U_irregular * 0.6 * sin(u * 1.7 + 2.1);
  p.z += U_amplitude * depth * fold;
  float pinch = U_gather * depth * min(U_amplitude * U_folds * 0.8, 0.6);
  p.x *= 1.0 - pinch;
}
`,
    strength: 'amplitude',
    uniforms: (o) => ({
      amplitude: o.amplitude,
      folds: o.folds,
      falloff: o.falloff,
      irregular: o.irregular,
      gather: o.gather,
      pin: o.pinnedEdge === 'top' ? 1 : 2,
    }),
  },
}
