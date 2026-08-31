import { z } from 'zod'
import type { Behavior } from './types'
import type { DeformerInstance, SheetDims } from '../deformers/types'
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
   * Paper already hanging at `progress` 0, in world units.
   *
   * A roll on a holder is never a bare cylinder: there is always a leaf out,
   * because that is what you take hold of. Starting from nothing showing
   * reads as a fresh roll still in its wrapper.
   */
  tail: z.number().min(0).max(20).default(0),
  /**
   * How far below the roll the paper lands, in world units. Omit and it
   * hangs forever.
   *
   * Paper that reaches the ground does not stop and does not carry on
   * through it: it creases and runs out flat. Everything past this distance
   * turns a right angle and lies down.
   */
  floor: z.number().min(0.1).max(50).optional(),
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
  // `tail` starts the boundary short of the far edge, so that much paper is
  // already flat at progress 0. Capped so it cannot start past the end.
  const tail = Math.min(o.tail, sheet.height)
  return { start: -sheet.height / 2 + tail, end: sheet.height / 2 + maxRadius * 2 }
}

/** Where the wound region begins, as a signed distance along the roll direction. */
function rollBoundary(o: UnrollOptions, sheet: SheetDims): number {
  const { start, end } = sweep(o, sheet)
  return start + o.progress * (end - start)
}

/** Softness of the crease where the paper meets the ground, scaled to the sheet. */
const LANDING_RADIUS = 0.035

/**
 * The crease where the drop meets the ground: a right-angle hinge at the
 * floor line, so the paper above stays vertical and everything below turns
 * over and runs out flat.
 *
 * `fold`, not a second `roll`, and not a steeper angle — both were tried in
 * `ribbon`, which lands a strip the same way, and the notes there are worth
 * reading before touching this. A roll wraps the landed length up and over
 * and ends in the air (a hook, not a pool); anything but exactly 90° either
 * drives the paper on through the floor or floats it back up.
 */
function landing(
  o: UnrollOptions,
  sheet: SheetDims,
  boundary: number,
  rollRadiusNow: number,
): DeformerInstance {
  const radius = Math.min(0.5, Math.max(0.02, sheet.height * LANDING_RADIUS))
  // The hinge wraps a small cylinder rather than turning on the spot, so the
  // flap leaves it lower than the crease line by exactly that much. Raise the
  // crease by it so the LANDED length sits on the floor, not under it.
  const hingeDrop = radius / (Math.PI / 2)

  // The floor in the sheet's own coordinates. The roll is pinned in space and
  // the paper travels past it, so a fixed floor is a MOVING line down here —
  // it sits `floor` below wherever the roll boundary currently is.
  //
  // Clamped clear of the roll itself: a floor closer than the roll's own
  // radius would put the bottom of the roll below the crease line, and the
  // hinge would fold the roll over instead of the paper hanging off it.
  const below = Math.max(o.floor!, rollRadiusNow + radius)
  const floorLine = o.from === 'top' ? boundary - below : -boundary + below

  return {
    type: 'fold',
    // Travel points from the roll toward the floor, so "past the crease"
    // means "the length that has arrived", not the drop above it.
    options:
      o.from === 'top'
        ? { angle: -90, offset: -floorLine - hingeDrop, foldAngle: 90, radius }
        : { angle: 90, offset: floorLine - hingeDrop, foldAngle: 90, radius },
  }
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
    const radius = rollRadius(wound, o.core, thickness)
    const stack: DeformerInstance[] = [
      {
        type: 'roll',
        options: {
          // Both directions sweep the same boundary; only which half of the
          // sheet counts as "past" it changes. 270 winds the bottom (a
          // receipt feeding downward), 90 winds the top (paper hanging below).
          angle: o.from === 'top' ? 90 : 270,
          boundary,
          radius,
          thickness,
        },
      },
    ]
    if (o.floor !== undefined) stack.push(landing(o, sheet, boundary, radius))
    return stack
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
