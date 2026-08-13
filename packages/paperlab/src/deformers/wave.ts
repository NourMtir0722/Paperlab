import { z } from 'zod'
import type { Deformer } from './types'
import { segmentsForSine, spanAlong } from '../core/tessellation'

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
  geometry: {
    minSegments: 32,
    // `displace` is sin(phase) + 0.35·sin(2.7·phase). The harmonic is a
    // third the amplitude but curvature carries the SQUARE of the frequency,
    // so 0.35 × 2.7² ≈ 2.6 — the quiet term is the one that sets the grid,
    // by a factor of two and a half. Take whichever asks for more anyway.
    autoSegments: (o, sheet) => {
      const span = spanAlong(sheet, o.angle)
      return Math.max(
        segmentsForSine(span, o.amplitude, o.wavelength),
        segmentsForSine(span, o.amplitude * 0.35, o.wavelength / 2.7),
      )
    },
  },
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
  glsl: {
    chunk: /* glsl */ `
void FN(inout vec3 p, vec2 uv, float t) {
  if (U_amplitude == 0.0) return;
  vec2 dir = vec2(cos(U_angle), sin(U_angle));
  float d = dot(p.xy, dir);
  float phase = (d / U_wavelength - U_speed * t) * 6.283185307179586;
  float env = 1.0;
  if (U_pin == 1.0) env = 1.0 - uv.y;
  else if (U_pin == 2.0) env = uv.y;
  else if (U_pin == 3.0) env = uv.x;
  else if (U_pin == 4.0) env = 1.0 - uv.x;
  p.z += U_amplitude * env * (sin(phase) + 0.35 * sin(phase * 2.7 + 1.3));
}
`,
    strength: 'amplitude',
    uniforms: (o) => ({
      amplitude: o.amplitude,
      wavelength: o.wavelength,
      speed: o.speed,
      angle: o.angle * DEG,
      pin: { none: 0, top: 1, bottom: 2, left: 3, right: 4 }[o.pinnedEdge],
    }),
  },
}
