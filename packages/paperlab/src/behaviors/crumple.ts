import { z } from 'zod'
import type { Behavior } from './types'

export const crumpleBehaviorOptionsSchema = z.object({
  /** 0 = flat sheet, 1 = crushed. */
  progress: z.number().min(0).max(1).default(0.55),
  /** Few big facets at 0, many small ones at 1. */
  coarseness: z.number().min(0).max(1).default(0.35),
  /** How far the sheet curls in on itself as it crushes. */
  ball: z.number().min(0).max(1).default(0.5),
  /** A different crush of the same paper. */
  seed: z.number().int().min(0).max(7).default(0),
})

export type CrumpleBehaviorOptions = z.infer<typeof crumpleBehaviorOptionsSchema>

/**
 * A sheet being screwed up in a fist.
 *
 * Two deformers, in this order for a reason: `crumple` reads the flat sheet
 * position to place its creases, so it has to run before anything that moves
 * the sheet around. Crush the paper, then curl the crushed paper — the other
 * way round would crease a curved sheet as if it were still flat.
 */
export const crumpleBehavior: Behavior<CrumpleBehaviorOptions> = {
  id: 'crumple',
  label: 'Crumple',
  defaults: crumpleBehaviorOptionsSchema.parse({}),
  optionsSchema: crumpleBehaviorOptionsSchema,
  progressParam: 'progress',
  duration: 2.6,
  loopMode: 'yoyo',
  stack(o) {
    return [
      {
        type: 'crumple',
        options: {
          amount: o.progress,
          scale: 1.5 + o.coarseness * 4.5,
          pull: 0.5,
          seed: o.seed,
        },
      },
      // The sheet closing in on itself. Paper does not crush flat, and
      // without this the result reads as texture rather than as a ball.
      {
        type: 'bend',
        options: { curvature: o.progress * o.ball * 0.9, angle: 35 },
      },
    ]
  },
}
