import { describe, expect, it } from 'vitest'
import { StripSim, stripNodeCount, layerThickness } from './strip'
import { paperConfigSchema } from '../config/schema'
import { getPreset } from '../config/presets'
import { rollRadius } from '../deformers/roll'

const LENGTH = 14
const WIDTH = 1

const base = {
  scroll: 0,
  tightness: 0.6,
  core: 0.09,
  tail: 1.1,
  perforation: 1,
  crease: 0.7,
  stiffness: 0.55,
  drag: 0.55,
  gravity: 1,
  floor: 1.2,
  inertia: 0.45,
}

function makeSim(overrides: Partial<typeof base> = {}) {
  return new StripSim(LENGTH, WIDTH, { ...base, ...overrides })
}

/** Advance `seconds`, holding the scroll where it is unless `scroll` moves it. */
function run(sim: StripSim, seconds: number, scroll?: (t: number) => number) {
  const dt = 1 / 60
  const steps = Math.round(seconds / dt)
  for (let i = 0; i < steps; i++) {
    if (scroll) sim.setParams({ scroll: scroll((i + 1) * dt) })
    sim.step(dt)
  }
}

/** Node centreline as [y, z] pairs, read back out of the vertex buffer. */
function nodes(sim: StripSim): [number, number][] {
  const buf = new Float32Array(sim.count * 6)
  sim.writeInto(buf)
  return Array.from({ length: sim.count }, (_, i) => [buf[i * 6 + 1]!, buf[i * 6 + 2]!])
}

/** Do segments a→b and c→e properly cross, in the strip's own fold plane? */
function segmentsCross(a: number[], b: number[], c: number[], e: number[]): boolean {
  const side = (p: number[], q: number[], r: number[]) =>
    Math.sign((q[0]! - p[0]!) * (r[1]! - p[1]!) - (q[1]! - p[1]!) * (r[0]! - p[0]!))
  return side(a, b, c) !== side(a, b, e) && side(c, e, a) !== side(c, e, b)
}

/** Closest approach between two 2D segments — the distance collision owes. */
function segmentDistance(a: number[], b: number[], c: number[], e: number[]): number {
  const uy = b[0]! - a[0]!
  const uz = b[1]! - a[1]!
  const vy = e[0]! - c[0]!
  const vz = e[1]! - c[1]!
  const wy = a[0]! - c[0]!
  const wz = a[1]! - c[1]!
  const uu = uy * uy + uz * uz
  const vv = vy * vy + vz * vz
  if (uu < 1e-12 || vv < 1e-12) return Infinity
  const uv = uy * vy + uz * vz
  const uw = uy * wy + uz * wz
  const vw = vy * wy + vz * wz
  const den = uu * vv - uv * uv
  const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
  let s = den > 1e-12 ? clamp01((uv * vw - vv * uw) / den) : 0
  let t = (uv * s + vw) / vv
  if (t < 0) {
    t = 0
    s = clamp01(-uw / uu)
  } else if (t > 1) {
    t = 1
    s = clamp01((uv - uw) / uu)
  }
  return Math.hypot(c[0]! + vy * t - (a[0]! + uy * s), c[1]! + vz * t - (a[1]! + uz * s))
}

const PRESET = getPreset('toilet-roll')
const PRESET_STRIP = PRESET.physics as Extract<typeof PRESET.physics, { type: 'strip' }>

function getPresetSim() {
  return new StripSim(PRESET.sheet.height, PRESET.sheet.width, { ...PRESET_STRIP })
}

/**
 * The wound part of the chain, measured about the roll's centre.
 *
 * Both numbers are derived rather than read off the sim, so they check the
 * geometry that actually reaches the vertex buffer. The centre sits one full
 * radius behind the tangent plane, lifted by the same centring offset every
 * node gets — `floorY + floor` recovers that offset from the public surface.
 */
