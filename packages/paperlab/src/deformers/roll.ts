import { z } from 'zod'
import type { Deformer } from './types'

export const rollOptionsSchema = z.object({
  /** Direction of rolling in the sheet plane, degrees. 0 = +x, 90 = +y. */
  angle: z.number().min(-360).max(360).default(90),
  /** Signed distance (along the roll direction, from sheet center) where the roll begins. */
  boundary: z.number().min(-20).max(20).default(0),
  /** Cylinder radius — sharpness of the roll. */
  radius: z.number().min(0.01).max(2).default(0.12),
  /** Radius growth per radian so multi-turn rolls spiral instead of z-fighting. */
  spiral: z.number().min(0).max(0.2).default(0.015),
})

export type RollOptions = z.infer<typeof rollOptionsSchema>

const DEG = Math.PI / 180

/**
 * Wrap the sheet around a virtual cylinder lying across the roll direction.
 * Everything past `boundary` wraps; the wrap is C¹-continuous at the
 * boundary and preserves arc length (content never stretches).
 *
 * Points arriving with z ≠ 0 (from earlier deformers in the stack) ride
 * along the rolled surface's normal, so stacks compose sanely.
 */
export const roll: Deformer<RollOptions> = {
  id: 'roll',
  label: 'Roll',
  defaults: rollOptionsSchema.parse({}),
  optionsSchema: rollOptionsSchema,
  geometry: { minSegments: 48 },
  displace(out, _uv, o) {
    const dirX = Math.cos(o.angle * DEG)
    const dirY = Math.sin(o.angle * DEG)
    const d = out.x * dirX + out.y * dirY
    const s = d - o.boundary
    if (s <= 0) return

    const theta = s / o.radius
    const r = o.radius + o.spiral * theta
    const sin = Math.sin(theta)
    const cos = Math.cos(theta)
    // Surface point on the cylinder + incoming z offset along the surface normal.
    const newD = o.boundary + (r - out.z) * sin
    const newZ = r * (1 - cos) + out.z * cos

    out.x += dirX * (newD - d)
    out.y += dirY * (newD - d)
    out.z = newZ
  },
}
