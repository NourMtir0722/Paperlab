import { describe, expect, it, vi } from 'vitest'
import { CHAR, DamageField, PRESENCE } from './field'
import { FireEmitter, type FireEmitterOptions, type SurfaceLocator } from './fire'
import { ParticlePool, type ParticlePresetName } from './particles'

/**
 * A pool that remembers what it was asked for, at the moment it was asked.
 *
 * Where a particle IS cannot answer where it came from: ash drifts, and after
 * a few seconds in the air it may well be over paper that is still there.
 */
class Recording extends ParticlePool {
  readonly spawns: { name: ParticlePresetName; u: number; v: number }[] = []
  override spawn(name: ParticlePresetName, x: number, y: number, z: number): void {
    this.spawns.push({ name, u: x, v: y })
    super.spawn(name, x, y, z)
  }
}

/**
 * What a burn throws off, and where from.
 *
 * The emitter's whole job is to turn the field's own numbers into places: ash
 * from the texels that burnt through, embers and smoke from the front. So
 * every test here checks a PLACE or a count against the field, never that
 * "some particles appeared".
 */

vi.setConfig({ testTimeout: 30_000 })

/** A sheet lying in the unit square, so a particle's position IS its UV. */
const flat: SurfaceLocator = (u, v) => ({ x: u, y: v, z: 0 })

function burning(
  seconds: number,
  options: {
    field?: DamageField
    locate?: SurfaceLocator
    pool?: ParticlePool
    /** Rates, for the tests that need a kind the defaults no longer throw. */
    emit?: FireEmitterOptions
  } = {},
) {
  const field = options.field ?? new DamageField({ seed: 3 })
  const pool = options.pool ?? new ParticlePool(2000, 9)
  const emitter = new FireEmitter(field, pool, options.locate ?? flat, options.emit)
  field.ignite(0.5, 0.5, 0.08, 1)
  let consumed = 0
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    field.step(1 / 60)
    consumed += field.consumedCount
    emitter.update(1 / 60)
    pool.step(1 / 60)
  }
  return { field, pool, emitter, consumed }
}

describe('the fire emitter', () => {
  it('throws nothing off a sheet that is not burning', () => {
    const field = new DamageField()
    const pool = new ParticlePool(100)
    const emitter = new FireEmitter(field, pool, flat)
    for (let i = 0; i < 120; i++) {
      field.step(1 / 60)
      emitter.update(1 / 60)
    }
    expect(pool.count).toBe(0)
  })

  it('sheds ash from the texels that burnt through, and embers from paper still burning', () => {
    const pool = new Recording(2000, 9)
    // Smoke explicitly: this test is about WHERE each kind is born, and the
    // emitter's default smoke rate is 0 now (the simulator makes a burning
    // sheet's smoke). Without asking, there would be no puff to place.
    const { field, consumed } = burning(4, { pool, emit: { smoke: 0.2 } })
    expect(consumed).toBeGreaterThan(0)

    const ash = pool.spawns.filter((s) => s.name === 'ash')
    expect(ash.length).toBeGreaterThan(0)
    // One flake per consumed texel at most, and a fraction of that in practice.
    expect(ash.length).toBeLessThanOrEqual(consumed)
    // Every flake was born where the paper had gone — and presence never
    // comes back, so this holds however long the burn ran afterwards.
    for (const s of ash) expect(field.sample(s.u, s.v)[PRESENCE]).toBeLessThan(0.5)

    // Embers and smoke come off paper that is burning, not paper that is
    // already gone. Char only ever rises, so the same argument applies.
    //
    // The two are checked differently, because they are SPAWNED differently.
    // Smoke leaves the front cell itself, so the field under a puff must be
    // charred. An ember is deliberately lifted up to 0.09 UV — about 19 mm —
    // up a flame tongue and thrown a few millimetres to one side (see
    // `FireEmitter.emit`), so the field at an ember's own position is paper
    // ABOVE the front, and there is no reason for it to be charred.
    //
    // This used to assert char at the spawn for both, and passed only because
    // a fire spreading six times too fast had charred a wide enough band that
    // 19 mm up was still inside it. With the band at 5 mm (§5 wants 2–8) the
    // lift clears it, and the assertion was measuring the fire's SIZE while
    // claiming to measure where embers come from.
    const smoke = pool.spawns.filter((s) => s.name === 'smoke')
    expect(smoke.length).toBeGreaterThan(0)
    for (const s of smoke) expect(field.sample(s.u, s.v)[CHAR]).toBeGreaterThan(0.08)

    // An ember's source is under it: somewhere within the lift, straight down,
    // the paper was burning.
    const embers = pool.spawns.filter((s) => s.name === 'ember')
    expect(embers.length).toBeGreaterThan(0)
    for (const s of embers) {
      let charredBelow = false
      for (let drop = 0; drop <= 0.095; drop += 0.005) {
        if (field.sample(s.u, Math.max(0, s.v - drop))[CHAR]! > 0.08) {
          charredBelow = true
          break
        }
      }
      expect(charredBelow).toBe(true)
    }
  })

  it('throws embers off the burn front, a light thread of smoke, and none when told none', () => {
    // The default rates are Noor's tune (2026-09-13): the simulator's smoke
    // is the main smoke, and these puffs a light thread beside it. A rate of
    // 0 still has to mean none — the switch a sheet with clean air needs.
    expect(burning(2).pool.countOf('ember')).toBeGreaterThan(0)
    expect(burning(2).pool.countOf('smoke')).toBeGreaterThan(0)
    expect(burning(2, { emit: { smoke: 0 } }).pool.countOf('smoke')).toBe(0)
  })

  it('throws more the longer the front gets', () => {
    // The rate follows the front's LENGTH, which is the same number the
    // sound follows: a bigger fire is busier, and a nearly-consumed sheet
    // quietens down again.
    const small = burning(0.8)
    const big = burning(2.5)
    expect(big.field.frontCount).toBeGreaterThan(small.field.frontCount)
    expect(big.pool.countOf('ember')).toBeGreaterThan(small.pool.countOf('ember'))
  })

  it('throws nothing while the sheet has not mounted', () => {
    // The locator answers null until there is a drawn surface to ask about.
    const { pool } = burning(2, { locate: () => null })
    expect(pool.count).toBe(0)
  })

  it('survives a delta no caller should have passed it', () => {
    // It is public API, and a tab coming back from the background hands out
    // deltas of minutes. The emission loop runs once per whole unit of debt,
    // so an unbounded delta is a frozen page — and an infinite one never left
    // the loop at all. The assertion is really that this test RETURNS.
    const field = new DamageField({ seed: 3 })
    const pool = new ParticlePool(500, 4)
    const emitter = new FireEmitter(field, pool, flat)
    field.ignite(0.5, 0.5, 0.08, 1)
    for (let i = 0; i < 90; i++) field.step(1 / 60)
    emitter.update(Number.POSITIVE_INFINITY)
    emitter.update(3600)
    emitter.update(Number.NaN)
    expect(pool.count).toBeLessThanOrEqual(pool.capacity)
  })

  it('spawns from the same cells given the same seed', () => {
    const positions = () => {
      const { pool } = burning(1.5)
      const a = {
        position: new Float32Array(pool.capacity * 3),
        color: new Float32Array(pool.capacity * 4),
        extra: new Float32Array(pool.capacity * 4),
      }
      const n = {
        position: new Float32Array(pool.capacity * 3),
        color: new Float32Array(pool.capacity * 4),
        extra: new Float32Array(pool.capacity * 4),
      }
      pool.write(a, n)
      return Array.from(a.position)
    }
    expect(positions()).toEqual(positions())
  })
})
