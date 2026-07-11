import { z } from 'zod'
import type { Deformer } from './types'

export const cornerNames = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const

export const curlOptionsSchema = z.object({
  corner: z.enum(cornerNames).default('bottom-right'),
  /** How far the curl has traveled from the corner, as a fraction of the diagonal. */
  amount: z.number().min(0).max(1).default(0.35),
  /** Cylinder radius — curl sharpness. */
  radius: z.number().min(0.02).max(1).default(0.16),
  /** Skew of the fold line away from the corner diagonal, degrees. */
  skew: z.number().min(-40).max(40).default(0),
})

export type CurlOptions = z.infer<typeof curlOptionsSchema>

const DEG = Math.PI / 180

const CORNER_SIGNS: Record<(typeof cornerNames)[number], [number, number]> = {
  'top-left': [-1, 1],
  'top-right': [1, 1],
  'bottom-left': [-1, -1],
  'bottom-right': [1, -1],
}

/**
 * Corner-anchored cylinder wrap — the peel/dog-ear deformer, and the
 * crown-jewel realism case: the mesh genuinely wraps the cylinder so content
 * bends with perfect continuity and the backside becomes visible.
 *
 * The fold line runs perpendicular to the corner diagonal and travels inward
 * with `amount`; everything cornerward of it wraps around the cylinder.
 */
export const curl: Deformer<CurlOptions> = {
  id: 'curl',
  label: 'Curl',
  defaults: curlOptionsSchema.parse({}),
  optionsSchema: curlOptionsSchema,
  geometry: { minSegments: 48 },
  displace(out, _uv, o, ctx) {
    const [sx, sy] = CORNER_SIGNS[o.corner]
    const { width, height } = ctx.sheet
    const cx = (sx * width) / 2
    const cy = (sy * height) / 2

    // Outward direction: from sheet center toward the corner, plus skew.
    const diag = Math.hypot(width, height)
    const baseX = (sx * width) / diag
    const baseY = (sy * height) / diag
    const skew = o.skew * DEG
    const cosK = Math.cos(skew)
    const sinK = Math.sin(skew)
    const dirX = baseX * cosK - baseY * sinK
    const dirY = baseX * sinK + baseY * cosK

    // Signed distance past the fold line (fold travels inward with amount).
    const travel = o.amount * diag * 0.5
    const e = (out.x - cx) * dirX + (out.y - cy) * dirY
    const s = e + travel
    if (s <= 0) return

    const theta = s / o.radius
    const sin = Math.sin(theta)
    const cos = Math.cos(theta)
    const boundary = e - s // = -travel
    const newE = boundary + (o.radius - out.z) * sin
    const newZ = o.radius * (1 - cos) + out.z * cos

    out.x += dirX * (newE - e)
    out.y += dirY * (newE - e)
    out.z = newZ
  },
}
