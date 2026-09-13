import { describe, expect, it, vi } from 'vitest'
import { CHAR, PRESENCE } from 'paperlab/fx'
import { DURATION, ScriptedBurn, planBurn, type BurnOrigin } from './burn'

/**
 * **The budget the look is held to, in the numbers the spec states.**
 *
 * Every check in `tools/fire-look.mjs` is of one shape: nothing changed that
 * should not have — post leaves an unburnt sheet alone, heat lights only the
 * rim, paper never blooms. Not one of them measures the fire against a number
 * `paperlab-fx-fire-spec.md` asks for, which is how all twelve passed while
 * the burn was six times too fast and the flames never bloomed at all. The
 * gate's own file says so: "Passing it is still not done."
 *
 * These are the other half. The review measured five things in an afternoon —
 * spread in mm/s, how much of the sheet was gone and when, the char band, the
 * life of the fire, the phase times — and every one of them is a property of
 * the simulation alone: no renderer, no references, no browser. So they run
 * here, in `pnpm test`, on every commit, rather than in a harness that needs
 * 20 MB of stills that are deliberately not in this repo.
 *
 * The ranges are the spec's, not this burn's. A number that drifts out of one
 * is a fire that has stopped being paper burning, and it should fail here
 * rather than wait for somebody to notice in a screenshot.
 */

vi.setConfig({ testTimeout: 30_000 })

const MM = 210
const flatSheet = (u: number, v: number) => ({ x: (u - 0.5) * 1, y: (v - 0.5) * 1.4, z: 0 })

interface Paced {
  /** Median growth of the hole's radius while it is spreading, mm/s. */
  spread: number
  /** Median width of the band that is charred and still there, mm. */
  band: number
  /** The hole's radius at 4 s, mm. */
  radiusAt4: number
  /** When the last flame goes out, s. */
  life: number
  /** How much of the sheet is gone when it is over, 0..1. */
  gone: number
}

/**
 * Step one burn and measure it. Sampled on a fixed grid rather than every
 * step: this runs a 64² field for 24 simulated seconds and the numbers below
 * do not move at a finer sample.
 */
function pace(origin: BurnOrigin): Paced {
  const burn = new ScriptedBurn(flatSheet, { origin })
  const size = burn.field.size
  const cells = size * size
  const measure = () => {
    const d = burn.field.data
    let gone = 0
    let charPresent = 0
    for (let i = 0; i < cells; i++) {
      if (d[i * 4 + PRESENCE]! < 0.5) gone++
      else if (d[i * 4 + CHAR]! > 0.5) charPresent++
    }
    const rHole = Math.sqrt(gone / cells / Math.PI) * MM
    return { gone: gone / cells, rHole, band: Math.sqrt((gone + charPresent) / cells / Math.PI) * MM - rHole }
  }
  const spreads: number[] = []
  const bands: number[] = []
  let previous = { t: 0, r: 0 }
  let radiusAt4 = 0
  let next = 0.25
  let gone = 0
  while (burn.time < DURATION - 1e-6) {
    burn.advance()
    if (burn.time < next) continue
    next += 0.25
    const m = measure()
    gone = m.gone
    // Only while it is genuinely spreading: a front that is alight, and a
    // hole that is open. Outside that the rate is either the ignition
    // transient or zero, and neither is the fire's spread.
    if (burn.stats.front > 0.004 && m.gone > 0.02) {
      spreads.push((m.rHole - previous.r) / Math.max(burn.time - previous.t, 1e-6))
      bands.push(m.band)
    }
    if (radiusAt4 === 0 && burn.time >= 4) radiusAt4 = m.rHole
    previous = { t: burn.time, r: m.rHole }
  }
  const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0
  return {
    spread: median(spreads),
    band: median(bands),
    radiusAt4,
    life: burn.wentOut ?? DURATION,
    gone,
  }
}

describe('the burn, against the spec', () => {
  const center = pace('center')
  const corner = pace('corner')

  it('spreads at 3-8 mm/s (§9)', () => {
    // It was 39 mm/s from the centre and 27 from a corner — six times too
    // fast, and the root cause of most of the review: there was no time to
    // watch it spread, so every phase was judged at the wrong size.
    expect(center.spread).toBeGreaterThanOrEqual(3)
    expect(center.spread).toBeLessThanOrEqual(8)
    expect(corner.spread).toBeGreaterThanOrEqual(3)
    expect(corner.spread).toBeLessThanOrEqual(8)
  })

  it('leaves a charred band of 2-8 mm behind the front (§5)', () => {
    // The band is the front's speed over `consumeRate`, so it moves whenever
    // the pace does — which is exactly why it is checked beside it.
    expect(center.band).toBeGreaterThanOrEqual(2)
    expect(center.band).toBeLessThanOrEqual(8)
    expect(corner.band).toBeGreaterThanOrEqual(2)
    expect(corner.band).toBeLessThanOrEqual(8)
  })

  it('opens a hole about a quarter of the sheet across by 4 seconds', () => {
    // Hero.png's hole at its peak. A quarter of 210 mm across is a radius of
    // about 26 mm; the range is generous because the reference is a
    // photograph, not a measurement.
    expect(center.radiusAt4).toBeGreaterThan(15)
    expect(center.radiusAt4).toBeLessThan(34)
  })

  it('lives long enough to watch, and gives up while the hole is still a hole', () => {
    expect(center.life).toBeGreaterThan(8)
    expect(center.life).toBeLessThan(13)
    // A corner burn spreads along the fibre as a line rather than a disc, so
    // it covers the sheet more slowly and genuinely takes longer.
    expect(corner.life).toBeGreaterThan(8)
    expect(corner.life).toBeLessThan(DURATION)
    // Paper left all round the hole, from either origin.
    expect(center.gone).toBeGreaterThan(0.15)
    expect(center.gone).toBeLessThan(0.6)
    expect(corner.gone).toBeGreaterThan(0.1)
    expect(corner.gone).toBeLessThan(0.6)
  })

  it('reaches every phase in order, inside the scrubber', () => {
    for (const origin of ['center', 'corner'] as const) {
      // The scrubber is as long as the burn now, not a fixed 24 s — a burn
      // asked to eat the whole sheet runs for most of a minute.
      const { phases, duration } = planBurn({ origin })
      const at = phases.map((p) => p.at)
      for (let i = 1; i < at.length; i++) expect(at[i]!).toBeGreaterThan(at[i - 1]!)
      expect(at.at(-1)!).toBeLessThanOrEqual(duration)
      // And none of them says the burn was still going when it was
      // photographed — `phasesFor` sets `gap` when it is.
      for (const p of phases.filter((q) => ['dying', 'smoulder', 'cold'].includes(q.id))) {
        expect(p.gap).toBeUndefined()
      }
    }
  })
})
