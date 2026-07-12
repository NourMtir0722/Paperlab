import { z } from 'zod'
import type { Behavior } from './types'
import { flightPose } from '../physics/aero'

export const flightOptionsSchema = z.object({
  /** Directional wind vector — paper travels ACROSS the scene, not just down. */
  wind: z
    .tuple([z.number().min(-2).max(2), z.number().min(-2).max(2), z.number().min(-2).max(2)])
    .default([0.6, 0.08, 0]),
  gustiness: z.number().min(0).max(1).default(0.4),
  tumble: z.number().min(0).max(1).default(0.6),
  /** 'loop' is a seamless idle cycle; 'drift' travels along the wind. */
  path: z.enum(['drift', 'loop']).default('drift'),
  /** Drift only: exit the scene → re-enter the opposite side. */
  respawn: z.boolean().default(true),
  /** Half-extent of the travel before respawn wraps it. */
  range: z.number().min(0.5).max(12).default(3.5),
})

export type FlightOptions = z.infer<typeof flightOptionsSchema>

/**
 * Untethered paper carried across the scene on the wind (spec M6 §4.2) —
 * the falling-leaf tumble core + directional travel + lift. Transform +
 * deformer based, so it's instancing-safe: a `scatter` layout + `flight`
 * idle = papers blowing through a hero section.
 */
export const flight: Behavior<FlightOptions> = {
  id: 'flight',
  label: 'Flight',
  defaults: flightOptionsSchema.parse({}),
  optionsSchema: flightOptionsSchema,
  progressParam: 'tumble',
  duration: 6,
  loopMode: 'yoyo',
  stack(o) {
    // The sheet itself arcs and ripples; travel/tumble live in `transform`.
    return [
      { type: 'bend', options: { curvature: 0.35 + o.tumble * 0.4, angle: 20 } },
      {
        type: 'wave',
        options: {
          amplitude: 0.02 + o.gustiness * 0.03,
          wavelength: 0.8,
          speed: 1.1 + o.gustiness,
          angle: 35,
          pinnedEdge: 'none',
        },
      },
    ]
  },
  transform(o, t, pose) {
    flightPose(t, o, 0, pose)
  },
}
