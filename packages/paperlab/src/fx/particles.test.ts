import { describe, expect, it } from 'vitest'
import { ParticlePool, particlePresets, type ParticleTarget } from './particles'

/**
 * The pool: a fixed ceiling, presets that behave differently, and the same
 * seed making the same fire.
 *
 * The ceiling is the part worth testing hardest. It is the whole reason the
 * pool exists — a phone running a camera, a tracker and a cloth simulation
 * cannot absorb an unbounded number of embers — so "never more than capacity"
 * and "a full pool still takes new particles" are both claims, and the second
 * is the one a naive implementation gets wrong by dropping the newest.
 */

function target(capacity: number): ParticleTarget {
  return {
    position: new Float32Array(capacity * 3),
    color: new Float32Array(capacity * 4),
    extra: new Float32Array(capacity * 4),
  }
}

/** Mean height of everything in the pool, through `write`. */
function meanY(pool: ParticlePool): number {
  const a = target(pool.capacity)
  const n = target(pool.capacity)
  const counts = pool.write(a, n)
  let sum = 0
  for (let i = 0; i < counts.additive; i++) sum += a.position[i * 3 + 1]!
  for (let i = 0; i < counts.normal; i++) sum += n.position[i * 3 + 1]!
  return sum / Math.max(1, counts.additive + counts.normal)
}

const step = (pool: ParticlePool, seconds: number, dt = 1 / 60) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) pool.step(dt)
}

describe('the particle pool', () => {
  it('never holds more than its capacity, however hard it is asked', () => {
    const pool = new ParticlePool(50)
    for (let i = 0; i < 500; i++) pool.spawn('ember', 0, 0, 0)
    expect(pool.count).toBe(50)
  })

  it('gives a full pool to the newest particle, taking the most-spent slot', () => {
    // The one that matters: dropping the new spawn instead would starve a
    // burn of embers as soon as the room filled with old smoke.
    const pool = new ParticlePool(4)
    for (let i = 0; i < 4; i++) pool.spawn('smoke', 0, 0, 0)
    step(pool, 1.5)
    expect(pool.countOf('smoke')).toBe(4)
    pool.spawn('ember', 5, 5, 5)
    expect(pool.count).toBe(4)
    expect(pool.countOf('ember')).toBe(1)
    expect(pool.countOf('smoke')).toBe(3)
  })

  it('lets particles die, and the pool empties', () => {
    const pool = new ParticlePool(20)
    for (let i = 0; i < 20; i++) pool.spawn('ember', 0, 0, 0)
    expect(pool.count).toBe(20)
    // Past the longest an ember lives.
    step(pool, particlePresets.ember.life[1] + 0.1)
    expect(pool.count).toBe(0)
  })

  it('sends embers up and ash down', () => {
    // Hot air carries a spark; ash is heavier than the air it was lifted by,
    // which is what makes a burn shed rather than sparkle.
    const embers = new ParticlePool(80, 3)
    const ash = new ParticlePool(80, 3)
    for (let i = 0; i < 80; i++) {
      embers.spawn('ember', 0, 0, 0)
      ash.spawn('ash', 0, 0, 0)
    }
    step(embers, 0.4)
    step(ash, 2)
    expect(meanY(embers)).toBeGreaterThan(0.02)
    expect(meanY(ash)).toBeLessThan(0)
  })

  it('lets the wind carry smoke', () => {
    const still = new ParticlePool(40, 5)
    const blown = new ParticlePool(40, 5)
    for (let i = 0; i < 40; i++) {
      still.spawn('smoke', 0, 0, 0)
      blown.spawn('smoke', 0, 0, 0)
    }
    blown.wind[0] = 1.5
    step(still, 1)
    step(blown, 1)
    const meanX = (pool: ParticlePool) => {
      const a = target(pool.capacity)
      const n = target(pool.capacity)
      const counts = pool.write(a, n)
      let sum = 0
      for (let i = 0; i < counts.normal; i++) sum += n.position[i * 3]!
      return sum / Math.max(1, counts.normal)
    }
    expect(meanX(blown)).toBeGreaterThan(0.5)
    expect(Math.abs(meanX(still))).toBeLessThan(0.1)
  })

  it('splits the draw by blend mode: light adds, matter covers', () => {
    const pool = new ParticlePool(30)
    pool.spawn('ember', 0, 0, 0)
    pool.spawn('ember', 0, 0, 0)
    pool.spawn('smoke', 0, 0, 0)
    pool.spawn('ash', 0, 0, 0)
    const a = target(30)
    const n = target(30)
    expect(pool.write(a, n)).toEqual({ additive: 2, normal: 2 })
  })

  it('fades a particle in, then out, and sizes it over its life', () => {
    const pool = new ParticlePool(4)
    pool.spawn('smoke', 0, 0, 0)
    const a = target(4)
    const n = target(4)
    // At birth: fading in, so not yet at full opacity.
    pool.write(a, n)
    const born = n.color[3]!
    const size = n.extra[0]!
    expect(born).toBeLessThan(particlePresets.smoke.alpha[0])
    step(pool, 1)
    pool.write(a, n)
    const risen = n.color[3]!
    expect(risen).toBeGreaterThan(born)
    // Smoke grows as it rises.
    expect(n.extra[0]!).toBeGreaterThan(size)
    // And thins from there rather than snapping out. Measured as a decline
    // and not against a number: how long this particle lives was drawn at
    // birth, so no fixed moment is a known fraction of its life.
    step(pool, 0.6)
    pool.write(a, n)
    expect(n.color[3]!).toBeLessThan(risen)
  })

  it('makes the same fire from the same seed', () => {
    const run = () => {
      const pool = new ParticlePool(40, 11)
      for (let i = 0; i < 12; i++) {
        pool.spawn('ember', 0.1, 0.2, 0.3)
        step(pool, 0.05)
      }
      const a = target(40)
      const n = target(40)
      pool.write(a, n)
      return Array.from(a.position)
    }
    expect(run()).toEqual(run())
  })

  it('empties on demand — a fresh sheet has nothing in the air', () => {
    const pool = new ParticlePool(10)
    for (let i = 0; i < 10; i++) pool.spawn('ash', 0, 0, 0)
    pool.clear()
    expect(pool.count).toBe(0)
  })

  it('is safe at zero capacity', () => {
    // The low tier could in principle be turned all the way down, and a pool
    // that threw on spawn would take the whole page with it.
    const pool = new ParticlePool(0)
    pool.spawn('ember', 0, 0, 0)
    pool.step(1 / 60)
    expect(pool.count).toBe(0)
  })
})
