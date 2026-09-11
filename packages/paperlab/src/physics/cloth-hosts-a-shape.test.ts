import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ClothSim } from './cloth'
import { applyDeformerStack } from '../deformers/compose'
import { getBehavior } from '../behaviors/registry'
import { paperConfigSchema } from '../config/schema'
import type { DeformerContext } from '../deformers/types'

/**
 * Can you crush the paper you are already holding?
 *
 * This is the claim the `/hands` page's whole gesture vocabulary rests on and
 * it was the one thing nothing checked. The page's own header describes the
 * opposite — "the schema makes a simulation and a behavior EXCLUSIVE, so a
 * fist swaps cloth out for `crumple`, which throws away the drape the sim had
 * built" — and that stopped being true in the same commit the comment shipped
 * in. `PaperMesh` runs the deformer stack over `sim.positions`, and
 * `ClothSim.adopt` carries the particles across the mesh rebuild that a new
 * stack triggers. The behaviour is right; the documentation of it was wrong,
 * which is the failure a test fixes permanently and a comment does not.
 *
 * The browser harness cannot settle this. `pnpm test:hands` drives the real
 * page, and on an unchanged tree it reported three failures on one run and
 * none on the next — the drape numbers it prints for this very gesture moved
 * from `0.460 → 0.780` to `1.117 → 0.170` between runs. It measures a live
 * renderer on a wall clock, so it is the wrong instrument for a question with
 * an exact answer.
 *
 * The exact answer: a deformer is a pure map from a point to a point, so a
 * behavior running over a simulation is a pure function of the particles it
 * is handed. Crushing two DIFFERENT drapes must therefore give two different
 * results. If the sheet snapped flat first, both would land on the same shape
 * — the one a crumple makes out of a flat plane — and the distance between
 * them would be zero.
 */

const params = { stiffness: 0.8, gravity: 1, wind: 0, floor: -10 }
const SHEET = { width: 1, height: 1.4 }
const COLS = 12
const ROWS = 14

const ctx: DeformerContext = { t: 0, sheet: SHEET }

type Pins = 'none' | 'corner' | 'top-corners' | 'top-edge'

function sheetSim(pins: Pins, overrides: Partial<typeof params> = {}): ClothSim {
  return new ClothSim(COLS, ROWS, SHEET.width, SHEET.height, pins, { ...params, ...overrides })
}

function run(sim: ClothSim, seconds: number): ClothSim {
  const dt = 1 / 60
  for (let i = 0; i < Math.round(seconds / dt); i++) sim.step(dt)
  return sim
}

function settled(pins: Pins, seconds = 2, overrides: Partial<typeof params> = {}): ClothSim {
  return run(sheetSim(pins, overrides), seconds)
}

/**
 * A sheet actually being HELD: pinned at the top, taken hold of near the
 * bottom edge and pulled away from the plane.
 *
 * Worth spelling out why this rather than a plain drape. A sheet hanging in
 * still air is perfectly planar — gravity pulls along the sheet, the
 * constraints are laid out in it, and every particle's z stays exactly 0. At
 * this stiffness it barely moves at all: a top-corners sheet left to settle
 * for six seconds sits 0.0026 from where it started, so "did the drape
 * survive the crush" would be asking about two and a half thousandths of a
 * unit. A hand is what puts paper into the third dimension, and the gesture
 * under test is a crush of the sheet a hand is holding.
 */
function held(): ClothSim {
  const sim = run(sheetSim('top-corners'), 1)
  sim.grabNearest(0, -0.5, 0)
  sim.moveGrab(0.3, -0.2, 0.6)
  return run(sim, 1)
}

/**
 * Run the crumple behavior's own stack over a base, exactly as `PaperMesh`
 * does it: options through the schema first, then the registry's stack, then
 * the stack over whatever the simulation last solved rather than over the
 * flat rest pose.
 *
 * The schema parse is not ceremony. A behavior reads fields the caller never
 * names — `coarseness`, `ball`, `seed` — and handing it a bare
 * `{ type, progress }` produces a stack whose every vertex comes out NaN.
 * That is what `config.behavior` is for, and skipping it tests nothing.
 */
