import { z } from 'zod'
import type { Behavior } from './types'

export const unrollOptionsSchema = z.object({
  /** 0 = fully rolled cylinder, 1 = flat sheet. */
  progress: z.number().min(0).max(1).default(0.5),
  /** How tightly the paper is wound. */
  tightness: z.number().min(0).max(1).default(0.5),
  /** Idle rocking of the rolled end. */
  sway: z.number().min(0).max(1).default(0.25),
})

export type UnrollOptions = z.infer<typeof unrollOptionsSchema>

/**
 * A receipt unrolls from the bottom: the sheet hangs flat from its top edge
 * and the remaining paper is wound in a roll at the bottom. Content bends
 * true around the roll — the reference-image requirement.
 */
export const unroll: Behavior<UnrollOptions> = {
  id: 'unroll',
  label: 'Unroll',
  defaults: unrollOptionsSchema.parse({}),
  optionsSchema: unrollOptionsSchema,
  progressParam: 'progress',
  duration: 3,
  loopMode: 'yoyo',
  stack(o, sheet) {
    const radius = 0.28 - o.tightness * 0.22
    // Rolling direction points down (-y): the region below the boundary is
    // wound. progress sweeps the boundary from the top edge (fully rolled)
    // past the bottom edge (flat, plus slack so the last bit fully relaxes).
    const start = -sheet.height / 2
    const end = sheet.height / 2 + radius * 2
    return [
      {
        type: 'roll',
        options: {
          angle: 270,
          boundary: start + o.progress * (end - start),
          radius,
          spiral: 0.02,
        },
      },
    ]
  },
  loop(o, t) {
    if (o.sway === 0) return {}
    // The rolled tail rocks gently; transient — never persisted.
    const wobble = Math.sin(t * 1.5) * 0.01 * o.sway
    return { progress: Math.min(1, Math.max(0, o.progress + wobble)) }
  },
  handles: [
    {
      id: 'roll-edge',
      anchor: (o) => [0.5, Math.max(0.02, Math.min(0.98, 1 - o.progress))],
      drag(local, _o, sheet) {
        // Dragging the roll edge down unrolls the paper.
        return { progress: Math.min(1, Math.max(0, 0.5 - local.y / sheet.height)) }
      },
    },
  ],
}
