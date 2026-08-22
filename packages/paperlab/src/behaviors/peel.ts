import { z } from 'zod'
import type { Behavior } from './types'
import { cornerNames } from '../deformers/curl'

export const peelOptionsSchema = z.object({
  progress: z.number().min(0).max(1).default(0.35),
  /** 'auto' resolves per slot in a `sheet` field (outward-facing corner); standalone it means bottom-right. */
  corner: z.enum([...cornerNames, 'auto']).default('bottom-right'),
  /** Curl sharpness — small is a tight dog-ear, large a soft lift. */
  radius: z.number().min(0.05).max(0.6).default(0.16),
})

export type PeelOptions = z.infer<typeof peelOptionsSchema>

const CORNER_UV: Record<(typeof cornerNames)[number], [number, number]> = {
  'top-left': [0, 1],
  'top-right': [1, 1],
  'bottom-left': [0, 0],
  'bottom-right': [1, 0],
}

/** Fields resolve 'auto' per slot; anywhere else it falls back to the default corner. */
const concreteCorner = (c: PeelOptions['corner']) => (c === 'auto' ? 'bottom-right' : c)

/** A corner lifts and curls back — the hero-image hover peel. */
export const peel: Behavior<PeelOptions> = {
  id: 'peel',
  label: 'Peel',
  defaults: peelOptionsSchema.parse({}),
  optionsSchema: peelOptionsSchema,
  signature: ['progress', 'corner'],
  progressParam: 'progress',
  duration: 2.2,
  loopMode: 'yoyo',
  stack(o) {
    // A deep peel lifts on a softer cylinder — a fixed tight radius would
    // wind the sheet into a dart. Growing the radius with progress keeps the
    // curl reading as a page lift at every depth.
    return [
      {
        type: 'curl',
        options: {
          corner: concreteCorner(o.corner),
          amount: o.progress,
          radius: o.radius + o.progress * 0.3,
          skew: 0,
        },
      },
    ]
  },
  handles: [
    {
      id: 'corner',
      anchor: (o) => CORNER_UV[concreteCorner(o.corner)],
      drag(local, o, sheet) {
        // Pull toward the sheet center = more peel: distance from the flat
        // corner along the inward diagonal, normalized to half the diagonal.
        const [ux, uy] = CORNER_UV[concreteCorner(o.corner)]
        const cx = (ux - 0.5) * sheet.width
        const cy = (uy - 0.5) * sheet.height
        const diag = Math.hypot(sheet.width, sheet.height)
        const inX = -cx / Math.hypot(cx, cy)
        const inY = -cy / Math.hypot(cx, cy)
        const dist = (local.x - cx) * inX + (local.y - cy) * inY
        return { progress: Math.min(1, Math.max(0, dist / (diag * 0.5))) }
      },
    },
  ],
}
