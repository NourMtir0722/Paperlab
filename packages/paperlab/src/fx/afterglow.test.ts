import { describe, expect, it } from 'vitest'
import { Afterglow } from './afterglow'
import { DamageField, FIXED_DT, HEAT, PRESENCE } from './field'

/** A burn that caught, and was then cooled off completely — a blown-out fire. */
function blownOut() {
  const field = new DamageField()
  const glow = new Afterglow(field)
  for (let t = 0; t < 1.8; t += FIXED_DT) {
    if (t < 1.6) field.ignite(0.5, 0.32, 0.055, 5 * Math.min(1, (t + FIXED_DT) / 0.35) * FIXED_DT)
    field.step(FIXED_DT)
    glow.step(FIXED_DT)
  }
  for (let t = 0; t < 1; t += FIXED_DT) {
    field.paint(HEAT, 0.5, 0.45, 0.85, -3.5 * FIXED_DT, 0.35)
    field.step(FIXED_DT)
    glow.step(FIXED_DT)
  }
  return { field, glow }
}

const heatBytes = (pixels: Uint8Array) => {
  let n = 0
  for (let i = HEAT; i < pixels.length; i += 4) if (pixels[i]! > 2) n++
  return n
}

describe('the afterglow', () => {
  it('is the field, exactly, on a sheet nothing has happened to', () => {
    const field = new DamageField()
    const glow = new Afterglow(field)
    glow.step(FIXED_DT)
    expect(Array.from(glow.pixels)).toEqual(Array.from(field.pixels))
  })

  it('keeps an edge glowing after the field has gone cold, and lets it go bead by bead', () => {
    const { field, glow } = blownOut()
    expect(heatBytes(field.pixels)).toBe(0)
    const lit: number[] = []
    for (let t = 0; t < 9; t += FIXED_DT) {
      field.step(FIXED_DT)
      glow.step(FIXED_DT)
      if (Math.abs((t % 1) - 0) < FIXED_DT / 2) lit.push(heatBytes(glow.pixels))
    }
    // Glowing a second on, fewer later, none at the end — one by one, not at once.
    expect(lit[1]).toBeGreaterThan(0)
    expect(lit.some((n, k) => k > 1 && n > 0 && n < lit[1]!)).toBe(true)
    expect(lit[lit.length - 1]).toBe(0)
  })

  it('passes char and presence through untouched — the physics reads those', () => {
    const { field, glow } = blownOut()
    for (let i = 0; i < field.pixels.length; i += 4) {
      expect(glow.pixels[i]).toBe(field.pixels[i])
      expect(glow.pixels[i + PRESENCE]).toBe(field.pixels[i + PRESENCE])
    }
  })

  it('goes out the same way twice', () => {
    const a = blownOut()
    const b = blownOut()
    for (let t = 0; t < 3; t += FIXED_DT) {
      a.field.step(FIXED_DT)
      a.glow.step(FIXED_DT)
      b.field.step(FIXED_DT)
      b.glow.step(FIXED_DT)
    }
    expect(Array.from(b.glow.pixels)).toEqual(Array.from(a.glow.pixels))
  })

  it('flares on a breath', () => {
    const calm = blownOut()
    const blown = blownOut()
    for (let t = 0; t < 0.4; t += FIXED_DT) {
      calm.glow.step(FIXED_DT)
      blown.glow.step(FIXED_DT, 1)
    }
    let a = 0
    let b = 0
    for (let i = HEAT; i < calm.glow.pixels.length; i += 4) {
      a += calm.glow.pixels[i]!
      b += blown.glow.pixels[i]!
    }
    expect(b).toBeGreaterThan(a)
  })
})
