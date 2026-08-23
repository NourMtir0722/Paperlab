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
 * A ribbon is a `drape` down its length and a `fold` whose hinge sits at the
 * floor line rather than at the sheet's centre — `fold.offset` has always
 * been able to say "crease here", and nothing had ever asked it to.
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
   * hardest. `curl` opens the crease from a right angle to a fold back on
   * itself, and the sharpest turn is exactly the case that demands the most
   * segments across the hinge.
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

    // How soft the crease is. `curl` drives this rather than the fold angle
    // — see the fold below for why.
    const radius = Math.min(0.5, Math.max(0.02, sheet.height * (0.035 - o.curl * 0.027)))

    /**
     * The hinge does not turn on the spot: it wraps a cylinder of radius
     * `radius / φ`, and the flap leaves that cylinder lower than the crease
     * line by exactly that much.
     *
     * Which means placing the crease AT the floor buries the pool under it.
     * That is what was happening — the pooled length came out about 9cm
     * below the ground on the ribbon stage's own numbers, so the one thing
     * the stage exists to show was inside the floor. The crease goes up by
     * the hinge's own radius so that the POOL lands on the line, which is
     * the thing that has to be true; where the crease sits is arithmetic.
     */
    const hingeDrop = radius / (Math.PI / 2)

    return [
      {
        // `drape` — the deformer named after the thing this is.
        //
        // It briefly used `wave` instead, to work around a report that
        // `drape` rendered an invisible sheet on the hero path. That report
        // was wrong: it rested on counting the colours in a screenshot, and
        // a near-flat strip filling the frame has about as many colours as
        // an empty one. `deformers/draws.test.ts` now asserts on geometry
        // what the screenshot was being asked to guess at.
        //
        // `wave` was never the same picture. A wave is a sine of fixed
        // amplitude end to end, so its folds ran just as deep at the clip as
        // at the floor; a hung strip is FLAT where it is held and gathers as
        // it falls, which is exactly `falloff`, and it narrows as it gathers,
        // which is `gather`. Neither has an equivalent in `wave`.
        type: 'drape',
        options: {
          // Depth at the free end. Larger than the wave's amplitude was,
          // because this one starts at nothing under the clip rather than
          // running at full depth the whole way down.
          amplitude: o.drape * 0.1,
          // Few and long. A printed strip carries two or three slow folds
          // down its drop; more than that is a curtain, not a ribbon.
          folds: 2.5,
          // Holds the top flat and gathers the movement toward the floor,
          // which is what a strip hung from a single clip does.
          falloff: 1.5,
          // Off a pure sine, so the folds do not read as corrugation.
          irregular: 0.5,
          // Gentle. The pooled length has to lie FLAT on the floor, and a
          // hard pinch would narrow it as it went.
          gather: 0.22,
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
          offset: -floorLine - hingeDrop,
          // Exactly a right angle, at every setting, and this is the fix
          // for the thing the ribbon stage was actually failing at.
          //
          // A hinge is one angle: whatever it turns through, the pooled
          // length leaves the crease in a straight line and holds that
          // heading. Only 90° is the floor. It shipped as `62 + curl * 46`
          // (62°..108°), so below curl 0.61 the pool went on travelling
          // downward and vanished THROUGH the floor — which is why the one
          // stage built around this behavior rendered as flat strips
          // stopping at the ground — and above it the pool tilted back UP
          // and floated. Both halves of the range were wrong, in opposite
          // directions, and only the midpoint was ever right.
          //
          // Paper with more length than floor does not rise at a constant
          // angle; it buckles and lies in an S, which one hinge cannot
          // describe and should not pretend to.
          foldAngle: 90,
          // So `curl` drives the CREASE instead, which is what its own
          // description always claimed — "how tightly it turns where it
          // lands. Low is a soft slump, high is a curl." A soft radius is a
          // sheet slumping over the join; a tight one is a sheet that has
          // been creased. It scales with the sheet, because a radius that
          // reads as a fold on a short strip reads as a knife-edge on a long
          // one.
          radius,
        },
      },
    ]
  },
}
