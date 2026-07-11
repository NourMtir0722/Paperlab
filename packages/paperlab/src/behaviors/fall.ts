import { z } from 'zod'
import type { Behavior } from './types'

export const fallOptionsSchema = z.object({
  /** Air resistance ripple while falling. */
  flutter: z.number().min(0).max(1).default(0.6),
  /** A falling sheet always lifts a corner. */
  curl: z.number().min(0).max(1).default(0.3),
})

export type FallOptions = z.infer<typeof fallOptionsSchema>

/** A dropped sheet — corner lifted, rippling. Pair with the `tumble` idle for the descent. */
export const fall: Behavior<FallOptions> = {
  id: 'fall',
  label: 'Fall',
  defaults: fallOptionsSchema.parse({}),
  optionsSchema: fallOptionsSchema,
  progressParam: 'flutter',
  duration: 3,
  loopMode: 'yoyo',
  stack(o) {
    return [
      {
        type: 'curl',
        options: { corner: 'top-right', amount: o.curl * 0.4, radius: 0.3, skew: 0 },
      },
      {
        type: 'wave',
        options: {
          amplitude: o.flutter * 0.055,
          wavelength: 0.85,
          speed: 1.3,
          angle: 60,
          pinnedEdge: 'none',
        },
      },
    ]
  },
}
