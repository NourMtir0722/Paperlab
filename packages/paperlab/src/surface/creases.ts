import type { CreaseConfig, SurfaceConfig } from '../config/schema'
import { spanAlong } from '../core/tessellation'
import { MAX_SET } from '../deformers/memory'

/** How many crease lines the shader carries. */
const MAX_SHADED = 4

/** One crease in the terms the crease shader wants. */
export interface CreaseShading {
  /** Direction of the crease LINE, degrees. */
  angle: number
  /** Where the line sits across the sheet, 0..1. */
  position: number
  /** How hard it reads, 0..1. */
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
 */
export function resolveCreases(
  surface: SurfaceConfig,
  creases: CreaseConfig[],
  sheet: { width: number; height: number },
): CreaseShading[] {
  const out: CreaseShading[] = []

  const lines = surface.creaseLines
  if (lines) {
    for (const position of lines.positions) {
      out.push({ angle: lines.angle, position, strength: lines.strength })
    }
  }

  for (const crease of creases) {
    out.push(creaseShading(crease, sheet))
  }

  if (out.length > MAX_SHADED) out.length = MAX_SHADED
  return out
}

/**
 * A remembered crease as the fragment shader draws it.
 *
 * Two conversions, and both are places the geometry and the shading could
 * silently disagree. `fold.angle` is the direction the fold TRAVELS and the
 * crease line runs across it, while the shader's angle IS the line — hence
 * the 90. And `fold.offset` is a signed world distance from the centre while
 * the shader works in 0..1 across the sheet, hence the span.
 *
 * The span conversion is exact for a crease square to an edge, which is every
 * crease any built-in behavior makes, and approximate for a diagonal one —
 * the shader measures in UV, where the sheet's own aspect has already been
 * divided out. That is a property of the crease effect as it has always been
 * (`creaseLines.positions` are UV fractions too), not something memory
 * introduces.
 */
export function creaseShading(crease: CreaseConfig, sheet: { width: number; height: number }): CreaseShading {
  const span = spanAlong(sheet, crease.angle)
  return {
    angle: crease.angle - 90,
    position: span > 0 ? 0.5 + crease.offset / span : 0.5,
    // A crease reads hardest around a right angle and then saturates: a sheet
    // folded flat and reopened is not four times the mark of one folded to
    // 45°, it is a slightly harder version of the same line. The divisor is
    // the depth a 90° fold leaves in paper that remembers everything — read
    // off `MAX_SET` rather than written out, so retuning how much paper keeps
    // cannot leave the shading calibrated against the old answer.
    strength: Math.min(1, Math.abs(crease.depth) / (90 * MAX_SET)),
  }
}
