import { describe, expect, it, vi } from 'vitest'
import { ClothSim } from './cloth'

/**
 * What the effects layer will reach for: per-particle mass and per-constraint
 * rest length, stiffness and breakage.
 *
 * Nothing writes these yet — that is fire's coupling, in P1. What this pins is
 * that each of them DOES something when written, because a lever that moves
 * nothing is the most expensive kind of knob to discover late: it gets tuned,
 * argued about and shipped before anyone notices it was never connected.
 *
 * And that, left alone, they change nothing. The typed arrays replaced one
 * object per constraint; at their defaults the solve is bit-identical to the
 * version it replaced — checked float for float against the old file across
 * all four pin modes, wind, a moving grab and uneven frame times before the
 * old file was deleted.
 */

vi.setConfig({ testTimeout: 30_000 })

const still = { stiffness: 0.8, gravity: 1, wind: 0, floor: -10 }

function run(sim: ClothSim, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 60); i++) sim.step(1 / 60)
  return sim
}

/** The constraints that cross between row `r` and anything below it. */
function crossing(sim: ClothSim, r: number): number[] {
  const out: number[] = []
  for (let k = 0; k < sim.constraintCount; k++) {
    const ra = Math.floor(sim.constraintA[k]! / sim.cols)
    const rb = Math.floor(sim.constraintB[k]! / sim.cols)
    if (Math.min(ra, rb) <= r && Math.max(ra, rb) > r) out.push(k)
  }
  return out
}

/** Lowest point of a row. */
function rowY(sim: ClothSim, r: number): number {
  let y = Infinity
  for (let c = 0; c < sim.cols; c++) y = Math.min(y, sim.positions[(r * sim.cols + c) * 3 + 1]!)
  return y
}

describe('cloth coupling levers', () => {
  it('starts with every lever at rest', () => {
    const sim = new ClothSim(8, 10, 1, 1.4, 'top-edge', { ...still })
    expect(Array.from(sim.invMass).every((m) => m === 1)).toBe(true)
    expect(Array.from(sim.constraintStiffness).every((s) => s === 1)).toBe(true)
    expect(Array.from(sim.broken).every((b) => b === 0)).toBe(true)
    expect(Array.from(sim.restLength)).toEqual(Array.from(sim.naturalLength))
  })

  it('lets a sheet come apart where its constraints are broken', () => {
    // Burnt-through paper must stop holding up what hangs below it, or half a
    // sheet that burnt away keeps pulling on the rest — invisible, still
    // hanging, which is exactly the decal the four-layer rule exists to stop.
    const whole = new ClothSim(8, 10, 1, 1.4, 'top-edge', { ...still })
    const torn = new ClothSim(8, 10, 1, 1.4, 'top-edge', { ...still })
    for (const k of crossing(torn, 4)) torn.broken[k] = 1
    run(whole, 2)
    run(torn, 2)
    // The rows below the break have fallen away from the rows above it.
    const gapWhole = rowY(whole, 4) - rowY(whole, 5)
    const gapTorn = rowY(torn, 4) - rowY(torn, 5)
    expect(gapTorn).toBeGreaterThan(gapWhole * 5)
  })

  it('draws paper in where its rest length is shortened', () => {
    // Char shrinks paper, and shrinkage is what curls it toward a flame — not
    // softening, which would only make it droop.
    const sim = new ClothSim(10, 10, 1, 1, 'none', { ...still, gravity: 0 })
    const control = new ClothSim(10, 10, 1, 1, 'none', { ...still, gravity: 0 })
    for (let k = 0; k < sim.constraintCount; k++) sim.restLength[k] = sim.naturalLength[k]! * 0.8
    run(sim, 1)
    run(control, 1)
    const width = (s: ClothSim) => s.positions[(s.cols - 1) * 3]! - s.positions[0]!
    expect(width(sim)).toBeLessThan(width(control) * 0.9)
  })

  it('pushes a heavy particle through the air less than a light one', () => {
    // Gravity is an acceleration and ignores mass; the air is a force and
    // does not. So "wet paper is heavier" can only show up here and in the
    // solve — anywhere else it would be a lever connected to nothing.
    const light = new ClothSim(6, 6, 1, 1, 'none', { ...still, gravity: 0, wind: 1 })
    const heavy = new ClothSim(6, 6, 1, 1, 'none', { ...still, gravity: 0, wind: 1 })
    heavy.invMass.fill(0.25)
    run(light, 0.5)
    run(heavy, 0.5)
    const meanZ = (s: ClothSim) => {
      let z = 0
      for (let i = 0; i < s.count; i++) z += s.positions[i * 3 + 2]!
      return z / s.count
    }
    expect(Math.abs(meanZ(heavy))).toBeLessThan(Math.abs(meanZ(light)) * 0.6)
  })

  it('does not move a particle of infinite mass, whatever pulls on it', () => {
    // Gravity ON, which the first version of this test left off — and so
    // missed that an infinitely heavy particle still fell and kept its
    // velocity. Inverse mass zero is static, full stop.
    const sim = new ClothSim(6, 6, 1, 1, 'none', { ...still })
    const i = 0
    sim.invMass[i] = 0
    const before = [sim.positions[0]!, sim.positions[1]!, sim.positions[2]!]
    sim.grabNearest(0.5, -0.5, 0)
    for (let f = 0; f < 60; f++) {
      sim.moveGrab(0.5 + f * 0.01, -0.5, f * 0.01)
      sim.step(1 / 60)
    }
    expect([sim.positions[0], sim.positions[1], sim.positions[2]]).toEqual(before)
  })

  it('makes a softened region give more than the paper around it', () => {
    // The wet corner is floppier than the dry sheet above it.
    const dry = new ClothSim(8, 10, 1, 1.4, 'top-edge', { ...still, stiffness: 1 })
    const wet = new ClothSim(8, 10, 1, 1.4, 'top-edge', { ...still, stiffness: 1 })
    for (let k = 0; k < wet.constraintCount; k++) {
      if (wet.constraintKind[k] === 2) wet.constraintStiffness[k] = 0.05
    }
    const push = (s: ClothSim) => {
      s.grabNearest(0, -0.7, 0)
      for (let f = 0; f < 40; f++) {
        s.moveGrab(0, -0.7, f * 0.01)
        s.step(1 / 60)
      }
      s.release()
      run(s, 0.5)
      // How far out of plane the sheet still curves after the push.
      let lo = Infinity
      let hi = -Infinity
      for (let k = 2; k < s.positions.length; k += 3) {
        lo = Math.min(lo, s.positions[k]!)
        hi = Math.max(hi, s.positions[k]!)
      }
      return hi - lo
    }
    expect(push(wet)).not.toBeCloseTo(push(dry), 3)
  })
})
