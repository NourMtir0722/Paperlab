import { z } from 'zod'
import type { Deformer } from './types'

export const foldOptionsSchema = z.object({
  /** Direction of the fold travel in the sheet plane, degrees (the crease line runs perpendicular). */
  angle: z.number().min(-360).max(360).default(90),
  /** Signed distance of the crease line from the sheet center, along the travel direction. */
  offset: z.number().min(-20).max(20).default(0),
  /** How far the flap folds over, degrees. 180 = flat against the sheet. */
  foldAngle: z.number().min(-180).max(180).default(90),
  /** Width of the soft hinge — paper never creases to a mathematical edge. */
  radius: z.number().min(0.005).max(0.5).default(0.04),
})

export type FoldOptions = z.infer<typeof foldOptionsSchema>

const DEG = Math.PI / 180

/**
 * Angular crease across a line: within the hinge width the sheet wraps a
 * small cylinder (a roll), beyond it the flap continues rigid at the full
 * fold angle. n folds = n instances stacked (half-fold, letter-fold,
 * accordion). Arc-length preserving like every Paperlab deformer.
 */
export const fold: Deformer<FoldOptions> = {
  id: 'fold',
  label: 'Fold',
  defaults: foldOptionsSchema.parse({}),
  optionsSchema: foldOptionsSchema,
  geometry: { minSegments: 48 },
  displace(out, _uv, o) {
    const phi = o.foldAngle * DEG
    if (Math.abs(phi) < 1e-6) return
    const dirX = Math.cos(o.angle * DEG)
    const dirY = Math.sin(o.angle * DEG)
    const d = out.x * dirX + out.y * dirY
    const s = d - o.offset
    if (s <= 0) return

    // Signed hinge cylinder: radius R = radius/phi carries the fold
    // direction, so one code path serves folds up and down.
    const R = o.radius / phi
    let newD: number
    let newZ: number
    if (s <= o.radius) {
      // Inside the hinge: identical to a roll of signed radius R.
      const theta = (s / o.radius) * phi
      const sin = Math.sin(theta)
      const cos = Math.cos(theta)
      newD = o.offset + (R - out.z) * sin
      newZ = R * (1 - cos) + out.z * cos
    } else {
      // Past the hinge: rigid flap continuing from the arc's end along its
      // tangent; incoming z rides the rotated surface normal.
      const rest = s - o.radius
      const sin = Math.sin(phi)
      const cos = Math.cos(phi)
      newD = o.offset + R * sin + rest * cos - out.z * sin
      newZ = R * (1 - cos) + rest * sin + out.z * cos
    }

    out.x += dirX * (newD - d)
    out.y += dirY * (newD - d)
    out.z = newZ
  },
  glsl: {
    chunk: /* glsl */ `
void FN(inout vec3 p, vec2 uv, float t) {
  if (abs(U_foldAngle) < 1e-6) return;
  vec2 dir = vec2(cos(U_angle), sin(U_angle));
  float d = dot(p.xy, dir);
  float s = d - U_offset;
  if (s <= 0.0) return;
  float R = U_radius / U_foldAngle;
  float newD;
  float newZ;
  if (s <= U_radius) {
    float theta = (s / U_radius) * U_foldAngle;
    float sn = sin(theta);
    float cs = cos(theta);
    newD = U_offset + (R - p.z) * sn;
    newZ = R * (1.0 - cs) + p.z * cs;
  } else {
    float rest = s - U_radius;
    float sn = sin(U_foldAngle);
    float cs = cos(U_foldAngle);
    newD = U_offset + R * sn + rest * cs - p.z * sn;
    newZ = R * (1.0 - cs) + rest * sn + p.z * cs;
  }
  p.xy += dir * (newD - d);
  p.z = newZ;
}
`,
    uniforms: (o) => ({
      angle: o.angle * DEG,
      offset: o.offset,
      foldAngle: o.foldAngle * DEG,
      radius: o.radius,
    }),
  },
}
