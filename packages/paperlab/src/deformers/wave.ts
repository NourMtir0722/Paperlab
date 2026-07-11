import { z } from 'zod'
import type { Deformer } from './types'

export const waveOptionsSchema = z.object({
  amplitude: z.number().min(0).max(0.3).default(0.04),
  wavelength: z.number().min(0.05).max(2).default(0.5),
  /** Travel speed; 0 freezes the ripple. */
  speed: z.number().min(0).max(3).default(0.8),
  /** Travel direction in the sheet plane, degrees. */
  angle: z.number().min(-360).max(360).default(90),
  /** Zero the displacement at one edge (a taped/pinned edge doesn't ripple). */
  pinnedEdge: z.enum(['none', 'top', 'bottom', 'left', 'right']).default('none'),
})

export type WaveOptions = z.infer<typeof waveOptionsSchema>

const DEG = Math.PI / 180
const TAU = Math.PI * 2

/**
 * Traveling sine displacement with a quieter second harmonic — idle flutter
 * and wind ripple. The only time-driven deformer so far: stacks containing
 * it re-deform every frame.
 */
export const wave: Deformer<WaveOptions> = {
  id: 'wave',
  label: 'Wave',
  defaults: waveOptionsSchema.parse({}),
  optionsSchema: waveOptionsSchema,
  geometry: { minSegments: 32 },
  animated: true,
  displace(out, uv, o, ctx) {
    if (o.amplitude === 0) return
    const dirX = Math.cos(o.angle * DEG)
    const dirY = Math.sin(o.angle * DEG)
    const d = out.x * dirX + out.y * dirY
    const phase = (d / o.wavelength - o.speed * ctx.t) * TAU
    let env = 1
    if (o.pinnedEdge === 'top') env = 1 - uv.y
    else if (o.pinnedEdge === 'bottom') env = uv.y
    else if (o.pinnedEdge === 'left') env = uv.x
    else if (o.pinnedEdge === 'right') env = 1 - uv.x
    out.z += o.amplitude * env * (Math.sin(phase) + 0.35 * Math.sin(phase * 2.7 + 1.3))
  },
}
