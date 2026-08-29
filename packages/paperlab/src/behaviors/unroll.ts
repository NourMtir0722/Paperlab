import { z } from 'zod'
import type { Behavior } from './types'
import type { SheetDims } from '../deformers/types'
import { rollRadius } from '../deformers/roll'

export const unrollOptionsSchema = z.object({
  /** 0 = fully rolled cylinder, 1 = flat sheet. */
  progress: z.number().min(0).max(1).default(0.5),
  /** How tightly the paper is wound — thin layers and many turns, or few and fat. */
  tightness: z.number().min(0).max(1).default(0.5),
  /** Idle rocking of the rolled end. */
  sway: z.number().min(0).max(1).default(0.25),
  /** Which end of the sheet holds the roll. `top` hangs the paper below it. */
  from: z.enum(['bottom', 'top']).default('bottom'),
  /** Radius of the tube the paper is wound onto — the roll never shrinks past it. */
  core: z.number().min(0.005).max(0.5).default(0.03),
  /**
   * Hold the roll still in space and let the paper hang off it, instead of
   * letting the roll ride along with the shrinking wound region.
   */
  fixed: z.boolean().default(false),
})

export type UnrollOptions = z.infer<typeof unrollOptionsSchema>

/** Layer gap at `tightness` 0 and 1. Visible thickness, not a real receipt's 60µm. */
const LOOSE = 0.1
const TIGHT = 0.02

function layerThickness(tightness: number): number {
  return LOOSE - tightness * (LOOSE - TIGHT)
}

/**
 * The span `progress` sweeps the roll boundary across: from the far edge
 * (everything wound) past the near edge (flat, plus slack so the last of the
 * paper fully relaxes).
 */
function sweep(o: UnrollOptions, sheet: SheetDims): { start: number; end: number } {
  const maxRadius = rollRadius(sheet.height, o.core, layerThickness(o.tightness))
  return { start: -sheet.height / 2, end: sheet.height / 2 + maxRadius * 2 }
}

/** Where the wound region begins, as a signed distance along the roll direction. */
function rollBoundary(o: UnrollOptions, sheet: SheetDims): number {
  const { start, end } = sweep(o, sheet)
  return start + o.progress * (end - start)
}

/**
 * Paper coming off a roll: the sheet hangs flat and whatever is left is wound
 * at one end. Content bends true around the roll.
 *
 * The roll SHRINKS as the paper comes off it, because its radius is derived
 * from how much paper is still wound rather than being a constant. That is
 * both the honest physics and the whole appeal of a long sheet: scroll it out
 * and the roll visibly runs down to its tube.
 */
export const unroll: Behavior<UnrollOptions> = {
  id: 'unroll',
  label: 'Unroll',
  defaults: unrollOptionsSchema.parse({}),
  optionsSchema: unrollOptionsSchema,
  signature: ['progress', 'tightness'],
  progressParam: 'progress',
  duration: 3,
  loopMode: 'yoyo',
  stack(o, sheet) {
    const thickness = layerThickness(o.tightness)
    const boundary = rollBoundary(o, sheet)
    // Paper still on the roll: the span from the boundary to the far edge.
    const wound = Math.max(0, sheet.height / 2 - boundary)
    return [
      {
        type: 'roll',
        options: {
          // Both directions sweep the same boundary; only which half of the
          // sheet counts as "past" it changes. 270 winds the bottom (a
          // receipt feeding downward), 90 winds the top (paper hanging below).
          angle: o.from === 'top' ? 90 : 270,
          boundary,
          radius: rollRadius(wound, o.core, thickness),
          thickness,
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
  transform(o, _t, pose, sheet) {
    if (!o.fixed) return
    // The wound region shrinks toward the far edge, carrying the roll with
    // it. A roll on a holder does not move — the paper does — so cancel that
    // travel and let the flat tail grow away instead, which is the thing you
    // actually watch.
    //
    // Anchored on the UNROLLED end, so a fully paid-out sheet sits exactly
    // where an undeformed one would and the roll hangs off the edge of that
    // box. Anchoring on the rolled end instead is the same motion, but it
    // parks the whole composition a sheet-length away from the origin, which
    // makes every preset using it need a bespoke camera.
    const travel = sweep(o, sheet).end - rollBoundary(o, sheet)
    pose.position[1] += o.from === 'top' ? travel : -travel
  },
  handles: [
    {
      id: 'roll-edge',
      // The grab point is the edge the paper leaves the roll on, so it tracks
      // the boundary — which runs top-to-bottom for a roll at the bottom and
      // bottom-to-top for one at the top.
      anchor: (o) => {
        const v = o.from === 'top' ? o.progress : 1 - o.progress
        return [0.5, Math.max(0.02, Math.min(0.98, v))]
      },
      drag(local, o, sheet) {
        // Dragging away from the roll unrolls the paper, whichever end it is on.
        const along = local.y / sheet.height
        const p = o.from === 'top' ? 0.5 + along : 0.5 - along
        return { progress: Math.min(1, Math.max(0, p)) }
      },
    },
  ],
}
