import { describe, expect, it, vi } from 'vitest'
import { CHAR, DamageField, HEAT, PRESENCE, SATURATION } from './field'

/**
 * The damage field is the one primitive the whole effects layer stands on, so
 * what it owes is not "fire looks good" but a handful of properties that have
 * to hold for every effect built on top of it — and that a shader demo can
 * fake while a simulation cannot.
 *
 * These run in milliseconds with no renderer, which is the argument for the
 * field being CPU-side at all. Every one of them would otherwise have been a
 * question for `test:hands`, and `test:hands` answers questions differently
 * on different runs.
 */

/**
 * CI is roughly five times slower than the machine these were written on, and
 * vitest's default is five seconds a test. The heaviest case here runs the
 * `high` tier — 16,384 cells, four substeps — for a few hundred frames, which
 * is comfortably under a second locally and uncomfortably near the default
 * there. Generous rather than tight: the point of the number is to catch a
 * hang, not to police a simulation's speed on hardware nobody has measured.
 */
vi.setConfig({ testTimeout: 30_000 })

const run = (field: DamageField, seconds: number, dt = 1 / 60) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) field.step(dt)
  return field.lastStats
}

/** Channel totals over the whole sheet. */
function total(field: DamageField, channel: number): number {
  let sum = 0
  for (let i = channel; i < field.data.length; i += 4) sum += field.data[i]!
  return sum
}

/**
 * How far a channel's mass is spread along each axis — its standard
 * deviation in u and in v, weighted by the value itself.
 *
 * Threshold-free on purpose: it is the shape of the distribution, which is
 * what anisotropy is a claim about, and it does not move when the rates or
 * the amounts are retuned.
 */
function spread(field: DamageField, channel: number): [number, number] {
  const n = field.size
  let mass = 0
  let mu = 0
  let mv = 0
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const w = field.data[(y * n + x) * 4 + channel]!
      mass += w
      mu += w * x
      mv += w * y
    }
  }
  if (mass === 0) return [0, 0]
  mu /= mass
  mv /= mass
  let vu = 0
  let vv = 0
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const w = field.data[(y * n + x) * 4 + channel]!
      vu += w * (x - mu) ** 2
      vv += w * (y - mv) ** 2
    }
  }
  return [Math.sqrt(vu / mass), Math.sqrt(vv / mass)]
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

