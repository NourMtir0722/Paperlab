import { z } from 'zod'
import type { Behavior } from './types'

export const settleOptionsSchema = z.object({
  /**
   * How long ago it landed, 0..1.
   *
   * 0 is the instant of arrival — still carrying the shape it fell in. 1 is
   * a sheet that has been lying there, where its own weight has flattened
   * out everything except what its stiffness refuses to give up.
   */
  relax: z.number().min(0).max(1).default(0.45),
  /**
   * How hard the paper resists lying flat, 0..1.
   *
   * This is the stock, not the pose: tissue surrenders completely, card
   * never does. It is the whole reason a settled sheet reads as PAPER and
   * not as a decal — at 0 the mesh is a rectangle painted on the floor.
   */
  lift: z.number().min(0).max(1).default(0.45),
  /** Which corner stayed up. */
  corner: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']).default('top-right'),
  /**
   * Slack across the middle — the low, long undulation of a sheet that is
   * touching a floor in two places and bridging between them.
   */
  slack: z.number().min(0).max(1).default(0.4),
})

export type SettleOptions = z.infer<typeof settleOptionsSchema>

/**
 * A sheet that has landed and relaxed.
 *
 * The library could drop paper (`fall`), fly it (`fly`, `flight`), heap it
 * (`pile`) and catch it mid-air (`spill`) — and had no way at all to show a
 * sheet that has ARRIVED. Every reference installation worth copying has
 * paper on the floor: sheets settled on concrete after the fall, ribbons
 * pooling where they meet the ground. It is the most beautiful detail in the
 * set and it appears in it twice.
 *
 * The distinction from `fall` is not the shape, it is the CLOCK. `fall`
 * flutters — its wave carries `speed: 1.3`, and it is a sheet still arguing
 * with the air. This one is over. Everything here is static, and that is the
 * point: a settled sheet that ripples is a settled sheet nobody believes.
 *
 * Which is also why it composes rather than deforming: a landed sheet is a
 * gentle curl the stiffness held on to, plus a long slack undulation where
 * it bridges the floor. Both already exist, and a deformer that can be
 * spelled out of the ones we have does not earn a GLSL twin and a parity
 * case.
 */
export const settle: Behavior<SettleOptions> = {
  id: 'settle',
  label: 'Settle',
  defaults: settleOptionsSchema.parse({}),
  optionsSchema: settleOptionsSchema,
  progressParam: 'relax',
  duration: 2.4,
  loopMode: 'yoyo',
  stack(o) {
    // Relaxing flattens the sheet, so `relax` SUBTRACTS. Stiffness is the
    // floor under it: however long it lies there, `lift` is what it will
    // never give back.
    const held = o.lift * (1 - o.relax * 0.55)
    return [
      {
        type: 'curl',
        options: {
          corner: o.corner,
          // A settled corner turns up gently and over a long distance. A
          // tight curl reads as a sheet being rolled, which is a hand doing
          // something to it rather than gravity having finished with it.
          // Calibrated against `fall`, which lifts a corner by `curl * 0.4`
          // — a settled sheet should keep MORE than a falling one, not less,
          // because the corner it is holding up is the one thing gravity
          // could not take from it. The first pass at 0.32 with a 0.5 radius
          // rendered a flat rectangle, which is the one outcome this
          // behavior exists to avoid.
          amount: held * 0.75,
          radius: 0.2 + (1 - held) * 0.14,
          // Off the diagonal, because a corner that lifts along its exact
          // diagonal reads as folded rather than as fallen.
          skew: 11,
        },
      },
      {
        type: 'wave',
        options: {
          amplitude: o.slack * (1 - o.relax * 0.4) * 0.085,
          // Long: one slow rise across the sheet, not a ripple. A settled
          // sheet touches the floor in a couple of places and bridges
          // between them, and that bridge is a single arc.
          wavelength: 1.6,
          // Static. This is the whole behavior.
          speed: 0,
          angle: 22,
          pinnedEdge: 'none',
        },
      },
    ]
  },
}
