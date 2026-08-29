import { z } from 'zod'
import type { Behavior } from './types'

export const flipOptionsSchema = z.object({
  /** 0 = flat, 1 = page fully turned over the spine. */
  progress: z.number().min(0).max(1).default(0.3),
  /** Which edge is the spine. */
  spine: z.enum(['left', 'right']).default('left'),
  /** Softness of the turning curl. */
  radius: z.number().min(0.1).max(0.8).default(0.3),
})

export type FlipOptions = z.infer<typeof flipOptionsSchema>

/**
 * A page turn: the free edge curls up and rolls over toward the spine —
 * the roll deformer with its boundary swept across the page.
 */
export const flip: Behavior<FlipOptions> = {
  id: 'flip',
  label: 'Flip',
  defaults: flipOptionsSchema.parse({}),
  optionsSchema: flipOptionsSchema,
  signature: ['progress', 'spine'],
  progressParam: 'progress',
  duration: 1.8,
  loopMode: 'yoyo',
  stack(o, sheet) {
    // Rolling direction points at the free edge; the boundary starts past
    // the free edge (flat) and sweeps to the spine (fully turned).
    const angle = o.spine === 'left' ? 0 : 180
    const start = sheet.width / 2
    const end = -sheet.width / 2
    return [
      {
        type: 'roll',
        options: {
          angle,
          boundary: start + o.progress * (end - start),
          radius: o.radius,
          thickness: 0,
        },
      },
    ]
  },
  handles: [
    {
      id: 'free-edge',
      anchor: (o) => (o.spine === 'left' ? [0.98, 0.5] : [0.02, 0.5]),
      drag(local, o, sheet) {
        // Dragging the free edge toward the spine turns the page.
        const x = o.spine === 'left' ? local.x : -local.x
        return { progress: Math.min(1, Math.max(0, 0.5 - x / sheet.width)) }
      },
    },
  ],
}
