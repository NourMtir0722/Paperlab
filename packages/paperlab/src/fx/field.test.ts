import { describe, expect, it, vi } from 'vitest'
import {
  CHAR,
  DamageField,
  FIELD_SIZE,
  FIXED_DT,
  HEAT,
  PRESENCE,
  SATURATION,
  diffusionTensor,
  stencil,
} from './field'

/**
 * The damage field is the one primitive the whole effects layer stands on, so
 * what it owes is not "fire looks good" but a handful of properties that have
 * to hold for every effect built on top of it — and that a shader demo can
 * fake while a simulation cannot.
 *
 * Three of these exist because the first version got them wrong and its tests
 * could not see it: the burn depended on the frame rate, a diagonal grain was
 * ignored, and an untouched sheet cost as much as a burning one. Each now has
 * a test that measures the thing directly — radius across frame rates, the
 * front's principal axis at 30° and 45°, cells visited — rather than one that
 * happens to pass at the two angles and one frame rate the bug cannot show at.
 */

/**
 * CI is roughly five times slower than the machine these were written on, and
 * vitest's default is five seconds a test. Generous rather than tight: the
 * point of the number is to catch a hang, not to police a simulation's speed
 * on hardware nobody has measured.
 */
vi.setConfig({ testTimeout: 30_000 })

/** Run `seconds` of simulated time at a given frame rate. */
const run = (field: DamageField, seconds: number, fps = 60) => {
  for (let i = 0; i < Math.round(seconds * fps); i++) field.step(1 / fps)
  return field.lastStats
}

/** Channel totals over the whole sheet. */
function total(field: DamageField, channel: number): number {
  let sum = 0
  for (let i = channel; i < field.data.length; i += 4) sum += field.data[i]!
  return sum
}

/** How far from a point the channel still reads above a threshold, in UV. */
function reach(field: DamageField, channel: number, u: number, v: number, min: number): number {
  let far = 0
  const n = field.size
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (field.data[(y * n + x) * 4 + channel]! < min) continue
      far = Math.max(far, Math.hypot(x / (n - 1) - u, y / (n - 1) - v))
    }
  }
  return far
}

/**
 * The orientation and elongation of a channel's mass — the angle of its
 * principal axis in degrees, and the ratio of its two spreads.
 *
 * Threshold-free on purpose: it is the shape of the distribution, which is
 * what anisotropy is a claim about, and it does not move when the rates or
 * the amounts are retuned.
 */
function shape(field: DamageField, channel: number): { angle: number; ratio: number } {
  const n = field.size
  let m = 0
  let mx = 0
  let my = 0
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const w = field.data[(y * n + x) * 4 + channel]!
      m += w
      mx += w * x
      my += w * y
    }
  }
  mx /= m
  my /= m
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const w = field.data[(y * n + x) * 4 + channel]!
      sxx += w * (x - mx) ** 2
      syy += w * (y - my) ** 2
      sxy += w * (x - mx) * (y - my)
    }
  }
  const angle = (0.5 * Math.atan2(2 * sxy, sxx - syy) * 180) / Math.PI
  const half = (sxx + syy) / 2
  const d = Math.sqrt(half * half - (sxx * syy - sxy * sxy))
  return { angle, ratio: Math.sqrt((half + d) / (half - d)) }
}

/** Smallest difference between two axis angles, which are equal modulo 180°. */
const axisError = (a: number, b: number) => {
  const d = Math.abs(((a - b) % 180) + 180) % 180
  return Math.min(d, 180 - d)
}