function crushed(base: Float32Array, progress: number): Float32Array {
  const behavior = getBehavior('crumple')
  const config = paperConfigSchema.parse({ sheet: SHEET, behavior: { type: 'crumple', progress } })
  const stack = behavior.stack({ ...config.behavior }, SHEET)
  const geometry = new THREE.PlaneGeometry(SHEET.width, SHEET.height, COLS - 1, ROWS - 1)
  applyDeformerStack(geometry, base, stack, ctx)
  const out = Float32Array.from(geometry.attributes.position!.array as Float32Array)
  geometry.dispose()
  return out
}

/** The largest distance any single vertex sits apart in two readings. */
function apart(a: Float32Array, b: Float32Array): number {
  let max = 0
  for (let i = 0; i < a.length && i < b.length; i++) max = Math.max(max, Math.abs(a[i]! - b[i]!))
  return max
}

/** How far out of its own plane a set of positions reaches. */
function relief(positions: Float32Array): number {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 2; i < positions.length; i += 3) {
    lo = Math.min(lo, positions[i]!)
    hi = Math.max(hi, positions[i]!)
  }
  return hi - lo
}

describe('a behavior running over the cloth sim', () => {
  it('crushes the drape it was handed, not a flat sheet', () => {
    // Two sheets shaped differently, which is all "the paper you are
    // holding" has to mean for this to be decidable.
    const inHand = held()
    const hanging = settled('corner', 4, { gravity: 3 })
    expect(apart(inHand.positions, hanging.positions)).toBeGreaterThan(0.05)

    const flat = sheetSim('none')
    const fromHand = crushed(inHand.positions, 0.6)
    const fromHanging = crushed(hanging.positions, 0.6)
    const fromFlat = crushed(flat.positions, 0.6)

    // The two crushes differ, so the crush read the sheet's own state.
    expect(apart(fromHand, fromHanging)).toBeGreaterThan(0.05)
    // And neither is the crush of a flat sheet, which is exactly what
    // snapping would have produced. This is the assertion the page's comment
    // denies.
    expect(apart(fromHand, fromFlat)).toBeGreaterThan(0.05)
    expect(apart(fromHanging, fromFlat)).toBeGreaterThan(0.05)
  })

  it('keeps the out-of-plane shape the sheet already had', () => {
    const inHand = held()
    const before = relief(inHand.positions)
    // The hand pulled it well clear of the plane, so there is real relief to
    // lose. A snap would take all of it.
    expect(before).toBeGreaterThan(0.5)

    const after = relief(crushed(inHand.positions, 0.8))
    expect(after).toBeGreaterThan(before)

    // Wind is the other way a sheet leaves its plane, and it has to survive
    // the same way — this is a property of composing over the sim, not
    // something true only of the particles a hand happens to be holding.
    const blown = settled('top-edge', 4, { wind: 2 })
    expect(relief(blown.positions)).toBeGreaterThan(0.1)
    expect(apart(crushed(blown.positions, 0.8), crushed(sheetSim('none').positions, 0.8))).toBeGreaterThan(
      0.05,
    )
  })

  it('carries the particles across the rebuild a new stack causes', () => {
    // A behavior arriving rebuilds the mesh, because the stack has its own
    // opinion about tessellation — and a new mesh means a new sim. What must
    // NOT happen is that new sim starting flat.
    const inHand = held()
    const rebuilt = sheetSim('top-corners')
    const fresh = Float32Array.from(rebuilt.positions)

    expect(rebuilt.adopt(inHand)).toBe(true)
    expect(apart(rebuilt.positions, inHand.positions)).toBeLessThan(1e-6)
    // It really was a different sheet before adopting, so the assertion above
    // is about carrying state rather than about two flat planes matching.
    expect(apart(fresh, inHand.positions)).toBeGreaterThan(0.05)
  })

  it('refuses to adopt across a different grid, and says so rather than guessing', () => {
    // The one case `adopt` declines, and the only route back to a sheet that
    // snaps flat. Worth pinning: if a future change makes the cloth grid
    // depend on the behavior stack, the drape starts disappearing again and
    // this is the test that explains why.
    const denser = new ClothSim(COLS + 4, ROWS, SHEET.width, SHEET.height, 'top-corners', { ...params })
    expect(denser.adopt(held())).toBe(false)
  })
})
