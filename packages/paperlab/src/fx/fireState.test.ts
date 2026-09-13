import { describe, expect, it } from 'vitest'
import { DamageField, FIXED_DT } from './field'
import { FIRE_CLUSTERS, FireState, fireStateOf } from './fireState'
import { flameAnchors, flamePuff, type FlameAnchor } from './flames'

/** A flat sheet, upright, one unit across — `<Paper>`'s default. */
const upright = (u: number, v: number) => ({ x: u - 0.5, y: (v - 0.5) * 1.4, z: 0 })

function burning(seconds = 2.2, field = new DamageField()): DamageField {
  for (let t = 0; t < seconds; t += FIXED_DT) {
    if (t < 1.6) field.ignite(0.5, 0.32, 0.055, 5 * Math.min(1, (t + FIXED_DT) / 0.35) * FIXED_DT)
    field.step(FIXED_DT)
  }
  return field
}

describe('the fire, measured once a frame', () => {
  it('is nothing on a sheet that is not burning', () => {
    const fire = new FireState(new DamageField(), upright).update(0)
    expect(fire.count).toBe(0)
    expect(fire.clusterCount).toBe(0)
    expect([fire.x, fire.y, fire.z, fire.height, fire.flicker]).toEqual([0, 0, 0, 0, 0])
  })

  it('is exactly what the fire light used to work out for itself', () => {
    // FxFireLight moved onto this, and the light it gives off must not move
    // with it: the same 32 flames, the same means, to the last bit.
    const field = burning()
    const fire = new FireState(field, upright).update(0)
    const out: FlameAnchor[] = []
    const n = flameAnchors(field, upright, 32, out)
    let x = 0
    let y = 0
    let z = 0
    let h = 0
    let flicker = 0
    for (let i = 0; i < n; i++) {
      const f = out[i]!
      x += f.x
      y += f.y
      z += f.z
      h += f.height
      flicker += flamePuff(f.seed, field.time)
    }
    expect(n).toBeGreaterThan(0)
    expect(fire.count).toBe(n)
    expect(fire.x).toBe(x / n)
    expect(fire.y).toBe(y / n)
    expect(fire.z).toBe(z / n)
    expect(fire.height).toBe(h / n)
    expect(fire.flicker).toBe(flicker / n)
  })

  it('works a frame out once, and the next frame afresh', () => {
    const field = burning(1.2)
    const fire = new FireState(field, upright).update(1)
    const before = fire.y
    // The burn moves on; asked again in the SAME frame it has not.
    burning(0.8, field)
    expect(fire.update(1).y).toBe(before)
    expect(fire.update(2).y).not.toBe(before)
  })

  it('gathers every flame into at most four clusters, the same way every time', () => {
    const a = new FireState(burning(), upright).update(0)
    const b = new FireState(burning(), upright).update(0)
    expect(a.clusterCount).toBeGreaterThan(0)
    expect(a.clusterCount).toBeLessThanOrEqual(FIRE_CLUSTERS)
    let held = 0
    for (const c of a.clusters.slice(0, a.clusterCount)) {
      held += c.count
      expect(c.height).toBeLessThanOrEqual(c.tallest)
      expect(Number.isFinite(c.x + c.y + c.z)).toBe(true)
    }
    expect(held).toBe(a.count)
    expect(b.clusters.slice(0, b.clusterCount)).toEqual(a.clusters.slice(0, a.clusterCount))
  })

  it('is one object per field and locator, so every reader shares a frame', () => {
    const field = new DamageField()
    const other = (u: number, v: number) => upright(u, v)
    expect(fireStateOf(field, upright)).toBe(fireStateOf(field, upright))
    expect(fireStateOf(field, other)).not.toBe(fireStateOf(field, upright))
  })
})