function woundNodes(sim: StripSim) {
  const o = PRESET_STRIP
  const outer = rollRadius(PRESET.sheet.height, o.core, layerThickness(o.tightness))
  // The buffer is written centred on BOTH axes — lifted in y, and shifted in
  // z by half the travel of the drop line (see `StripSim.centreShift`). This
  // mirrors that transform to recover the spiral's centre; miss the z half
  // and every radius below is measured from the wrong point.
  const lift = sim.floorY + o.floor
  const shift = (outer - o.core) / 2
  const cy = lift
  const cz = -outer + shift
  const wound: { r: number; a: number }[] = []
  for (const [y, z] of nodes(sim)) {
    const r = Math.hypot(y - cy, z - cz)
    if (r <= sim.radius * 1.02) wound.push({ r, a: Math.atan2(y - cy, z - cz) })
  }
  // The silhouette is drawn by the OUTERMOST wrap, and that is the only one
  // angular coarseness shows on: the inner turns are hidden inside the roll,
  // and they are inevitably coarser because the same arc-length step spans a
  // bigger angle the tighter the radius.
  const outerWraps = wound.filter((w) => w.r > sim.radius * 0.85)
  let maxStep = 0
  for (let i = 1; i < outerWraps.length; i++) {
    let d = Math.abs(outerWraps[i]!.a - outerWraps[i - 1]!.a)
    if (d > Math.PI) d = Math.PI * 2 - d
    maxStep = Math.max(maxStep, d)
  }
  return {
    count: wound.length,
    minRadius: wound.length ? Math.min(...wound.map((w) => w.r)) : Infinity,
    maxStepDeg: (maxStep * 180) / Math.PI,
  }
}

describe('stripNodeCount', () => {
  it('gives the mesh and the chain the same row count', () => {
    // The geometry is built before the sim exists, so both have to derive the
    // row count from this one function or the buffer write goes out of bounds.
    for (const perf of [0.25, 0.5, 1, 2.5]) {
      const sim = new StripSim(LENGTH, WIDTH, { ...base, perforation: perf })
      expect(sim.count).toBe(stripNodeCount(LENGTH, perf))
    }
  })

  it('caps a very long strip rather than growing without bound', () => {
    expect(stripNodeCount(400, 0.05)).toBeLessThanOrEqual(440)
  })

  it('keeps enough nodes between perforations for a panel to bow', () => {
    // Below about four nodes per panel a panel is a straight line and the
    // pile cannot buckle at all — the effect this whole sim exists for.
    const perf = 1
    const sim = new StripSim(LENGTH, WIDTH, { ...base, perforation: perf })
    expect(perf / sim.segment).toBeGreaterThanOrEqual(4)
  })
})

