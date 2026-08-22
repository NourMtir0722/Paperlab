import { z } from 'zod'
import type { Behavior } from './types'

export const hangOptionsSchema = z.object({
  /** Wind strength driving the ripple. */
  wind: z.number().min(0).max(1).default(0.4),
  /** Gravity bulge of the hanging sheet. */
  sag: z.number().min(0).max(1).default(0.3),
})

export type HangOptions = z.infer<typeof hangOptionsSchema>

/** A poster hanging from its top edge, rippling in wind. */
export const hang: Behavior<HangOptions> = {
  id: 'hang',
  label: 'Hang',
  defaults: hangOptionsSchema.parse({}),
  optionsSchema: hangOptionsSchema,
  signature: ['wind', 'sag'],
  progressParam: 'wind',
  duration: 4,
  loopMode: 'yoyo',
  stack(o) {
    return [
      { type: 'bend', options: { curvature: 0.15 + o.sag * 0.55, angle: 90 } },
      {
        type: 'wave',
        options: {
          amplitude: o.wind * 0.055,
          wavelength: 0.45,
          speed: 0.9 + o.wind * 0.8,
          angle: 75,
          pinnedEdge: 'top',
        },
      },
    ]
  },
}