describe('the damage field', () => {
  it('starts as a whole sheet with nothing wrong with it', () => {
    const field = new DamageField()
    expect(field.lastStats.remaining).toBe(1)
    expect(total(field, CHAR)).toBe(0)
    expect(total(field, HEAT)).toBe(0)
    expect(total(field, PRESENCE)).toBe(field.size * field.size)
  })

  it('burns: heat becomes char, char eats presence, and the front travels', () => {
    const field = new DamageField({ seed: 3 })
    field.ignite(0.5, 0.5, 0.05, 1)

    const early = run(field, 0.5)
    expect(total(field, CHAR)).toBeGreaterThan(0)
    expect(early.front).toBeGreaterThan(0)

    const nearby = reach(field, CHAR, 0.5, 0.5, 0.5)
    run(field, 1.5)
    // The burn is a FRONT: it is further from where it started than it was.
    expect(reach(field, CHAR, 0.5, 0.5, 0.5)).toBeGreaterThan(nearby)
    // And the sheet is being consumed, not merely discoloured.
    expect(field.lastStats.remaining).toBeLessThan(1)
  })

  describe('the clock', () => {
    it('burns the same distance in the same simulated time at any frame rate', () => {
      // The first version ran a fixed number of substeps per FRAME and burned
      // 0.202, 0.290 and 0.439 UV at 30, 60 and 144 fps. A fire that slows
      // when the phone is busy is a different fire on every device.
      const radii = [30, 60, 144].map((fps) => {
        const field = new DamageField({ grain: 0, seed: 1 })
        field.ignite(0.5, 0.5, 0.05, 1)
        run(field, 1.5, fps)
        return reach(field, CHAR, 0.5, 0.5, 0.5)
      })
      const spread = Math.max(...radii) - Math.min(...radii)
      // One cell of slack: the accumulator can end a run one step either side.
      expect(spread).toBeLessThanOrEqual(1.5 / (FIELD_SIZE - 1))
    })

    it('never leans on the stability clamp at the default rates', () => {
      // The clamp is a safety net for extreme options. The first version
      // needed it on every tier at 60 fps, which is what made the fire's speed
      // a function of the frame rate in the first place.
      for (let degrees = 0; degrees < 180; degrees += 15) {
        const fibre = (degrees * Math.PI) / 180
        expect(stencil(0.0035, 3, fibre).clamped).toBe(false)
        expect(stencil(0.0045, 3, fibre).clamped).toBe(false)
      }
    })

    it('keeps every stencil weight non-negative, so nothing overshoots and is clipped', () => {
      // A negative weight is how the first version lost a wet patch in two
      // seconds: the update dipped below zero and the clamp ate the dip.
      for (const anisotropy of [1, 2, 3, 5, 12]) {
        for (let degrees = 0; degrees < 180; degrees += 5) {
          const s = stencil(0.004, anisotropy, (degrees * Math.PI) / 180)
          expect(s.ax).toBeGreaterThanOrEqual(0)
          expect(s.ay).toBeGreaterThanOrEqual(0)
          expect(s.ad).toBeGreaterThanOrEqual(0)
        }
      }
    })

    it('steps on its own fixed timestep', () => {
      expect(FIXED_DT).toBe(1 / 120)
    })
  })

  describe('the grain', () => {
    it('averages to the rate asked for, whichever way the fibre runs', () => {
      // Turning the grain changes which way things travel, never how fast.
      for (const fibre of [0, 0.5, 1, Math.PI / 4]) {
        const d = diffusionTensor(0.01, 4, fibre)
        expect((d.xx + d.yy) / 2).toBeCloseTo(0.01, 10)
      }
    })

    it.each([0, 30, 45, 60, 90, 135])('sends a wet front along a %i° fibre', (degrees) => {
      // The first version got 0° and 90° right and nothing else: a 30° grain
      // produced a 0° front at a third of the anisotropy, and a 45° grain a
      // circle. Those were the only two angles its tests used.
      const field = new DamageField({ fibre: (degrees * Math.PI) / 180, anisotropy: 4, grain: 0 })
      field.wet(0.5, 0.5, 0.03, 1)
      run(field, 2)
      const { angle, ratio } = shape(field, SATURATION)
      expect(axisError(angle, degrees)).toBeLessThan(5)
      // And it is actually elongated, not a circle whose axis is noise.
      expect(ratio).toBeGreaterThan(1.4)
    })

    it('burns along the grain further than across it', () => {
      const field = new DamageField({ fibre: Math.PI / 4, anisotropy: 4, grain: 0, seed: 5 })
      field.ignite(0.5, 0.5, 0.04, 1)
      run(field, 1.2)
      const { angle, ratio } = shape(field, CHAR)
      expect(axisError(angle, 45)).toBeLessThan(8)
      expect(ratio).toBeGreaterThan(1.15)
    })

    it('leaves a ragged edge, because paper is not uniform', () => {
      // With grain at zero the front is a circle, which is the most synthetic
      // thing this could do. The test is that the grain actually breaks it.
      const roughness = (grain: number) => {
        const field = new DamageField({ grain, anisotropy: 1, seed: 9 })
        field.ignite(0.5, 0.5, 0.05, 1)
        run(field, 1)
        const n = field.size
        const radii: number[] = []
        for (let a = 0; a < 32; a++) {
          const angle = (a / 32) * Math.PI * 2
          let r = 0
          for (let t = 0; t < n / 2; t++) {
            const x = Math.round((0.5 + (Math.cos(angle) * t) / (n - 1)) * (n - 1))
            const y = Math.round((0.5 + (Math.sin(angle) * t) / (n - 1)) * (n - 1))
            if (x < 0 || y < 0 || x >= n || y >= n) break
            if (field.data[(y * n + x) * 4 + CHAR]! > 0.3) r = t
          }
          radii.push(r)
        }
        const mean = radii.reduce((s, r) => s + r, 0) / radii.length
        return Math.sqrt(radii.reduce((s, r) => s + (r - mean) ** 2, 0) / radii.length)
      }
      expect(roughness(0.5)).toBeGreaterThan(roughness(0))
    })
  })

  describe('what costs nothing', () => {
    it('visits no cells at all on a sheet nothing has happened to', () => {
      // The first version cost 0.13–0.95 ms a frame on an untouched sheet —
      // exactly what a burning one cost — and every sheet on a stage paid it
      // again. Counted in cells, not milliseconds, so it means the same on
      // every machine.
      const field = new DamageField()
      for (let i = 0; i < 120; i++) field.step(1 / 60)
      expect(field.asleep).toBe(true)
      expect(field.cellsVisited).toBe(0)
    })

    it('visits only the neighbourhood of what is happening', () => {
      const field = new DamageField()
      field.ignite(0.1, 0.1, 0.03, 1)
      field.step(1 / 60)
      // Two fixed steps this frame, each over a small box in one corner.
      expect(field.cellsVisited).toBeGreaterThan(0)
      expect(field.cellsVisited).toBeLessThan(FIELD_SIZE * FIELD_SIZE * 0.2)
    })

    it('goes back to sleep once a fire has burnt itself out', () => {
      const field = new DamageField({ seed: 8 })
      field.ignite(0.5, 0.5, 0.06, 1)
      run(field, 20)
      expect(field.asleep).toBe(true)
      field.step(1 / 60)
      expect(field.cellsVisited).toBe(0)
    })

    it('uploads only when something changed', () => {
      const field = new DamageField()
      const before = field.version
      for (let i = 0; i < 30; i++) field.step(1 / 60)
      expect(field.version).toBe(before)

      field.punch(0.5, 0.5, 0.08)
      expect(field.version).toBeGreaterThan(before)
    })

    it('keeps the 8-bit upload in step with the simulation', () => {
      const field = new DamageField({ seed: 4 })
      field.punch(0.5, 0.5, 0.08)
      field.ignite(0.2, 0.2, 0.05, 1)
      run(field, 0.8)
      for (let k = 0; k < field.data.length; k++) {
        expect(Math.abs(field.pixels[k]! - field.data[k]! * 255)).toBeLessThanOrEqual(0.5)
      }
    })
  })

  describe('water', () => {
    it('will not light wet paper, and dunking a burning corner puts it out', () => {
      const dry = new DamageField({ seed: 4 })
      const wet = new DamageField({ seed: 4 })
      wet.wet(0.5, 0.5, 0.25, 1)
      for (const f of [dry, wet]) {
        f.ignite(0.5, 0.5, 0.05, 1)
        run(f, 1.2)
      }
      expect(total(dry, CHAR)).toBeGreaterThan(0)
      // The flame spends itself boiling the sheet dry and arrives with nothing.
      expect(total(wet, CHAR)).toBeLessThan(total(dry, CHAR) * 0.2)
    })

    it('keeps its water as it spreads — only drying removes any', () => {
      // Conservation is the property the first stencil broke. What leaves a
      // cell has to arrive in its neighbour, including at the edge of a hole.
      const field = new DamageField({ drying: 0, fibre: 0.6, anisotropy: 4 })
      field.punch(0.3, 0.5, 0.06)
      field.wet(0.45, 0.5, 0.06, 1)
      const start = total(field, SATURATION)
      run(field, 3)
      // Within the rest-snap's floor across the patch's footprint.
      expect(Math.abs(total(field, SATURATION) - start)).toBeLessThan(start * 0.02)
    })
  })

  describe('presence', () => {
    it('takes paper away along a cut, and never gives it back', () => {
      const field = new DamageField()
      field.cut(0.1, 0.5, 0.9, 0.5, 0.03)
      const after = run(field, 1)
      expect(after.remaining).toBeLessThan(1)
      const remaining = after.remaining
      run(field, 3)
      expect(field.lastStats.remaining).toBeLessThanOrEqual(remaining + 1e-9)
    })

    it('punches a hole in the middle, which a fixed-topology mesh cannot', () => {
      const field = new DamageField()
      field.punch(0.5, 0.5, 0.08)
      expect(field.sample(0.5, 0.5)[PRESENCE]).toBe(0)
      // And the edge of the sheet is untouched — it is a hole, not a shrink.
      expect(field.sample(0.02, 0.02)[PRESENCE]).toBe(1)
    })

    it('stops a fire at a hole, because heat does not cross missing paper', () => {
      const beyond = (field: DamageField) => {
        let sum = 0
        const n = field.size
        for (let y = Math.round(0.62 * (n - 1)); y < n; y++) {
          for (let x = 0; x < n; x++) sum += field.data[(y * n + x) * 4 + CHAR]!
        }
        return sum
      }
      const gap = new DamageField({ grain: 0, seed: 2 })
      const solid = new DamageField({ grain: 0, seed: 2 })
      gap.cut(0, 0.5, 1, 0.5, 0.05)
      for (const f of [gap, solid]) {
        f.ignite(0.5, 0.2, 0.05, 1)
        run(f, 5)
      }
      expect(beyond(solid)).toBeGreaterThan(0)
      expect(beyond(gap)).toBeLessThan(beyond(solid) * 0.5)
    })
  })

  it('reports a front that grows and then falls away as the sheet runs out', () => {
    // The number fire's audio is driven by. A level driven by how much has
    // burnt would get the end of a fire exactly backwards.
    const field = new DamageField({ seed: 8 })
    field.ignite(0.5, 0.5, 0.06, 1)
    let peak = 0
    let atPeak = 0
    const frames = 60 * 8
    for (let i = 0; i < frames; i++) {
      const stats = field.step(1 / 60)
      if (stats.front > peak) {
        peak = stats.front
        atPeak = i
      }
    }
    expect(peak).toBeGreaterThan(0)
    expect(atPeak).toBeLessThan(frames - 1)
    expect(field.lastStats.front).toBeLessThan(peak)
  })

  it('never produces a NaN or leaves a channel outside 0..1', () => {
    // Every effect reads these straight into a shader and into per-vertex
    // mass. One NaN anywhere takes the whole sheet with it.
    const field = new DamageField({ seed: 6, fibre: 0.7, anisotropy: 6 })
    field.ignite(0.3, 0.3, 0.1, 1)
    field.wet(0.7, 0.6, 0.15, 1)
    field.cut(0.1, 0.8, 0.9, 0.85, 0.02)
    field.punch(0.2, 0.7, 0.05)
    // Absurd deltas as well as sane ones — a dropped frame is not a crash.
    for (let i = 0; i < 240; i++) field.step(i % 17 === 0 ? 0.9 : 1 / 60)
    for (let i = 0; i < field.data.length; i++) {
      const value = field.data[i]!
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })

  it('is reproducible: the same seed burns the same way', () => {
    const a = new DamageField({ seed: 42 })
    const b = new DamageField({ seed: 42 })
    for (const f of [a, b]) {
      f.ignite(0.4, 0.6, 0.05, 1)
      run(f, 1.5)
    }
    expect(Array.from(a.data)).toEqual(Array.from(b.data))
  })

  it('runs one grid on every device', () => {
    // Not tiered: the same fire everywhere, which a shared burn needs.
    expect(new DamageField().size).toBe(FIELD_SIZE)
    expect(new DamageField().data.length).toBe(FIELD_SIZE * FIELD_SIZE * 4)
  })
})

describe('the stats a consumer reads every frame', () => {
  it('forgets water that went with the paper it was in', () => {
    // The running total used to keep water whose cell had been punched out —
    // zeroed in the cell, never taken off the sum — so `saturation` drifted
    // upward for good, and the coupling reads it as added mass.
    const field = new DamageField({ drying: 0 })
    field.wet(0.5, 0.5, 0.1, 1)
    run(field, 0.2)
    const wet = field.lastStats.saturation
    field.punch(0.5, 0.5, 0.2)
    run(field, 0.2)
    const measured = total(field, SATURATION) / (field.size * field.size)
    expect(field.lastStats.saturation).toBeCloseTo(measured, 6)
    expect(field.lastStats.saturation).toBeLessThan(wet)
  })

  it('keeps reporting the front on a frame too short to step', () => {
    // At 144 Hz roughly one frame in six runs no fixed step. Nothing about
    // the fire changed on it, so the front has not either — reporting 0 there
    // would drop the burn's sound to silence mid-burn.
    const field = new DamageField({ seed: 3 })
    field.ignite(0.5, 0.5, 0.06, 1)
    run(field, 0.6)
    const burning = field.lastStats.front
    expect(burning).toBeGreaterThan(0)
    // Less than one fixed step of time: the accumulator runs nothing.
    const quiet = field.step(FIXED_DT * 0.25)
    expect(quiet.front).toBe(burning)
    // The events, by contrast, genuinely did not happen on it.
    expect(quiet.charred).toBe(0)
  })

  it('does not hand the same fire back twice on a frame with no time in it', () => {
    // The emitters shed a flake for every cell in `consumedCells`, and the
    // sound plays a crackle per texel that chars. So a frame with no time in
    // it — the first one, or one whose clock ran backwards — has to report
    // that nothing happened, or both replay the last frame's fire.
    const field = new DamageField({ seed: 3 })
    field.ignite(0.5, 0.5, 0.08, 1)
    let consumed = 0
    for (let i = 0; i < 600 && consumed === 0; i++) consumed = field.step(1 / 60).consumed
    expect(consumed).toBeGreaterThan(0)
    expect(field.consumedCount).toBe(consumed)
    const burning = field.lastStats.front
    expect(burning).toBeGreaterThan(0)

    const idle = field.step(0)
    expect(idle.consumed).toBe(0)
    expect(idle.charred).toBe(0)
    expect(idle.wetted).toBe(0)
    expect(field.consumedCount).toBe(0)
    // The front is not transient — it is the state of the burn, and it is
    // held across a frame too short to step, as it always was.
    expect(idle.front).toBe(burning)
    expect(field.frontCount).toBeGreaterThan(0)
  })

  it('says WHERE it burnt through and where the front is, not just how much', () => {
    // The emitters need a place: ash leaves the texel that just went, embers
    // and smoke leave the front. Counts alone could only make a fire that
    // throws sparks from the middle of the sheet.
    const field = new DamageField({ seed: 3 })
    field.ignite(0.5, 0.5, 0.08, 1)
    let consumedSeen = 0
    for (let i = 0; i < 240; i++) {
      const stats = field.step(1 / 60)
      expect(field.consumedCount).toBe(stats.consumed)
      for (let k = 0; k < field.consumedCount; k++) {
        // Every cell it named has no paper left in it.
        expect(field.data[field.consumedCells[k]! * 4 + PRESENCE]).toBe(0)
        consumedSeen++
      }
      // The front it names is the front it counted, and every cell on it is
      // paper that is part-burnt and still hot — the burning line itself.
      expect(field.frontCount).toBe(Math.round(stats.front * field.size * field.size))
      for (let k = 0; k < field.frontCount; k++) {
        const b = field.frontCells[k]! * 4
        expect(field.data[b + PRESENCE]!).toBeGreaterThan(0.15)
        expect(field.data[b + HEAT]!).toBeGreaterThan(0.1)
        expect(field.data[b + CHAR]!).toBeGreaterThan(0.08)
      }
    }
    expect(consumedSeen).toBeGreaterThan(0)
  })
})
