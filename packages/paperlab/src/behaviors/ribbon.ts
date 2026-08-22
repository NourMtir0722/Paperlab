import { z } from 'zod'
import type { Behavior } from './types'

export const ribbonOptionsSchema = z.object({
  /**
   * How much of the drop is lying on the floor, as a fraction of the height.
   *
   * This is the whole image. A strip that stops dead at the ground reads as
   * a strip that was cut to fit; one that arrives with a length to spare and
   * turns over reads as paper meeting a floor, which is the thing the
   * reference installations are actually about.
   */
  pool: z.number().min(0).max(0.5).default(0.16),
  /** How tightly it turns where it lands. Low is a soft slump, high is a curl. */
  curl: z.number().min(0).max(1).default(0.45),
  /** Folds running down the length. A printed strip is never a flat plane. */
  drape: z.number().min(0).max(1).default(0.5),
})

export type RibbonOptions = z.infer<typeof ribbonOptionsSchema>

/**
 * A strip hung from the ceiling that reaches the floor and keeps going.
 *
 * The single most striking image in the reference set, and the reason it
 * took until now to build is that it needs three separate things that did
 * not exist a week ago: a room with a ceiling to hang from, hardware to hang
 * BY, and type that can be set down the length of a sheet without looking
 * like a caption. It is the payoff for all of them.
 *
 * The mathematics is not new, which is the point of the contribution ladder.
 * A ribbon is a `drape` down its length and a `roll` that begins near the
 * bottom edge instead of at the sheet's centre — `roll.boundary` has always
 * been able to say "start here", and nothing had ever asked it to.
 */
export const ribbon: Behavior<RibbonOptions> = {
  id: 'ribbon',
  label: 'Ribbon',
  defaults: ribbonOptionsSchema.parse({}),
  optionsSchema: ribbonOptionsSchema,
  /**
   * `curl`, not `pool` — and the reason is tessellation rather than taste.
   *
   * The grid is sized by sampling this parameter from 0 to 1, so it has to
   * BE a 0..1 parameter (a `pool` that stops at 0.5 would be sampled across
   * a range it rejects), and it should be the one that drives the geometry
   * hardest. `curl` sets the roll radius, sweeping it 0.5 -> 0.12, and the
   * tightest radius is exactly the case that demands the most segments.
   */
  signature: ['pool', 'curl', 'drape'],
  progressParam: 'curl',
  duration: 3,
  loopMode: 'yoyo',
  stack(o, sheet) {
    // Where the floor is, in the sheet's own coordinates — a `pool` fraction
    // above the bottom edge, so the length below that line is what turns
    // over. This is why the behavior needs the sheet at all, where most take
    // only their options.
    //
    // The hinge travels DOWNWARD (-90°), and that is not cosmetic: it is
    // what makes "past the crease" mean "below the floor line" rather than
    // "above it". Pointed the other way, the fold would have turned the
    // whole drop from the ceiling down.
    const floorLine = -sheet.height / 2 + sheet.height * o.pool

    return [
      {
        // `wave`, not `drape`, and that is a finding rather than a preference.
        //
        // `drape` is the obvious choice for folds down a hanging sheet, and
        // it does not work here: it renders an invisible sheet on the hero
        // (CPU) path at any grid, including an explicitly fixed one. It has
        // only ever been reached through the field/GPU path — the stage
        // banner is its single caller in the whole library — so nothing had
        // ever run it on this side. Written up in docs/roadmap.md.
        //
        // `wave` pinned at the top is the same picture by another road: the
        // fold amplitude grows away from the fixing, which is what a strip
        // hung from a clip does, and it is proven on both paths.
        type: 'wave',
        options: {
          amplitude: o.drape * 0.06,
          // Long and few. A printed strip carries two or three slow folds
          // down its drop; more than that is a curtain, not a ribbon.
          wavelength: 0.62,
          // Static — a hung strip is not a flag. `hang` is the behavior for
          // paper that moves.
          speed: 0,
          // Across the width, so the folds run down the length.
          angle: 8,
          // Flat where the clip holds it, deepening toward the floor.
          pinnedEdge: 'top',
        },
      },
      {
        // `fold`, not `roll` — and this is the second correction the render
        // forced. A roll wraps the pooled length around a cylinder, so it
        // curls up and over and ends in the air: a hook, not a pool. Paper
        // meeting a floor does not wrap, it CREASES and then lies down.
        //
        // A hinge at the floor line with a soft radius is exactly that: the
        // drop above stays vertical, and everything below turns through
        // roughly a right angle and runs out flat along the ground.
        type: 'fold',
        options: {
          // Travel measured down the drop, so the crease line sits across
          // the ribbon and the flap below it is what turns.
          angle: -90,
          offset: -floorLine,
          // A right angle lies the pool flat on the floor. Under that it is
          // still coming down; over it, the paper has folded back on itself,
          // which is what happens when more length arrives than there is
          // floor to take it.
          foldAngle: 62 + o.curl * 46,
          // The hinge is soft and scales with the sheet: paper never creases
          // to a mathematical edge, and a fixed radius that reads as a fold
          // on a short strip reads as a knife-edge on a long one.
          radius: Math.min(0.5, Math.max(0.02, sheet.height * 0.02)),
        },
      },
    ]
  },
}
