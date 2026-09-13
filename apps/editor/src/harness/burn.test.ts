import { describe, expect, it, vi } from 'vitest'
import { FIXED_DT, HEAT } from 'paperlab/fx'
import {
  DURATION,
  ORIGINS,
  PHASES,
  ScriptedBurn,
  decayAtFor,
  looseShare,
  phase,
  planBurn,
  rimCrops,
} from './burn'

/**
 * The lab's burn, pinned where it matters: it is the same burn twice, and the
 * phase table describes the fire that actually happens.
 *
 * `PHASES` is the thing most likely to rot. Its times were measured off this
 * simulation, and any change to the field's defaults — or to `flame.ts` —
 * moves them. A capture script photographing "peak" 400 ms after the peak, or
 * "cold" while the sheet is still alight, would go on producing plausible
 * images and comparing them to the wrong references, which is exactly the
 * failure the whole visual gate exists to stop.
 *
 * No renderer here. The locator stands in for the sheet: flat, 1 × 1.4 world
 * units, which is what `<Paper>` draws by default.
 */
/**
 * Stepping whole burns is not free, and CI runs about five times slower than
 * the laptop — the same reason `flame.test.ts` does this. A burn is 24
 * simulated seconds of a 64² field now, not 12.
 */
vi.setConfig({ testTimeout: 30_000 })

const flatSheet = (u: number, v: number) => ({ x: (u - 0.5) * 1, y: (v - 0.5) * 1.4, z: 0 })

