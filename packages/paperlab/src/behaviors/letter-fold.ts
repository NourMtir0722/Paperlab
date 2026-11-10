import { z } from 'zod'
import type { Behavior } from './types'

export const letterFoldOptionsSchema = z.object({
  /** 0 = flat letter, 1 = fully tri-folded. */
  progress: z.number().min(0).max(1).default(0.4),
  /** Softness of the two creases. */
  crease: z.number().min(0).max(1).default(0.3),
})

export type LetterFoldOptions = z.infer<typeof letterFoldOptionsSchema>

/**
 * The classic tri-fold: the bottom third folds up first, then the top third
 * folds down over it. Two fold deformers stacked — order is the physics.
 */
export const letterFold: Behavior<LetterFoldOptions> = {
  id: 'letter-fold',
  label: 'Letter fold',
  defaults: letterFoldOptionsSchema.parse({}),
  optionsSchema: letterFoldOptionsSchema,
  signature: ['progress', 'crease'],
  progressParam: 'progress',
  duration: 2.6,
  loopMode: 'yoyo',
  stack(o, sheet) {
    const radius = 0.02 + o.crease * 0.06
    // The bottom flap folds flat first; the top flap only swings once the
    // bottom is down, and hinges on a wider crease so it lies on top of it.
    // Overlapping the two (the old 1.25 / -0.25 split) put the bottom flap's
    // tip above the top flap's hinge: the top flap passed through it.
    const bottom = Math.min(1, o.progress / 0.54)
    const top = Math.min(1, Math.max(0, (o.progress - 0.46) / 0.54))
    return [
      {
        // Bottom third folds up and over (fold travels downward from -h/6).
        type: 'fold',
        options: {
          angle: 270,
          offset: sheet.height / 6,
          foldAngle: bottom * 179,
          radius,
        },
      },
      {
        // Top third folds down across the (already folded) bottom flap.
        type: 'fold',
        options: {
          angle: 90,
          offset: sheet.height / 6,
          foldAngle: top * 177,
          radius: radius * 2.2,
        },
      },
    ]
  },
  handles: [
    {
      id: 'top-flap',
      anchor: () => [0.5, 1],
      drag(local, _o, sheet) {
        // Pulling the top edge down folds the letter.
        return { progress: Math.min(1, Math.max(0, (sheet.height / 2 - local.y) / sheet.height)) }
      },
    },
  ],
}
