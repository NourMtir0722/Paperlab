import { z } from 'zod'
import type { Deformer } from './types'

export const bendOptionsSchema = z.object({
  /** 1/radius in world units; sign flips the arc direction. 0 = flat. */
  curvature: z.number().min(-4).max(4).default(0.6),
  /** Bend axis direction in the sheet plane, degrees. 0 bends across x. */
  angle: z.number().min(-360).max(360).default(0),
})

export type BendOptions = z.infer<typeof bendOptionsSchema>

const DEG = Math.PI / 180
const EPS = 1e-5

/**
 * Gentle global arc around a cylinder centered on the sheet — a standing
 * paper's lean. Arc-length preserving, like roll, but symmetric about the
 * center instead of one-sided.
 */
export const bend: Deformer<BendOptions> = {
  id: 'bend',
  label: 'Bend',
  defaults: bendOptionsSchema.parse({}),
  optionsSchema: bendOptionsSchema,
  geometry: { minSegments: 16 },
  displace(out, _uv, o) {
    if (Math.abs(o.curvature) < EPS) return
    const dirX = Math.cos(o.angle * DEG)
    const dirY = Math.sin(o.angle * DEG)
    const d = out.x * dirX + out.y * dirY

    const r = 1 / o.curvature
    const theta = d / r
    const sin = Math.sin(theta)
    const cos = Math.cos(theta)
    const newD = (r - out.z) * sin
    const newZ = r * (1 - cos) + out.z * cos

    out.x += dirX * (newD - d)
    out.y += dirY * (newD - d)
    out.z = newZ
  },
  glsl: {
    chunk: /* glsl */ `
void FN(inout vec3 p, vec2 uv, float t) {
  if (abs(U_curvature) < 1e-5) return;
  vec2 dir = vec2(cos(U_angle), sin(U_angle));
  float d = dot(p.xy, dir);
  float r = 1.0 / U_curvature;
  float theta = d / r;
  float sn = sin(theta);
  float cs = cos(theta);
  float newD = (r - p.z) * sn;
  float newZ = r * (1.0 - cs) + p.z * cs;
  p.xy += dir * (newD - d);
  p.z = newZ;
}
`,
    strength: 'curvature',
    uniforms: (o) => ({ curvature: o.curvature, angle: o.angle * DEG }),
  },
}
