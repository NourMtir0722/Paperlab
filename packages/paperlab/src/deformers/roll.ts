import { z } from 'zod'
import type { Deformer } from './types'
import { segmentsForArc, spanAlong } from '../core/tessellation'

export const rollOptionsSchema = z.object({
  /** Direction of rolling in the sheet plane, degrees. 0 = +x, 90 = +y. */
  angle: z.number().min(-360).max(360).default(90),
  /** Signed distance (along the roll direction, from sheet center) where the roll begins. */
  boundary: z.number().min(-20).max(20).default(0),
  /** Radius of the OUTERMOST wrap — the one the flat sheet leaves the roll on. */
  radius: z.number().min(0.01).max(2).default(0.12),
  /** Gap between consecutive wraps, in world units. 0 = a bare cylinder. */
  thickness: z.number().min(0).max(0.2).default(0.015),
})

export type RollOptions = z.infer<typeof rollOptionsSchema>

const DEG = Math.PI / 180
const TAU = Math.PI * 2

/**
 * How far in the spiral is allowed to wind, as a fraction of its outer
 * radius. Paper past that point keeps coiling at a constant radius instead.
 *
 * A spiral that runs all the way to zero collapses every remaining vertex
 * onto one point: degenerate triangles, no normals, an unlit hole in the
 * sheet. Sizing a roll with {@link rollRadius} never reaches here, but
 * `roll` is public and its options are independent numbers, so "more paper
 * than fits" has to land somewhere survivable rather than somewhere invalid.
 */
const MIN_RADIUS_FRACTION = 0.08

/**
 * Angle swept after winding arc length `s` onto a spiral that starts at
 * radius `r0` and loses `k` of it per radian.
 *
 * Arc length along that spiral is `s = r0·θ − k·θ²/2`, so θ is the smaller
 * root of the quadratic. Written rationalized (`2s / (r0 + √disc)`) rather
 * than as `(r0 − √disc) / k`: the two are equal in exact arithmetic, but the
 * subtractive form cancels catastrophically as k → 0 — precisely the common
 * case, a plain cylinder — and divides by k on top of that.
 *
 * Past the point where the radius would fall below its floor, the spiral
 * continues as a circle at that radius, which keeps the map C¹ and the
 * geometry non-degenerate.
 */
export function windAngle(s: number, r0: number, k: number): number {
  if (k <= 0) return s / r0
  const rMin = r0 * MIN_RADIUS_FRACTION
  const thetaFloor = (r0 - rMin) / k
  const sFloor = r0 * thetaFloor - (k * thetaFloor * thetaFloor) / 2
  if (s >= sFloor) return thetaFloor + (s - sFloor) / rMin
  return (2 * s) / (r0 + Math.sqrt(r0 * r0 - 2 * k * s))
}

/** Radius reached after sweeping `theta`, floored so the coil never collapses. */
export function windRadius(theta: number, r0: number, k: number): number {
  return Math.max(r0 - k * theta, r0 * MIN_RADIUS_FRACTION)
}

/**
 * Outer radius of a roll holding `length` of paper wound onto a core of
 * radius `core` at the given layer `thickness`.
 *
 * The Archimedean identity `L = π(R² − core²) / thickness`, solved for R.
 * It is the exact inverse of what {@link roll} does, which is the property
 * that matters: size a roll with this and its innermost wrap lands precisely
 * on `core` — the paper runs out exactly when the spiral reaches the tube,
 * rather than overshooting into a negative radius or stopping short.
 */
export function rollRadius(length: number, core: number, thickness: number): number {
  return Math.sqrt(core * core + (Math.max(0, length) * thickness) / Math.PI)
}

