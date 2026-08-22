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
    // The bottom flap leads, the top flap follows slightly behind so the
    // motion reads as two deliberate folds, not one collapse.
    const bottom = Math.min(1, o.progress * 1.25)
    const top = Math.max(0, o.progress * 1.25 - 0.25)
    return [
      {
        // Bottom third folds up and over (fold travels downward from -h/6).
        type: 'fold',
        options: {
          angle: 270,
          offset: sheet.height / 6,
          foldAngle: bottom * 165,
          radius,
        },
      },
      {
        // Top third folds down across the (already folded) bottom flap.
        type: 'fold',
        options: {
          angle: 90,
          offset: sheet.height / 6,
          foldAngle: top * 150,
          radius: radius * 1.6,
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
