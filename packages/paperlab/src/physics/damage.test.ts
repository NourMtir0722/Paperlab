import { describe, expect, it, vi } from 'vitest'
import { DamageField } from '../fx/field'
import { DAMAGE_CHANNELS, type DamageSource } from '../surface/damageContract'
import { ClothSim, type ClothParams } from './cloth'
import { DamageCoupling } from './damage'

/**
 * Fire → physics: what burnt paper does that a picture of burnt paper does not.
 *
 * Every test here drives the real `ClothSim` through the coupling the sheet
 * runs, and measures positions — the levers were already pinned to DO
 * something by `cloth-coupling.test.ts`; this pins that damage reaches them,
 * the right way round, and that no damage reaches them not at all.
 */

vi.setConfig({ testTimeout: 30_000 })

const SIZE = 64
const still: ClothParams = { stiffness: 0.8, gravity: 1, wind: 0, floor: -10 }

/** A hand-made source, every texel pristine. `paint` writes a UV band of one channel. */
function source(): DamageSource & { paint(channel: number, v0: number, v1: number, value: number): void } {
  const pixels = new Uint8Array(SIZE * SIZE * 4)
  for (let i = 0; i < SIZE * SIZE; i++) pixels[i * 4 + DAMAGE_CHANNELS.presence] = 255
  const src = {
    size: SIZE,
    pixels,
    version: 0,
    paint(channel: number, v0: number, v1: number, value: number) {
      for (let y = 0; y < SIZE; y++) {
        const v = y / (SIZE - 1)
        if (v < v0 || v > v1) continue
        for (let x = 0; x < SIZE; x++) pixels[(y * SIZE + x) * 4 + channel] = value
      }
      src.version++
    },
  }
  return src
}

/** Step a sim with its coupling the way `PaperMesh` does: read, step, follow. */
function run(
  sim: ClothSim,
  coupling: DamageCoupling | null,
  src: DamageSource | null,
  seconds: number,
  dt = 1 / 60,
) {
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    coupling?.update(src)
    sim.step(dt)
    if (!sim.asleep) coupling?.follow()
  }
}

const at = (sim: ClothSim, r: number, c: number, axis: number) =>
  sim.positions[(r * sim.cols + c) * 3 + axis]!

/**
 * A burn front climbing from the bottom edge to `to` over `seconds`, the way a
 * real one arrives: soft-edged and moving, with char rising behind it and
 * never falling. The coupling reads each frame, as the sheet does.
 */
function burnUp(src: DamageSource, sim: ClothSim, coupling: DamageCoupling, to: number, seconds: number) {
  const frames = Math.round(seconds * 60)
  for (let f = 1; f <= frames; f++) {
    const front = (to * f) / frames
    for (let y = 0; y < SIZE; y++) {
      const s = Math.min(1, Math.max(0, (y / (SIZE - 1) - front + 0.04) / 0.08))
      const char = Math.round(230 * (1 - s * s * (3 - 2 * s)))
      for (let x = 0; x < SIZE; x++) {
        const i = (y * SIZE + x) * 4 + DAMAGE_CHANNELS.char
        if (char > src.pixels[i]!) src.pixels[i] = char
      }
    }
    ;(src as { version: number }).version++
    coupling.update(src)
    sim.step(1 / 60)
    if (!sim.asleep) coupling.follow()
  }
}

