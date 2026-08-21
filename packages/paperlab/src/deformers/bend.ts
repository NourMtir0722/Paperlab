import { z } from 'zod'
import type { Deformer } from './types'
import { segmentsForArc, spanAlong } from '../core/tessellation'

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
 * `sin(x) − x`, without the cancellation that eats it for small x.
 *
 * The arc's in-plane shift is `r·sin θ − d`, and `d` IS `r·θ` — so for a
 * gentle bend it is a difference of two nearly-equal large numbers, and the
 * answer is the few bits that survive. JS computes that in float64 and gets
 * away with it; the GLSL twin computes it in float32 and does not, which put
 * the two paths 6e-4 apart at low curvature — past the parity gate's epsilon.
 * The series is exact to well under a float32 ulp below |x| = 1 and both
 * implementations take the same branch, so the two paths agree by
 * construction rather than by luck.
 */
function sinMinusX(x: number): number {
  if (Math.abs(x) > 1) return Math.sin(x) - x
  const x2 = x * x
  return ((-x * x2) / 6) * (1 - (x2 / 20) * (1 - (x2 / 42) * (1 - x2 / 72)))
}

/**
 * Gentle global arc around a cylinder centered on the sheet — a standing
 * paper's lean. Arc-length preserving, like roll, but symmetric about the
 * center instead of one-sided.
 *
 * Written in its cancellation-free form throughout: `r(1 − cos θ)` is
 * `2r·sin²(θ/2)`, and the in-plane shift goes through `sinMinusX`. Same arc,
 * same numbers to sixteen places — it is only the float32 half that could
 * tell the difference, and that is exactly the half the parity gate checks.
 */
export const bend: Deformer<BendOptions> = {
  id: 'bend',
  label: 'Bend',
  defaults: bendOptionsSchema.parse({}),
  optionsSchema: bendOptionsSchema,
  geometry: {
    minSegments: 16,
    // A pure circular arc of radius 1/curvature, so the sagitta form answers
    // this exactly. This is the deformer the old flat 72 over-served most:
    // at the default 0.6 it wants 24, and the field starter preset is a bend.
    autoSegments: (o, sheet) => segmentsForArc(spanAlong(sheet, o.angle), 1 / Math.abs(o.curvature)),
    axis: (o) => o.angle,
  },
  displace(out, _uv, o) {
    if (Math.abs(o.curvature) < EPS) return
    const dirX = Math.cos(o.angle * DEG)
    const dirY = Math.sin(o.angle * DEG)
    const d = out.x * dirX + out.y * dirY

    const r = 1 / o.curvature
    const theta = d * o.curvature
    const sin = Math.sin(theta)
    const halfSin = Math.sin(theta * 0.5)
    const z0 = out.z

    // (r − z)·sin θ − d, with d = r·θ folded in so the big terms never meet.
    const shift = r * sinMinusX(theta) - z0 * sin
    out.x += dirX * shift
    out.y += dirY * shift
    out.z = 2 * r * halfSin * halfSin + z0 * Math.cos(theta)
  },
  glsl: {
    chunk: /* glsl */ `
float FN_sinm(float x) {
  if (abs(x) > 1.0) return sin(x) - x;
  float x2 = x * x;
  return (-x * x2 / 6.0) * (1.0 - (x2 / 20.0) * (1.0 - (x2 / 42.0) * (1.0 - x2 / 72.0)));
}

void FN(inout vec3 p, vec2 uv, float t) {
  if (abs(U_curvature) < 1e-5) return;
  vec2 dir = vec2(cos(U_angle), sin(U_angle));
  float d = dot(p.xy, dir);
  float r = 1.0 / U_curvature;
  float theta = d * U_curvature;
  float sn = sin(theta);
  float hs = sin(theta * 0.5);
  float z0 = p.z;
  float shift = r * FN_sinm(theta) - z0 * sn;
  p.xy += dir * shift;
  p.z = 2.0 * r * hs * hs + z0 * cos(theta);
}
`,
    strength: 'curvature',
    uniforms: (o) => ({ curvature: o.curvature, angle: o.angle * DEG }),
  },
}