describe('the scripted burn', () => {
  it('seeks to the same pixels twice', () => {
    const a = new ScriptedBurn(flatSheet)
    const b = new ScriptedBurn(flatSheet)
    a.seek(2.2)
    b.seek(2.2)
    expect(Array.from(b.field.pixels)).toEqual(Array.from(a.field.pixels))
    expect(b.stats).toEqual(a.stats)
  })

  it('and playing to a time lands exactly where seeking to it does', () => {
    const played = new ScriptedBurn(flatSheet)
    const sought = new ScriptedBurn(flatSheet)
    // Ragged frames, the way a browser delivers them — the point is that the
    // fixed step makes the frame rate not matter.
    let t = 0
    for (const delta of [0.021, 0.008, 0.033, 0.017, 0.05, 0.011]) {
      played.play(delta, 1)
      t += delta
    }
    sought.seek(played.time)
    // Never ahead of the wall clock, and never more than one step behind it:
    // the remainder is carried, not spent.
    expect(played.time).toBeLessThanOrEqual(t)
    expect(t - played.time).toBeLessThan(FIXED_DT)
    expect(Array.from(played.field.pixels)).toEqual(Array.from(sought.field.pixels))
  })

  it('throws the same sparks both times', () => {
    const a = new ScriptedBurn(flatSheet)
    const b = new ScriptedBurn(flatSheet)
    a.seek(2.2)
    b.seek(2.2)
    const positions = (burn: ScriptedBurn) => {
      const target = {
        position: new Float32Array(burn.pool.capacity * 3),
        color: new Float32Array(burn.pool.capacity * 4),
        extra: new Float32Array(burn.pool.capacity * 4),
      }
      const other = {
        position: new Float32Array(burn.pool.capacity * 3),
        color: new Float32Array(burn.pool.capacity * 4),
        extra: new Float32Array(burn.pool.capacity * 4),
      }
      burn.pool.write(target, other)
      return [Array.from(target.position), Array.from(other.position)]
    }
    expect(positions(b)).toEqual(positions(a))
  })

  it('reaches every phase the capture script photographs', () => {
    for (const p of PHASES) expect(p.at).toBeLessThanOrEqual(DURATION)
  })

  it('has burnt nothing at contact, and is only scorched by the next phase', () => {
    const burn = new ScriptedBurn(flatSheet)
    burn.seek(phase('contact').at)
    expect(burn.stats.remaining).toBe(1)
    expect(burn.stats.front).toBe(0)

    burn.seek(phase('scorch').at)
    // Charring, but nothing gone: the brown arrives before the hole does.
    expect(burn.stats.front).toBeGreaterThan(0)
    expect(burn.stats.remaining).toBe(1)
  })

  it('has burnt through by catch, and is at its widest at peak', () => {
    const burn = new ScriptedBurn(flatSheet)
    burn.seek(phase('catch').at)
    expect(burn.stats.remaining).toBeLessThan(1)

    // The peak is a peak: longer front than half a second either side of it.
    const at = (t: number) => {
      const b = new ScriptedBurn(flatSheet)
      b.seek(t)
      return b.stats.front
    }
    const peak = phase('peak').at
    expect(at(peak)).toBeGreaterThan(at(peak - 0.5))
    expect(at(peak)).toBeGreaterThan(at(peak + 0.5))
  })

  /**
   * The ending, pinned. It used to be a scripted blow a moment after the
   * peak — a fire stopped, not finished. Now it carries on past its longest
   * front and dies by itself: dying, then no flames, then asleep, with paper
   * left and never an empty frame.
   */
  it('burns on past its peak, then dies by itself — dying, smoulder, cold', () => {
    const burn = new ScriptedBurn(flatSheet)
    burn.seek(phase('peak').at)
    const atPeak = burn.stats.remaining
    burn.seek(phase('dying').at)
    // Still burning, and still eating paper, after the peak.
    expect(burn.stats.front).toBeGreaterThan(0)
    expect(burn.stats.remaining).toBeLessThan(atPeak)
    expect(burn.dying).toBeGreaterThan(0)
    burn.seek(phase('smoulder').at)
    expect(burn.stats.front).toBe(0)
    burn.seek(phase('cold').at)
    // Cold: no heat left in the sheet that 8 bits can draw — only the last
    // beads' afterglow, fading. Not "the field asleep", which it used to
    // check: paper charred just past the line where it is consumed goes on
    // being eaten, a few ten-thousandths of the sheet over the next twenty
    // seconds, and when THAT stops depends on exactly where the fire stopped.
    // The old default happened to sleep; a third of the sheet does not.
    let heat = 0
    for (let i = HEAT; i < burn.field.pixels.length; i += 4) heat = Math.max(heat, burn.field.pixels[i]!)
    expect(heat).toBe(0)
    // It finished while the hole was still a hole. `decayAt` is 0.22 now, not
    // 0.5: at the field's dilated clock a fire allowed to reach half the sheet
    // ran past 13 s and ate 62% of it, and the review's whole complaint about
    // the ending was that "dying" was a strip of paper under huge flames.
    // About a third burnt, with paper all round the hole.
    expect(burn.stats.remaining).toBeLessThan(0.8)
    expect(burn.stats.remaining).toBeGreaterThan(0.5)
    for (const id of ['dying', 'smoulder', 'cold']) expect(phase(id).gap).toBeUndefined()
  })

  it('in order: peak, then dying, then smoulder, then cold — for either origin', () => {
    for (const origin of ['center', 'corner'] as const) {
      // ONE burn per origin. `at` used to call `phasesFor` itself, so this
      // test stepped ten full burns instead of two — invisible while a burn
      // was 12 simulated seconds, a timeout once it became 24.
      const { phases, duration } = planBurn({ origin })
      const at = (id: string) => phase(id, phases).at
      expect(at('catch')).toBeLessThan(at('peak'))
      expect(at('peak')).toBeLessThan(at('dying'))
      expect(at('dying')).toBeLessThan(at('smoulder'))
      expect(at('smoulder')).toBeLessThan(at('cold'))
      expect(at('cold')).toBeLessThanOrEqual(duration)
    }
  })

  /**
   * How much burns is what the lab is asked for now, and it is measured on
   * the cold sheet — not the moment the fire starts to die, which is what it
   * used to be asked, and which left a third more burnt than it said.
   */
  it('burns the amount it is asked for, from either origin', () => {
    const asks = [
      ['center', [0.15, 0.5, 0.8]],
      ['corner', [0.25, 0.6]],
    ] as const
    for (const [origin, amounts] of asks) {
      for (const amount of amounts) {
        expect(Math.abs(planBurn({ origin, amount }).burnt - amount)).toBeLessThanOrEqual(0.01)
      }
    }
  })

  it('told to burn all of it, burns all of it — and runs long enough to watch it end', () => {
    const plan = planBurn({ amount: 1 })
    expect(plan.burnt).toBeGreaterThan(0.99)
    expect(plan.wentOut).not.toBeNull()
    // Longer than the default scrubber, which would have cut the ending off.
    expect(plan.duration).toBeGreaterThan(DURATION)
    for (const p of plan.phases) expect(p.at).toBeLessThanOrEqual(plan.duration)
    expect(phase('cold', plan.phases).at).toBeGreaterThan(plan.wentOut!)
  })

  /**
   * The fibre runs across the sheet, so a burn from the centre races
   * sideways to both edges — and once enough of it burns, the paper below
   * the hole is joined to nothing. A sheet hung by its top edge drops it.
   */
  it('from the centre, cuts the bottom of the sheet loose once enough burns — and not at a third', () => {
    expect(planBurn().severedAt).toBeNull()
    const cut = planBurn({ amount: 0.42 })
    expect(cut.severedAt).not.toBeNull()
    expect(cut.severedAt!).toBeLessThan(cut.wentOut!)
    // Off the sheet at that moment: there really is a piece joined to nothing.
    const burn = new ScriptedBurn(flatSheet, { amount: 0.42, decayAt: cut.decayAt })
    burn.seek(cut.severedAt!)
    expect(looseShare(burn.field)).toBeGreaterThan(0.005)
    // From a corner the fire eats upward as a line, and cuts nothing loose.
    expect(planBurn({ origin: 'corner', amount: 0.42 }).severedAt).toBeNull()
  })

  it("guesses when to start dying close enough that the guess is worth making — the table isn't stale", () => {
    // `decayAtFor`'s table against the burn it predicts. `planBurn` corrects
    // a bad guess, so a stale table costs time rather than a wrong burn —
    // which is exactly why nothing else would notice it going stale.
    for (const origin of ['center', 'corner'] as const) {
      for (const amount of [0.2, 0.45, 0.7]) {
        const burnt = planBurn({ origin, decayAt: decayAtFor(amount, origin) }).burnt
        expect(Math.abs(burnt - amount)).toBeLessThan(0.03)
      }
    }
  })

  it('left to burn (decayAt 1), it eats the whole sheet', () => {
    const burn = new ScriptedBurn(flatSheet, { decayAt: 1 })
    // 9 s while the field's clock ran six times too fast. Measured at the pace
    // it runs now: 78% left at 9 s, 31% at 18 s, 4% at 30 s, none at 36 s.
    burn.seek(36)
    expect(burn.stats.remaining).toBeLessThan(0.01)
    expect(burn.decayStarted).toBeNull()
  })

  /**
   * The corner burn eats the sheet from the bottom up and never opens a hole
   * in the middle. Measured off the rows: at every moment the burnt paper is
   * a band from the bottom edge, and its top climbs.
   */
  it('from a corner, it eats upward from the bottom and opens no hole in the middle', () => {
    const burn = new ScriptedBurn(flatSheet, { origin: 'corner' })
    const size = burn.field.size
    const last = size - 1
    const top = () => {
      let hi = -1
      let lo = size
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++)
          if (burn.field.pixels[(y * size + x) * 4 + 3]! < 128) {
            hi = Math.max(hi, y)
            lo = Math.min(lo, y)
          }
      return { hi: hi / last, lo: lo / last }
    }
    let was = 0
    for (const t of [2, 3, 4, 5]) {
      burn.seek(t)
      const band = top()
      expect(band.lo).toBe(0)
      expect(band.hi).toBeGreaterThan(was)
      was = band.hi
      // The middle of the sheet is still there until the band reaches it.
      const half = Math.floor(last / 2)
      const mid = burn.field.pixels[(half * size + half) * 4 + 3]!
      if (band.hi < 0.45) expect(mid).toBeGreaterThanOrEqual(128)
    }
    expect(ORIGINS.corner.v).toBeLessThan(0.1)
  })

  it('with smoke off, throws no smoke at all — whatever rate is asked for', () => {
    // The pool throws a light thread of puffs by default (Noor's tune,
    // 2026-09-13), and a lab sidebar can ask for more. "Smoke off" has to win
    // over both, which is what this checks.
    const off = new ScriptedBurn(flatSheet, { smoke: false })
    off.setEmit({ embers: true, smoke: true, ash: true }, { smoke: 0.2 })
    off.seek(phase('dying').at)
    expect(off.pool.countOf('smoke')).toBe(0)

    const on = new ScriptedBurn(flatSheet)
    on.setEmit({ embers: true, smoke: true, ash: true }, { smoke: 0.2 })
    on.seek(phase('dying').at)
    expect(on.pool.countOf('smoke')).toBeGreaterThan(0)

    // With nobody asking, the default throws some; switched off, even the
    // default is none.
    const quiet = new ScriptedBurn(flatSheet)
    quiet.seek(phase('dying').at)
    expect(quiet.pool.countOf('smoke')).toBeGreaterThan(0)
    const quietOff = new ScriptedBurn(flatSheet, { smoke: false })
    quietOff.seek(phase('dying').at)
    expect(quietOff.pool.countOf('smoke')).toBe(0)
  })

  it('sheds ash off the cooling edge as it dies', () => {
    // A trickle from burning through, so the tier's cap on flakes in the air
    // is not what decides the count — at the default rate it fills by itself.
    const trickle = { embers: true, smoke: true, ash: true }
    const none = new ScriptedBurn(flatSheet, { ash: 0 })
    const some = new ScriptedBurn(flatSheet)
    none.setEmit(trickle, { ash: 0.02 })
    some.setEmit(trickle, { ash: 0.02 })
    none.seek(phase('smoulder').at)
    some.seek(phase('smoulder').at)
    expect(some.pool.countOf('ash')).toBeGreaterThan(none.pool.countOf('ash'))
  })

  it('picks three crops off the rim of the hole, the same three every time', () => {
    const burn = new ScriptedBurn(flatSheet)
    burn.seek(phase('peak').at)
    const crops = rimCrops(burn.field)
    expect(crops.map((c) => c.id)).toEqual(['upper', 'lower', 'side'])
    for (const crop of crops) {
      expect(crop.u).toBeGreaterThanOrEqual(0)
      expect(crop.u).toBeLessThanOrEqual(1)
      expect(crop.v).toBeGreaterThanOrEqual(0)
      expect(crop.v).toBeLessThanOrEqual(1)
    }
    // The top of the front is above the bottom of it. Trivially true, and the
    // thing that breaks first if the cell → UV conversion ever flips v.
    expect(crops[0]!.v).toBeGreaterThan(crops[1]!.v)

    const again = new ScriptedBurn(flatSheet)
    again.seek(phase('peak').at)
    expect(rimCrops(again.field)).toEqual(crops)
  })

  it('finds no crops on a sheet with no hole in it', () => {
    expect(rimCrops(new ScriptedBurn(flatSheet).field)).toEqual([])
  })
})