describe('damage → cloth', () => {
  it('leaves an undamaged sheet exactly as it was, float for float', () => {
    // A burn that has not started must not be a different simulation. Wind, a
    // pin, a grab that moves and lets go, uneven frames — and the pristine
    // field is the real one, not a fixture.
    const params = { ...still, wind: 1.1 }
    const plain = new ClothSim(12, 14, 1, 1.4, 'top-corners', params)
    const coupled = new ClothSim(12, 14, 1, 1.4, 'top-corners', params)
    const coupling = new DamageCoupling(coupled)
    const field = new DamageField()
    const frames = [1 / 60, 1 / 30, 1 / 144, 1 / 50]
    for (let i = 0; i < 240; i++) {
      if (i === 30) {
        plain.grab(150)
        coupled.grab(150)
      }
      if (i > 30 && i < 90) {
        plain.moveGrab(0.2, -0.3, 0.1 + i * 0.004)
        coupled.moveGrab(0.2, -0.3, 0.1 + i * 0.004)
      }
      if (i === 90) {
        plain.release()
        coupled.release()
      }
      const dt = frames[i % frames.length]!
      field.step(dt)
      coupling.update(field)
      plain.step(dt)
      coupled.step(dt)
      if (!coupled.asleep) coupling.follow()
    }
    const differ = Array.from(plain.positions).filter((x, i) => !Object.is(x, coupled.positions[i])).length
    expect(differ).toBe(0)
  })

  it('shrinks charred paper', () => {
    const src = source()
    src.paint(DAMAGE_CHANNELS.char, 0, 1, 255)
    const sim = new ClothSim(10, 10, 1, 1, 'none', { ...still, gravity: 0 })
    const control = new ClothSim(10, 10, 1, 1, 'none', { ...still, gravity: 0 })
    run(sim, new DamageCoupling(sim), src, 1)
    run(control, null, null, 1)
    const width = (s: ClothSim) => at(s, 5, s.cols - 1, 0) - at(s, 5, 0, 0)
    expect(width(sim)).toBeLessThan(width(control) * 0.93)
  })

  it('rolls a burnt edge toward the FRONT like a scroll, and it stays rolled', () => {
    // A front climbs a third of the way up a hanging sheet and stops.
    const src = source()
    const sim = new ClothSim(14, 16, 1, 1.4, 'top-edge', still)
    const coupling = new DamageCoupling(sim)
    burnUp(src, sim, coupling, 0.35, 2)
    // Long after: the front has stopped, the char has not gone anywhere.
    run(sim, coupling, src, 6)
    const bottom = sim.rows - 1
    const mid = sim.cols >> 1
    // Toward +z — the face a flat sheet turns to the camera, where the flame
    // is — and the WHOLE edge, middle as well as corners. Curled every way at
    // once it made a saddle instead, corners forward and middle back.
    expect(at(sim, bottom, 0, 2)).toBeGreaterThan(0.05)
    expect(at(sim, bottom, mid, 2)).toBeGreaterThan(0.05)
    expect(at(sim, bottom, sim.cols - 1, 2)).toBeGreaterThan(0.05)

    // And an untouched sheet under the same gravity does not curl at all.
    const control = new ClothSim(14, 16, 1, 1.4, 'top-edge', still)
    run(control, null, null, 2)
    expect(Math.abs(at(control, bottom, mid, 2))).toBeLessThan(1e-6)
  })

  it('curls a sheet without moving it: a charred sheet in still air goes nowhere', () => {
    // The curl is a bend, not a push. A push toward the front would have sent
    // a charred sheet off across the room like a sail.
    const src = source()
    const sim = new ClothSim(12, 12, 1, 1, 'none', { ...still, gravity: 0 })
    const coupling = new DamageCoupling(sim)
    burnUp(src, sim, coupling, 1, 2)
    run(sim, coupling, src, 2)
    let z = 0
    let spread = 0
    for (let i = 0; i < sim.count; i++) z += sim.positions[i * 3 + 2]!
    const mean = z / sim.count
    for (let i = 0; i < sim.count; i++) spread = Math.max(spread, Math.abs(sim.positions[i * 3 + 2]! - mean))
    // It DID curl: the sheet is no longer flat.
    expect(spread).toBeGreaterThan(0.05)
    // And it stayed where it was. Not to the last digit — the air resists a
    // curling sheet unevenly once its faces stop pointing the same way — but
    // a push strong enough to curl it would have carried it metres.
    expect(Math.abs(mean)).toBeLessThan(spread * 0.1)
  })

  it('lets the paper below a burnt-through band fall, and drags no streak down after it', () => {
    // The real field: a band burnt clean across the sheet, two cells deep.
    const field = new DamageField()
    for (let v = 0.44; v <= 0.58; v += 0.01) field.cut(0, v, 1, v, 0.03)
    const sim = new ClothSim(12, 14, 1, 1.4, 'top-edge', still)
    const control = new ClothSim(12, 14, 1, 1.4, 'top-edge', still)
    const coupling = new DamageCoupling(sim)
    run(sim, coupling, field, 1)
    run(control, null, null, 1)
    const bottom = sim.rows - 1
    // Burnt-through paper holds nothing up.
    expect(at(sim, bottom, 5, 1)).toBeLessThan(at(control, bottom, 5, 1) - 0.5)

    // Every gone particle beside the fallen piece went WITH it: none is left
    // more than a cell and a half from the live paper it borders.
    const cell = 1.4 / (sim.rows - 1)
    const presence = (r: number, c: number) =>
      field.sample(c / (sim.cols - 1), 1 - r / (sim.rows - 1))[DAMAGE_CHANNELS.presence]
    let checked = 0
    for (let r = 0; r < sim.rows - 1; r++) {
      for (let c = 0; c < sim.cols; c++) {
        if (!(presence(r, c) < 0.5 && presence(r + 1, c) >= 0.5)) continue
        const dy = at(sim, r, c, 1) - at(sim, r + 1, c, 1)
        expect(Math.abs(dy)).toBeLessThan(cell * 1.5)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('does not split a sheet along a cut narrower than a cell — the stated limit', () => {
    // One thin cut between two rows of particles: the picture separates, the
    // paper does not, because separating it would stretch the row of
    // triangles across the cut into streaks. Pinned so that it stays a
    // decision rather than becoming an accident.
    const field = new DamageField()
    // v = 0.5 is halfway between rows 6 and 7 of a 14-row sheet (v = 7/13, 6/13).
    field.cut(0, 0.5, 1, 0.5, 0.015)
    const sim = new ClothSim(12, 14, 1, 1.4, 'top-edge', still)
    const coupling = new DamageCoupling(sim)
    coupling.update(field)
    expect(Array.from(sim.broken).every((b) => b === 0)).toBe(true)
  })

  it('makes wet paper heavier, and no paper at all massless', () => {
    const src = source()
    src.paint(DAMAGE_CHANNELS.saturation, 0, 0.5, 255)
    src.paint(DAMAGE_CHANNELS.presence, 0.9, 1, 0)
    const sim = new ClothSim(8, 8, 1, 1, 'none', still)
    new DamageCoupling(sim).update(src)
    expect(sim.invMass[7 * 8 + 3]).toBeCloseTo(1 / 3) // bottom row: soaked
    expect(sim.invMass[3 * 8 + 3]).toBe(1) // middle: dry
    expect(sim.invMass[3]).toBe(0) // top row: gone
  })

  it('will not let a hand hold paper that is not there', () => {
    const src = source()
    src.paint(DAMAGE_CHANNELS.presence, 0.4, 0.6, 0)
    const sim = new ClothSim(12, 12, 1, 1, 'none', still)
    new DamageCoupling(sim).update(src)
    const middle = 6 * 12 + 6
    expect(sim.invMass[middle]).toBe(0)
    sim.grab(middle)
    expect(sim.grabWeightAt(middle)).toBe(0)
  })

  it('reads only when the source changes, and hands every lever back when it goes', () => {
    const src = source()
    const sim = new ClothSim(8, 8, 1, 1, 'none', still)
    const coupling = new DamageCoupling(sim)
    expect(coupling.update(src)).toBe(true)
    expect(coupling.update(src)).toBe(false)
    src.paint(DAMAGE_CHANNELS.char, 0, 1, 255)
    src.paint(DAMAGE_CHANNELS.presence, 0, 0.2, 0)
    src.paint(DAMAGE_CHANNELS.heat, 0, 1, 255)
    expect(coupling.update(src)).toBe(true)
    expect(Array.from(sim.broken).some((b) => b === 1)).toBe(true)
    expect(coupling.update(null)).toBe(true)
    expect(Array.from(sim.invMass).every((m) => m === 1)).toBe(true)
    expect(Array.from(sim.restBend).every((b) => b === 0)).toBe(true)
    expect(Array.from(sim.broken).every((b) => b === 0)).toBe(true)
    expect(Array.from(sim.restLength)).toEqual(Array.from(sim.naturalLength))
  })
})