describe('the roll', () => {
  it('pays paper out when the page scrolls down', () => {
    const sim = makeSim()
    const before = sim.remaining
    run(sim, 2, (t) => t * 2)
    expect(sim.remaining).toBeLessThan(before)
  })

  it('winds paper back when the page scrolls up', () => {
    const sim = makeSim()
    run(sim, 2, (t) => t * 2)
    const paidOut = sim.remaining
    run(sim, 2, (t) => 4 - t * 2)
    expect(sim.remaining).toBeGreaterThan(paidOut)
  })

  it('shrinks as it empties, and stops at the tube with the last wrap glued on', () => {
    const sim = makeSim({ core: 0.09 })
    const full = sim.radius
    run(sim, 8, (t) => t * 30)
    expect(sim.radius).toBeLessThan(full)
    expect(sim.remaining).toBeCloseTo(0, 3)
    // Not a bare core: a roll's inner end is glued down, so what is left is
    // the tube with a wrap still on it — which is also the only way this
    // library can draw a cardboard tube out of the one sheet it has.
    expect(sim.radius).toBeGreaterThan(0.09)
    expect(sim.radius).toBeLessThan(0.09 + layerThickness(0.6))
  })

  it('never drops off its holder, however much is pulled off it', () => {
    // The failure this guards was plainly visible: paying out the last of the
    // paper freed every node the roll was made of, so the roll itself fell and
    // landed flat on top of its own pile.
    const sim = makeSim({ floor: 2 })
    run(sim, 10, (t) => t * 32)
    expect(sim.remaining).toBeCloseTo(0, 3)
    const ys = nodes(sim).map(([y]) => y)
    // There is still paper up at the roll, a clear distance above the pile.
    expect(Math.max(...ys)).toBeGreaterThan(sim.floorY + 1)
    const aloft = ys.filter((y) => y > sim.floorY + 1).length
    expect(aloft).toBeGreaterThan(8)
  })

  it('never pays out more paper than it holds', () => {
    const sim = makeSim()
    run(sim, 8, (t) => t * 100)
    expect(sim.remaining).toBeGreaterThanOrEqual(0)
  })

  it('keeps spinning after a flick, for as long as its inertia says', () => {
    const coast = (inertia: number) => {
      const sim = makeSim({ inertia })
      run(sim, 0.25, (t) => t * 12)
      const atRelease = sim.remaining
      run(sim, 0.75) // the scroll is held still; only the flywheel is left
      return atRelease - sim.remaining
    }
    // A free-spinning roll keeps feeding well after the input stops. A stiff
    // one only spends the last frame's impulse, which has to go somewhere —
    // "no inertia" is a short coast, not a hard stop mid-impulse.
    expect(coast(0.9)).toBeGreaterThan(coast(0) * 4)
  })

  it('pays out the same paper however long it coasts', () => {
    // `inertia` buys the coast and nothing else. If it also changed how much
    // paper a scroll yields it would be unusable as a knob.
    const paidBy = (inertia: number) => {
      const sim = makeSim({ inertia })
      run(sim, 4, (t) => Math.min(t, 2) * 2)
      return 1 - sim.remaining
    }
    const slow = paidBy(0.9)
    const quick = paidBy(0.1)
    // Not identical, and should not be: a long coast spends its radians while
    // the roll is still shrinking, and `ΔL = R·Δθ` reads the radius as it is.
    // A few percent is that second-order effect; anything more would mean
    // `inertia` had become a second feed-rate control.
    expect(Math.abs(slow - quick) / quick).toBeLessThan(0.06)
  })

  it('does not fire the roll off on the first frame from a large scroll origin', () => {
    // A host binding window.scrollY hands the sim a big absolute number on
    // frame one. That is an origin, not a delta.
    const sim = new StripSim(LENGTH, WIDTH, { ...base, scroll: 900 })
    const before = sim.remaining
    run(sim, 0.5)
    expect(sim.remaining).toBeCloseTo(before, 3)
  })

  it('a tighter wind makes a smaller roll for the same paper', () => {
    expect(makeSim({ tightness: 1 }).radius).toBeLessThan(makeSim({ tightness: 0 }).radius)
  })
})