/**
 * Wrap the sheet around a roll lying across the roll direction. Everything
 * past `boundary` winds; the wrap is C¹-continuous at the boundary and
 * preserves arc length (content never stretches).
 *
 * The paper winds INWARD — the far end of the sheet ends up at the core, and
 * the flat portion leaves from the outermost wrap. That is the only way round
 * that a real roll can be: paper is dispensed off the outside, so the end you
 * are holding must be the outermost layer.
 *
 * The circle's centre is FIXED at `radius` above the boundary and only the
 * radius varies, which is what makes the wraps concentric. Deriving the
 * centre from the current radius instead — the obvious way to write this, and
 * what this deformer did until the geometry was checked — pins every wrap
 * tangent to the plane at the same point, so the wraps form a rosette of
 * circles through one point rather than a spiral, and the sheet passes
 * through itself once per revolution. That bug is invisible at `thickness`
 * 0 (a true cylinder does return to its start) and exactly cancels at every
 * multiple of 2π, so it survived both the golden vectors and the GPU parity
 * gate: they agreed with each other, and both were wrong.
 *
 * Points arriving with z ≠ 0 (from earlier deformers in the stack) ride
 * along the rolled surface's inward normal, so stacks compose sanely.
 */
export const roll: Deformer<RollOptions> = {
  id: 'roll',
  label: 'Roll',
  defaults: rollOptionsSchema.parse({}),
  optionsSchema: rollOptionsSchema,
  geometry: {
    minSegments: 48,
    // The INNERMOST wrap is the tightest curvature on the sheet, so it sets
    // the density — the outer one used to, back when the spiral grew outward.
    // Floored at a fraction of the outer radius because segment count scales
    // as 1/√r: a roll wound to a hair's breadth would otherwise ask for a
    // grid nobody can afford, to resolve a few square millimetres at the core.
    autoSegments: (o, sheet) => {
      const span = spanAlong(sheet, o.angle)
      const wound = Math.max(0, span / 2 - o.boundary)
      const k = o.thickness / TAU
      return segmentsForArc(span, windRadius(windAngle(wound, o.radius, k), o.radius, k))
    },
    axis: (o) => o.angle,
  },
  displace(out, _uv, o) {
    const dirX = Math.cos(o.angle * DEG)
    const dirY = Math.sin(o.angle * DEG)
    const d = out.x * dirX + out.y * dirY
    const s = d - o.boundary
    if (s <= 0) return

    const k = o.thickness / TAU
    const theta = windAngle(s, o.radius, k)
    // Incoming z rides the inward normal, so it shortens the radius.
    const r = windRadius(theta, o.radius, k) - out.z
    const newD = o.boundary + r * Math.sin(theta)
    const newZ = o.radius - r * Math.cos(theta)

    out.x += dirX * (newD - d)
    out.y += dirY * (newD - d)
    out.z = newZ
  },
  glsl: {
    chunk: /* glsl */ `
void FN(inout vec3 p, vec2 uv, float t) {
  vec2 dir = vec2(cos(U_angle), sin(U_angle));
  float d = dot(p.xy, dir);
  float s = d - U_boundary;
  if (s <= 0.0) return;
  float k = U_thickness / 6.2831853071795864;
  float rMin = U_radius * 0.08;
  float thetaFloor = (U_radius - rMin) / max(k, 1e-9);
  float sFloor = U_radius * thetaFloor - 0.5 * k * thetaFloor * thetaFloor;
  float theta = k <= 0.0
    ? s / U_radius
    : (s >= sFloor
        ? thetaFloor + (s - sFloor) / rMin
        : (2.0 * s) / (U_radius + sqrt(U_radius * U_radius - 2.0 * k * s)));
  float r = max(U_radius - k * theta, rMin) - p.z;
  float newD = U_boundary + r * sin(theta);
  float newZ = U_radius - r * cos(theta);
  p.xy += dir * (newD - d);
  p.z = newZ;
}
`,
    uniforms: (o) => ({
      angle: o.angle * DEG,
      boundary: o.boundary,
      radius: o.radius,
      thickness: o.thickness,
    }),
  },
}