describe('the damage field', () => {
  it('starts as a whole sheet with nothing wrong with it', () => {
    const field = new DamageField({ quality: 'low' })
    expect(field.lastStats.remaining).toBe(1)
    expect(total(field, CHAR)).toBe(0)
    expect(total(field, HEAT)).toBe(0)
    expect(total(field, PRESENCE)).toBe(field.size * field.size)
  })

  it('burns: heat becomes char, char eats presence, and the front travels', () => {
    const field = new DamageField({ quality: 'medium', seed: 3 })
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

  it('burns along the grain further than across it', () => {
    // The single property that makes it read as paper rather than as a fluid.
    const field = new DamageField({ quality: 'medium', fibre: 0, anisotropy: 4, grain: 0, seed: 5 })
    field.ignite(0.5, 0.5, 0.04, 1)
    run(field, 1.2)

    const n = field.size
    const mid = Math.round(0.5 * (n - 1))
    let alongReach = 0
    let acrossReach = 0
    for (let k = 0; k < n; k++) {
      if (field.data[(mid * n + k) * 4 + CHAR]! > 0.3) alongReach = Math.max(alongReach, Math.abs(k - mid))
      if (field.data[(k * n + mid) * 4 + CHAR]! > 0.3) acrossReach = Math.max(acrossReach, Math.abs(k - mid))
    }
    expect(alongReach).toBeGreaterThan(acrossReach)
  })

  it('leaves a ragged edge, because paper is not uniform', () => {
    // With grain at zero the front is a circle, which is the most synthetic
    // thing this could do. The test is that the grain actually breaks it.
    const smooth = new DamageField({ quality: 'medium', grain: 0, anisotropy: 1, seed: 9 })
    const real = new DamageField({ quality: 'medium', grain: 0.5, anisotropy: 1, seed: 9 })
    for (const f of [smooth, real]) {
      f.ignite(0.5, 0.5, 0.05, 1)
      run(f, 1)
    }

    // Roughness: how much the radius of the charred region varies with angle.
    const spread = (field: DamageField) => {
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
      const mean = radii.reduce((a, b) => a + b, 0) / radii.length
      const variance = radii.reduce((s, r) => s + (r - mean) ** 2, 0) / radii.length
      return Math.sqrt(variance)
    }

    expect(spread(real)).toBeGreaterThan(spread(smooth))
  })

  it('will not light wet paper, and dunking a burning corner puts it out', () => {
    const dry = new DamageField({ quality: 'medium', seed: 4 })
    const wet = new DamageField({ quality: 'medium', seed: 4 })
    wet.wet(0.5, 0.5, 0.25, 1)

    for (const f of [dry, wet]) {
      f.ignite(0.5, 0.5, 0.05, 1)
      run(f, 1.2)
    }

    expect(total(dry, CHAR)).toBeGreaterThan(0)
    // The flame spends itself boiling the sheet dry and arrives with nothing.
    expect(total(wet, CHAR)).toBeLessThan(total(dry, CHAR) * 0.2)
  })

  it('wicks along the fibre, which is why a wet front is not a circle', () => {
    const field = new DamageField({ quality: 'medium', fibre: Math.PI / 2, anisotropy: 4, grain: 0 })
    field.wet(0.5, 0.5, 0.03, 1)
    run(field, 2)

    // Measured as the spread of the saturation itself rather than by a
    // threshold. A threshold answers a different question every time the
    // rates are tuned — the patch thins as it spreads, so "how far out does
    // it still read above 0.05" is as much about how much water there was as
    // about which way it went. The second moment is the shape, and nothing
    // else.
    const [spreadU, spreadV] = spread(field, SATURATION)
    expect(spreadV).toBeGreaterThan(spreadU * 1.2)
  })

  it('takes paper away along a cut, and never gives it back', () => {
    const field = new DamageField({ quality: 'low' })
    field.cut(0.1, 0.5, 0.9, 0.5, 0.03)
    const after = run(field, 1)
    expect(after.remaining).toBeLessThan(1)

    const remaining = after.remaining
    run(field, 3)
    // Nothing regrows: presence is one-way, so every effect built on it is too.
    expect(field.lastStats.remaining).toBeLessThanOrEqual(remaining + 1e-9)
  })

  it('punches a hole in the middle, which a fixed-topology mesh cannot', () => {
    const field = new DamageField({ quality: 'medium' })
    field.punch(0.5, 0.5, 0.08)
    expect(field.sample(0.5, 0.5)[PRESENCE]).toBe(0)
    // And the edge of the sheet is untouched — it is a hole, not a shrink.
    expect(field.sample(0.02, 0.02)[PRESENCE]).toBe(1)
  })

  it('stops a fire at a hole, because heat does not cross missing paper', () => {
    const gap = new DamageField({ quality: 'medium', grain: 0, seed: 2 })
    const solid = new DamageField({ quality: 'medium', grain: 0, seed: 2 })
    // A firebreak across the sheet between the flame and the far side.
    gap.cut(0, 0.5, 1, 0.5, 0.05)

    for (const f of [gap, solid]) {
      f.ignite(0.5, 0.2, 0.05, 1)
      run(f, 5)
    }

    const beyond = (field: DamageField) => {
      let sum = 0
      const n = field.size
      for (let y = Math.round(0.62 * (n - 1)); y < n; y++) {
        for (let x = 0; x < n; x++) sum += field.data[(y * n + x) * 4 + CHAR]!
      }
      return sum
    }
    expect(beyond(gap)).toBeLessThan(beyond(solid) * 0.5)
  })

  it('reports a front that grows and then falls away as the sheet runs out', () => {
    // The number fire's audio is driven by. A volume driven by how much has
    // burnt would get the end of a fire exactly backwards — a nearly consumed
    // sheet is quiet.
    const field = new DamageField({ quality: 'medium', seed: 8 })
    field.ignite(0.5, 0.5, 0.06, 1)

    let peak = 0
    let atPeak = 0
    for (let i = 0; i < 60 * 8; i++) {
      const stats = field.step(1 / 60)
      if (stats.front > peak) {
        peak = stats.front
        atPeak = i
      }
    }
    expect(peak).toBeGreaterThan(0)
    // It peaked somewhere in the middle rather than at the very last frame.
    expect(atPeak).toBeLessThan(60 * 8 - 1)
    expect(field.lastStats.front).toBeLessThan(peak)
  })

  it('never produces a NaN or leaves a channel outside 0..1', () => {
    // Every effect reads these straight into a shader and into per-vertex
    // mass. One NaN anywhere takes the whole sheet with it.
    const field = new DamageField({ quality: 'high', seed: 6 })
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
    const a = new DamageField({ quality: 'medium', seed: 42 })
    const b = new DamageField({ quality: 'medium', seed: 42 })
    for (const f of [a, b]) {
      f.ignite(0.4, 0.6, 0.05, 1)
      run(f, 1.5)
    }
    expect(Array.from(a.data)).toEqual(Array.from(b.data))
  })

  it('honours the tier it was given, because a tier is a size', () => {
    expect(new DamageField({ quality: 'low' }).size).toBe(64)
    expect(new DamageField({ quality: 'medium' }).size).toBe(96)
    expect(new DamageField({ quality: 'high' }).size).toBe(128)
    // Allocated once at that size — there is no path that grows it.
    const field = new DamageField({ quality: 'low' })
    expect(field.data.length).toBe(64 * 64 * 4)
  })
})