describe('the strip', () => {
  it('does not stretch', () => {
    const sim = makeSim()
    run(sim, 6, (t) => t * 3)
    const pts = nodes(sim)
    for (let i = 0; i < pts.length - 1; i++) {
      const d = Math.hypot(pts[i + 1]![0] - pts[i]![0], pts[i + 1]![1] - pts[i]![1])
      // Inextensible: paper is allowed to slack, never to lengthen.
      expect(d).toBeLessThan(sim.segment * 1.15)
    }
  })

  it('hangs below the roll rather than floating up', () => {
    const sim = makeSim()
    run(sim, 3, (t) => t * 2)
    const pts = nodes(sim)
    // The free tip is the last node and it is the lowest thing in the scene.
    const tipY = pts[pts.length - 1]![0]
    expect(tipY).toBeLessThan(0)
  })

  it('floats and sways down under drag instead of dropping like a rope', () => {
    // Measured with the floor out of reach, so this is about the air and
    // nothing else. A short tail cannot show it — a two-unit strip hangs taut
    // from the roll and is a pendulum, not a fall.
    const fall = (drag: number) => {
      const drop = 100
      const sim = new StripSim(LENGTH, WIDTH, { ...base, drag, floor: drop })
      run(sim, 3, (t) => t * 4)
      const pts = nodes(sim)
      const paid = (1 - sim.remaining) * LENGTH
      // The composition is centred on the origin, so the roll's own axis is
      // `floor` above the ground plane rather than at y = 0.
      const rollAxis = sim.floorY + drop
      return {
        // How much of the paid-out length turned into vertical drop. 1 is a
        // plumb line; less means the strip is bowing and taking its time.
        sag: (rollAxis - pts[sim.count - 1]![0]) / paid,
        sway: Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1])),
      }
    }
    const heavy = fall(1)
    const none = fall(0)
    // No drag is a rope: every unit paid out becomes a unit straight down.
    expect(none.sag).toBeGreaterThan(0.97)
    // Sway is the unambiguous signal, and the one that holds at any stiffness:
    // paper picks a side to fall toward, which a plumb line never does. The
    // RATIO is deliberately loose. Constraint solving is a relaxation, so
    // tension travels one node per iteration and a finer chain is a slightly
    // softer one at the same iteration count — the direction of this is a
    // property of the model, the exact multiple is a property of the
    // tessellation, and only the first is worth pinning.
    expect(heavy.sway).toBeGreaterThan(none.sway * 1.8)
    expect(heavy.sag).toBeLessThan(none.sag)
  })

  it('floats further the more perforations there are to bend at', () => {
    // Drag can only resist motion ACROSS the strip, so how much a falling
    // strip floats depends on how readily it bows — which is a function of
    // its hinges, not of the air alone. At the preset's own proportions the
    // drop is barely two thirds of the paper paid out to make it.
    const drop = (perforation: number) => {
      const sim = new StripSim(LENGTH, WIDTH, { ...base, perforation, drag: 1, floor: 100 })
      run(sim, 3, (t) => t * 4)
      const pts = nodes(sim)
      return (sim.floorY + 100 - pts[sim.count - 1]![0]) / ((1 - sim.remaining) * LENGTH)
    }
    expect(drop(0.6)).toBeLessThan(0.7)
    expect(drop(0.6)).toBeLessThan(drop(1))
  })
})

