import { z } from 'zod'
import type { Behavior } from './types'

export const flyOptionsSchema = z.object({
  /** Ripple energy. */
  flutter: z.number().min(0).max(1).default(0.5),
  /** Aerodynamic arc of the sheet. */
  curve: z.number().min(0).max(1).default(0.4),
})

export type FlyOptions = z.infer<typeof flyOptionsSchema>

/** A note carried on air — arched and fluttering. Pair with the `tumble` idle. */
export const fly: Behavior<FlyOptions> = {
  id: 'fly',
  label: 'Fly',
  defaults: flyOptionsSchema.parse({}),
  optionsSchema: flyOptionsSchema,
  progressParam: 'flutter',
  duration: 3.5,
  loopMode: 'yoyo',
  stack(o) {
    return [
      { type: 'bend', options: { curvature: 0.25 + o.curve, angle: 0 } },
      {
        type: 'wave',
        options: {
          amplitude: o.flutter * 0.07,
          wavelength: 0.7,
          speed: 1.6,
          angle: 30,
          pinnedEdge: 'none',
        },
      },
    ]
  },
}
