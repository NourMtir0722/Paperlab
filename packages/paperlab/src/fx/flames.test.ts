import { describe, expect, it } from 'vitest'
import { DamageField, FIXED_DT } from './field'
import { FLAME_HEIGHT, IRREGULAR, flameAnchors, flamePuff, variation, type FlameAnchor } from './flames'

/** A flat sheet, upright, one unit across — `<Paper>`'s default. */
const upright = (u: number, v: number) => ({ x: u - 0.5, y: (v - 0.5) * 1.4, z: 0 })

function burning(seconds = 2.2): DamageField {
  const field = new DamageField()
  for (let t = 0; t < seconds; t += FIXED_DT) {
    if (t < 1.6) field.ignite(0.5, 0.32, 0.055, 5 * Math.min(1, (t + FIXED_DT) / 0.35) * FIXED_DT)
    field.step(FIXED_DT)
  }
  return field
}

describe('flame anchors', () => {
  it('stands no flame on a sheet that is not burning', () => {
    expect(flameAnchors(new DamageField(), upright, 32, [])).toBe(0)
  })

  it('stands them on the rim of the hole, and no more than it is allowed', () => {
    const out: FlameAnchor[] = []
    const n = flameAnchors(burning(), upright, 8, out)
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThanOrEqual(8)
    for (const a of out.slice(0, n)) {
      expect(a.height).toBeGreaterThan(0)
      expect(a.height).toBeLessThanOrEqual(FLAME_HEIGHT[1])
    }
  })

  it('is the same flames every time — a capture depends on it', () => {
    const a: FlameAnchor[] = []
    const b: FlameAnchor[] = []
    const na = flameAnchors(burning(), upright, 16, a)
    const nb = flameAnchors(burning(), upright, 16, b)
    expect(nb).toBe(na)
    expect(b.slice(0, nb)).toEqual(a.slice(0, na))
  })

  it('stands taller flames on the upper rim than on the lower, over time', () => {
    // Averaged over a second of the burn: at any one moment a strong cluster
    // may sit on the lower rim, and that is allowed — on average the upper
    // rim, where the gas rises over paper it preheats, burns taller.
    const up: number[] = []
    const down: number[] = []
    const field = burning()
    for (let t = 0; t < 1.2; t += 0.1) {
      const out: FlameAnchor[] = []
      const n = flameAnchors(field, upright, 32, out, field.time + t)
      for (const a of out.slice(0, n)) {
        if (a.upper > 0.5) up.push(a.height)
        if (a.upper < -0.5) down.push(a.height)
      }
    }
    const mean = (xs: number[]) => xs.reduce((s, h) => s + h, 0) / xs.length
    expect(up.length).toBeGreaterThan(0)
    expect(down.length).toBeGreaterThan(0)
    expect(mean(up)).toBeGreaterThan(mean(down))
  })

  /**
   * The rule: never a crown. A ring of equal, evenly spaced tongues is the
   * regularity a fake fire is spotted by, and it is an error here, not a
   * taste. Checked at many moments of a burn, because a check at one moment
   * would pass a ring that happened to look uneven once.
   */
  it('is never a uniform crown — heights vary, gaps open, and the ring re-forms', () => {
    const field = burning()
    let previous: Set<number> | null = null
    let changed = 0
    for (let t = 0; t < 2; t += 0.25) {
      const out: FlameAnchor[] = []
      const n = flameAnchors(field, upright, 32, out, field.time + t)
      expect(n).toBeGreaterThanOrEqual(3)
      // Tall tongues and short licks, not one height.
      expect(variation(out, n)).toBeGreaterThanOrEqual(IRREGULAR)
      // Uneven spacing: the gaps between neighbours around the ring differ.
      const angles = out
        .slice(0, n)
        .map((a) => Math.atan2(a.y + 0.25, a.x))
        .sort((p, q) => p - q)
      const gaps = angles.slice(1).map((a, i) => a - angles[i]!)
      const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length
      const spread = Math.sqrt(gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length) / mean
      expect(spread).toBeGreaterThan(0.3)
      // Breaking apart and re-forming: the set of flames changes with time.
      const seeds = new Set(out.slice(0, n).map((a) => Math.round(a.seed * 1e6)))
      if (previous) {
        const kept = [...seeds].filter((s) => previous!.has(s)).length
        if (kept < Math.max(seeds.size, previous.size) * 0.8) changed++
      }
      previous = seeds
    }
    expect(changed).toBeGreaterThanOrEqual(3)
  })

  it('turns with the sheet: upside down, the tall flames change rims', () => {
    const inverted = (u: number, v: number) => ({ x: u - 0.5, y: -(v - 0.5) * 1.4, z: 0 })
    const field = burning()
    const a: FlameAnchor[] = []
    const b: FlameAnchor[] = []
    const n = flameAnchors(field, upright, 32, a)
    flameAnchors(field, inverted, 32, b)
    for (let i = 0; i < n; i++) expect(Math.sign(b[i]!.upper)).toBe(-Math.sign(a[i]!.upper) || 0)
  })
})

describe('flame puff', () => {
  it('breathes, and two flames do not breathe together', () => {
    const a = [0, 0.02, 0.04, 0.06, 0.08].map((t) => flamePuff(0.1, t))
    const b = [0, 0.02, 0.04, 0.06, 0.08].map((t) => flamePuff(0.7, t))
    expect(new Set(a.map((x) => x.toFixed(4))).size).toBeGreaterThan(2)
    expect(a).not.toEqual(b)
    for (const x of [...a, ...b]) {
      expect(x).toBeGreaterThan(0.6)
      expect(x).toBeLessThan(1.1)
    }
  })
})