describe('the floor', () => {
  it('lands the paper and keeps it there — no bounce, no sinking through', () => {
    const sim = makeSim({ floor: 2 })
    run(sim, 8, (t) => t * 4)
    for (const [y] of nodes(sim)) expect(y).toBeGreaterThanOrEqual(sim.floorY - 1e-6)
  })

  it('piles instead of passing through: feeding more paper does not drive it deeper', () => {
    const sim = makeSim({ floor: 2 })
    run(sim, 6, (t) => t * 3)
    const lowAfterLanding = Math.min(...nodes(sim).map(([y]) => y))
    run(sim, 8, (t) => 18 + t * 3)
    expect(Math.min(...nodes(sim).map(([y]) => y))).toBeGreaterThanOrEqual(lowAfterLanding - 1e-6)
  })

  it('builds a pile with height to it, not a flat line on the ground', () => {
    const sim = makeSim({ floor: 2 })
    run(sim, 11, (t) => t * 5)
    const landed = nodes(sim).filter(([y]) => y < sim.floorY + 0.35)
    expect(landed.length).toBeGreaterThan(10)
    // Self-collision is what stops the folds stacking into nothing: the
    // landed paper occupies a band above the floor, not a single line.
    const heights = landed.map(([y]) => y - sim.floorY)
    expect(Math.max(...heights)).toBeGreaterThan(layerThickness(0.6))
  })

  it('folds back on itself instead of running off in one direction', () => {
    const sim = makeSim({ floor: 2 })
    run(sim, 11, (t) => t * 5)
    const landed = nodes(sim).filter(([y]) => y < sim.floorY + 0.35)
    // An accordion reverses direction along z; a strip that just slid away
    // would march monotonically. Count the turns.
    let reversals = 0
    for (let i = 1; i < landed.length - 1; i++) {
      const a = landed[i]![1] - landed[i - 1]![1]
      const b = landed[i + 1]![1] - landed[i]![1]
      if (a * b < 0 && Math.abs(a) > 1e-4 && Math.abs(b) > 1e-4) reversals++
    }
    expect(reversals).toBeGreaterThan(2)
  })

  it('never passes through itself', () => {
    // The claim a pile lives or dies on, and the one the earlier node-distance
    // check could not make: two chain SEGMENTS can cross with all four of
    // their endpoints comfortably apart. That is precisely how it failed —
    // paper is thinner than the chain is finely cut, so a collision sphere on
    // each node leaves gaps between the beads and another fold threads
    // straight through one.
    const sim = makeSim({ floor: 2 })
    // An irregular feed on purpose: a steady ramp is the easy case, and a
    // pile that only holds under one is not holding for the right reason.
    run(sim, 11, (t) => t * 5 + Math.sin(t * 2.3) * 0.7)
    const pts = nodes(sim)
    let crossings = 0
    for (let i = 0; i < pts.length - 1; i++) {
      for (let j = i + 2; j < pts.length - 1; j++) {
        if (segmentsCross(pts[i]!, pts[i + 1]!, pts[j]!, pts[j + 1]!)) crossings++
      }
    }
    expect(crossings).toBe(0)
  })

  it('never presses two folds closer than the paper is thick', () => {
    const sim = makeSim({ floor: 2 })
    run(sim, 11, (t) => t * 5 + Math.sin(t * 2.3) * 0.7)
    const pts = nodes(sim)
    const d = layerThickness(0.6)
    let closest = Infinity
    for (let i = 0; i < pts.length - 1; i++) {
      for (let j = i + 2; j < pts.length - 1; j++) {
        closest = Math.min(closest, segmentDistance(pts[i]!, pts[i + 1]!, pts[j]!, pts[j + 1]!))
      }
    }
    // A relaxation solver trades some overlap for stability; what matters is
    // that nothing is pressed to a fraction of a sheet's thickness, which is
    // what reads as one sheet buried inside another.
    expect(closest).toBeGreaterThan(d * 0.7)
  })

  it('keeps folds off each other', () => {
    const sim = makeSim({ floor: 2 })
    run(sim, 11, (t) => t * 5)
    const pts = nodes(sim)
    const d = layerThickness(0.6)
    let overlaps = 0
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 3; j < pts.length; j++) {
        if (Math.hypot(pts[j]![0] - pts[i]![0], pts[j]![1] - pts[i]![1]) < d * 0.55) overlaps++
      }
    }
    // A few residual overlaps are tolerable in a relaxation solver; a pile
    // that has collapsed through itself shows hundreds.
    expect(overlaps).toBeLessThan(pts.length)
  })
})

describe('the vertex buffer', () => {
  it('writes a 2×N quad strip at full sheet width', () => {
    const sim = makeSim()
    run(sim, 2, (t) => t * 2)
    const buf = new Float32Array(sim.count * 6)
    sim.writeInto(buf)
    for (let i = 0; i < sim.count; i++) {
      expect(buf[i * 6]).toBeCloseTo(-WIDTH / 2, 6)
      expect(buf[i * 6 + 3]).toBeCloseTo(WIDTH / 2, 6)
      // Both edges ride the same node — the strip carries no twist.
      expect(buf[i * 6 + 1]).toBeCloseTo(buf[i * 6 + 4]!, 6)
      expect(buf[i * 6 + 2]).toBeCloseTo(buf[i * 6 + 5]!, 6)
    }
  })

  it('produces no NaN, ever', () => {
    const sim = makeSim()
    run(sim, 10, (t) => Math.sin(t * 3) * 6 + t * 4)
    const buf = new Float32Array(sim.count * 6)
    sim.writeInto(buf)
    for (const v of buf) expect(Number.isFinite(v)).toBe(true)
  })

  it('survives a degenerate config without producing garbage', () => {
    const sim = new StripSim(1, 0.2, { ...base, perforation: 5, tail: 0, core: 0.5, tightness: 0 })
    run(sim, 3, (t) => t * 4)
    const buf = new Float32Array(sim.count * 6)
    sim.writeInto(buf)
    for (const v of buf) expect(Number.isFinite(v)).toBe(true)
  })
})

describe('sleep', () => {
  it('settles when nothing is happening, and wakes on a scroll', () => {
    const sim = makeSim({ floor: 2 })
    run(sim, 25)
    expect(sim.asleep).toBe(true)
    sim.setParams({ scroll: 3 })
    sim.step(1 / 60)
    expect(sim.asleep).toBe(false)
  })
})

describe('the schema', () => {
  it("'strip' shorthand expands to a full config", () => {
    const config = paperConfigSchema.parse({ physics: 'strip' })
    expect(config.physics).toMatchObject({ type: 'strip', perforation: 1 })
  })

  it('rejects a strip alongside a behavior — the sim owns the vertices', () => {
    expect(() => paperConfigSchema.parse({ physics: 'strip', behavior: { type: 'unroll' } })).toThrow(
      /exclusive/,
    )
  })

  it('round-trips through the preset format', () => {
    const config = paperConfigSchema.parse({ physics: { type: 'strip', tightness: 0.8, tail: 2 } })
    expect(paperConfigSchema.parse(JSON.parse(JSON.stringify(config)))).toEqual(config)
  })
})

describe('the toilet-roll preset', () => {
  const config = getPreset('toilet-roll')
  const strip = config.physics as Extract<typeof config.physics, { type: 'strip' }>

  function simFromPreset() {
    return new StripSim(config.sheet.height, config.sheet.width, { ...strip })
  }

  it('is a simulation, with no behavior to fight it for the vertices', () => {
    expect(strip.type).toBe('strip')
    expect(config.behavior).toBeUndefined()
    expect(config.deformers).toBeUndefined()
  })

  it('has a roll about a panel across, like the real object', () => {
    const sim = simFromPreset()
    expect(sim.radius / config.sheet.width).toBeGreaterThan(0.35)
    expect(sim.radius / config.sheet.width).toBeLessThan(0.65)
    // Square panels: a sheet of toilet paper is as wide as it is long.
    expect(strip.perforation).toBeCloseTo(config.sheet.width, 5)
  })

  /**
   * Nine runs, not one.
   *
   * A pile is chaotic — the same config fed a slightly different scroll ramp
   * lands 2.0 panel-widths wide or 4.2 — so a single trajectory is a sample
   * and cannot hold a claim about a preset. Three feed rates crossed with
   * three run lengths is enough to catch a set of numbers that only looks
   * right on the one run somebody happened to watch, which is exactly how the
   * shipped set got in.
   */
  const TRAJECTORIES: [number, number][] = []
  for (const rate of [1.6, 2.7, 4.2]) for (const seconds of [7, 11, 14]) TRAJECTORIES.push([rate, seconds])

  function everyTrajectory<T>(measure: (sim: StripSim) => T): T[] {
    return TRAJECTORIES.map(([rate, seconds]) => {
      const sim = simFromPreset()
      run(sim, seconds, (t) => t * rate)
      return measure(sim)
    })
  }

  /**
   * What `<Paper>`'s fixed camera can see, as a half-extent about the origin:
   * it sits at z=2.4 with a 40° vertical fov, so half-height is 2.4·tan20°.
   * Width follows the parent's aspect and a parent may be portrait, so the
   * budget for x is the square one too.
   */
  const HALF_VIEW = 2.4 * Math.tan((20 * Math.PI) / 180)

  it('stays inside the frame the library views through — in x as well as y', () => {
    // The y half of this passed all along while the pile walked out the SIDE
    // of the shot: the strip folds in z, `scene.turn` swings that depth into
    // x, and nothing was measuring x. Both axes, over every trajectory.
    const turn = (config.scene.turn * Math.PI) / 180
    const halfWidth = config.sheet.width / 2
    const worst = everyTrajectory((sim) => {
      let maxX = 0
      let maxY = 0
      for (const [y, z] of nodes(sim)) {
        maxY = Math.max(maxY, Math.abs(y))
        // The strip keeps its full width in x, then the whole group is turned.
        for (const x of [-halfWidth, halfWidth]) {
          maxX = Math.max(maxX, Math.abs(x * Math.cos(turn) + z * Math.sin(turn)))
        }
      }
      return { maxX, maxY }
    })
    expect(Math.max(...worst.map((w) => w.maxY))).toBeLessThan(HALF_VIEW)
    expect(Math.max(...worst.map((w) => w.maxX))).toBeLessThan(HALF_VIEW)
  })

  it('turns far enough to be read at all', () => {
    // The preset folds in DEPTH, and every camera in the library is head-on.
    // Without a turn the roll is end-on and the pile edge-on, and it renders
    // as a blank white column — so this is a correctness claim, not styling.
    expect(config.scene.turn).toBeGreaterThanOrEqual(20)
  })

  it('reaches the floor and piles there over a page of scrolling', () => {
    const layer = layerThickness(strip.tightness)
    for (const { landed, height } of everyTrajectory((sim) => {
      const down = nodes(sim).filter(([y]) => y < sim.floorY + 0.3)
      return { landed: down.length, height: Math.max(...down.map(([y]) => y - sim.floorY)) }
    })) {
      expect(landed).toBeGreaterThan(8)
      // A HEAP, not a runway. The old bound here was 0.02 against a layer gap
      // of 0.027 — one sheet lying flat cleared it, so paper that spread
      // across four panel-widths without ever folding passed. Several layers
      // deep is the thing self-collision exists to produce.
      expect(height).toBeGreaterThan(layer * 5)
    }
  })

  it('folds back on itself rather than running off across the floor', () => {
    // The failure this preset actually had: the pile paid out sideways like a
    // conveyor, three to four panel-widths of it, and left the shot.
    for (const spread of everyTrajectory((sim) => {
      const zs = nodes(sim)
        .filter(([y]) => y < sim.floorY + 0.3)
        .map(([, z]) => z)
      return (Math.max(...zs) - Math.min(...zs)) / strip.perforation
    })) {
      expect(spread).toBeLessThan(3.5)
    }
  })
})

describe('taking hold of the paper', () => {
  // Every pull is measured from the roll's own axis, not from the origin: the
  // composition is lifted so it straddles the origin, and how far that is
  // depends on the drop. `floorY + floor` recovers the axis.
  const DROP = 40
  const axisOf = (sim: StripSim) => sim.floorY + DROP
  const held = (o: Partial<typeof base> = {}) => makeSim({ floor: DROP, ...o })

  /** Grab the free tip and drag it to `below` the roll axis, a step at a time. */
  function pullTo(sim: StripSim, below: number, z: number, seconds = 1) {
    const target = axisOf(sim) - below
    const tip = nodes(sim)[sim.count - 1]!
    sim.grabNearest(tip[0], tip[1])
    const steps = Math.round(seconds * 60)
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      sim.moveGrab(tip[0] + (target - tip[0]) * t, tip[1] + (z - tip[1]) * t)
      sim.step(1 / 60)
    }
  }

  it('catches the paper, and only paper that has left the roll', () => {
    const sim = makeSim()
    const pts = nodes(sim)
    const caught = sim.grabNearest(pts[sim.count - 1]![0], pts[sim.count - 1]![1])
    expect(caught).toBe(sim.count - 1)
    expect(sim.held).toBe(true)
    // Nowhere near the free paper still catches the nearest free node rather
    // than a wound one — a wound node belongs to the spiral, not the hand.
    expect(sim.grabNearest(50, 50)).toBeGreaterThanOrEqual(0)
    sim.release()
    expect(sim.held).toBe(false)
  })

  it('pulling the paper down turns the roll', () => {
    const sim = held()
    const before = sim.remaining
    pullTo(sim, 6, 0)
    expect(sim.remaining).toBeLessThan(before - 0.15)
  })

  it('pulls out roughly the paper the hand asked for, and no more', () => {
    const sim = held()
    const paidBefore = (1 - sim.remaining) * LENGTH
    pullTo(sim, 4, 0)
    const paidAfter = (1 - sim.remaining) * LENGTH
    // The hand ended 4 below the roll, so about that much paper has to exist
    // between them — the constraint the pull is actually solving.
    expect(paidAfter).toBeGreaterThan(3.6)
    expect(paidAfter).toBeLessThan(5.5)
    expect(paidAfter).toBeGreaterThan(paidBefore)
  })

  it('does not rewind when the paper is pushed back toward the roll', () => {
    const sim = held()
    pullTo(sim, 5, 0)
    const paidOut = sim.remaining
    // Slack, not tension. A real roll does not wind itself back in.
    pullTo(sim, 1, 0)
    expect(sim.remaining).toBeLessThanOrEqual(paidOut + 1e-6)
  })

  it('keeps spinning after the hand lets go of a fast pull', () => {
    const sim = held({ inertia: 0.9 })
    pullTo(sim, 5, 0, 0.25) // a yank
    const atRelease = sim.remaining
    sim.release()
    run(sim, 0.6)
    expect(sim.remaining).toBeLessThan(atRelease)
  })

  it('holds the grabbed point exactly where the hand put it', () => {
    const sim = held()
    const pts = nodes(sim)
    const i = sim.grabNearest(pts[sim.count - 1]![0], pts[sim.count - 1]![1])
    const target = axisOf(sim) - 2.5
    sim.moveGrab(target, 0.4)
    for (let n = 0; n < 30; n++) sim.step(1 / 60)
    const at = nodes(sim)[i]!
    expect(at[0]).toBeCloseTo(target, 3)
    expect(at[1]).toBeCloseTo(0.4, 3)
  })

  it('the paper still does not stretch while it is being pulled', () => {
    const sim = held()
    pullTo(sim, 5, 1.5)
    const pts = nodes(sim)
    for (let i = 0; i < pts.length - 1; i++) {
      const d = Math.hypot(pts[i + 1]![0] - pts[i]![0], pts[i + 1]![1] - pts[i]![1])
      expect(d).toBeLessThan(sim.segment * 1.15)
    }
  })

  it('cannot pull more paper than the roll holds', () => {
    const sim = held()
    pullTo(sim, 30, 0, 3)
    expect(sim.remaining).toBeGreaterThanOrEqual(0)
    const buf = new Float32Array(sim.count * 6)
    sim.writeInto(buf)
    for (const v of buf) expect(Number.isFinite(v)).toBe(true)
  })

  it('never sleeps while the paper is held', () => {
    const sim = makeSim()
    run(sim, 25)
    expect(sim.asleep).toBe(true)
    const pts = nodes(sim)
    sim.grabNearest(pts[sim.count - 1]![0], pts[sim.count - 1]![1])
    expect(sim.asleep).toBe(false)
    run(sim, 25)
    expect(sim.asleep).toBe(false)
  })
})

describe('the wound roll', () => {
  it('draws a round roll, not a coarse polygon', () => {
    const sim = getPresetSim()
    const wound = woundNodes(sim)
    // Every step around the spiral turns by a small angle, so the silhouette
    // reads as a circle rather than as the sixteen-sided nut it was when the
    // chain was cut for the pile alone.
    expect(wound.maxStepDeg).toBeLessThan(14)
  })

  it('winds without the spiral cutting through itself', () => {
    // The failure this guards is specific and was visible: chords too long for
    // the radius they span dip inside the wrap beneath, and the roll comes
    // apart into a sawtooth. `segment²/4t` is the radius where that begins.
    const sim = getPresetSim()
    const thickness = layerThickness(0.45)
    expect(woundNodes(sim).minRadius).toBeGreaterThan((sim.segment * sim.segment) / (4 * thickness))
  })

  it('still holds when the roll is nearly used up', () => {
    const sim = getPresetSim()
    run(sim, 12, (t) => t * 5)
    expect(sim.remaining).toBeLessThan(0.2)
    const wound = woundNodes(sim)
    const thickness = layerThickness(0.45)
    expect(wound.minRadius).toBeGreaterThan((sim.segment * sim.segment) / (4 * thickness))
  })
})
