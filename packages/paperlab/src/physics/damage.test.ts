import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
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

  /**
   * A cut exactly one particle row deep, so every gone particle on it borders
   * BOTH pieces. Averaged between them — as it used to be — each one was
   * dragged down the gap after the falling piece, and both burnt edges with it.
   */
  it('cuts a piece loose along a burn one row deep, and each rim particle leaves with ONE side', () => {
    const field = new DamageField()
    // Row 6 of 14 is at v = 1 − 6/13; rows 5 and 7 are a cell either side.
    const v = 1 - 6 / 13
    field.cut(0, v, 1, v, 0.03)
    const sim = new ClothSim(12, 14, 1, 1.4, 'top-edge', still)
    const control = new ClothSim(12, 14, 1, 1.4, 'top-edge', still)
    const coupling = new DamageCoupling(sim)
    run(sim, coupling, field, 1)
    run(control, null, null, 1)
    // The cut really is one row: the rows either side are paper.
    expect(sim.invMass[6 * 12 + 5]).toBe(0)
    expect(sim.invMass[5 * 12 + 5]).toBe(1)
    expect(sim.invMass[7 * 12 + 5]).toBe(1)
    // The piece below fell away; the sheet above stayed where it hangs.
    expect(at(sim, 13, 5, 1)).toBeLessThan(at(control, 13, 5, 1) - 0.5)
    expect(Math.abs(at(sim, 5, 5, 1) - at(control, 5, 5, 1))).toBeLessThan(0.02)
    // And every particle on the cut is beside one side of it, not strung
    // across the gap between them.
    const cell = 1.4 / 13
    const apart = (r: number, c: number) =>
      Math.hypot(
        at(sim, 6, c, 0) - at(sim, r, c, 0),
        at(sim, 6, c, 1) - at(sim, r, c, 1),
        at(sim, 6, c, 2) - at(sim, r, c, 2),
      )
    for (let c = 0; c < sim.cols; c++) expect(Math.min(apart(5, c), apart(7, c))).toBeLessThan(cell * 1.5)
  })

  it('hides the triangles left across the gap as the piece falls — and no triangle of paper', () => {
    const field = new DamageField()
    for (let v = 0.44; v <= 0.58; v += 0.01) field.cut(0, v, 1, v, 0.03)
    const sim = new ClothSim(12, 14, 1, 1.4, 'top-edge', still)
    const coupling = new DamageCoupling(sim)
    const index = new THREE.PlaneGeometry(1, 1.4, 11, 13).index!.array as Uint16Array
    const built = index.slice()
    let changed = false
    for (let f = 0; f < 60; f++) {
      coupling.update(field)
      sim.step(1 / 60)
      if (sim.asleep) continue
      coupling.follow()
      changed = coupling.tear(index) || changed
    }
    expect(changed).toBe(true)
    const cellX = 1 / 11
    const cellY = 1.4 / 13
    const edge = (i: number, j: number) => {
      const rest = Math.hypot(((i % 12) - (j % 12)) * cellX, (((i / 12) | 0) - ((j / 12) | 0)) * cellY)
      const now = Math.hypot(
        sim.positions[i * 3]! - sim.positions[j * 3]!,
        sim.positions[i * 3 + 1]! - sim.positions[j * 3 + 1]!,
        sim.positions[i * 3 + 2]! - sim.positions[j * 3 + 2]!,
      )
      return now / rest
    }
    let hidden = 0
    for (let t = 0; t < index.length / 3; t++) {
      const [a, b, c] = [built[t * 3]!, built[t * 3 + 1]!, built[t * 3 + 2]!]
      const burnt = [a, b, c].some((i) => sim.invMass[i] === 0)
      if (index[t * 3] === index[t * 3 + 1] && index[t * 3 + 1] === index[t * 3 + 2]) {
        // Only ever a triangle with a burnt-away corner.
        expect(burnt).toBe(true)
        hidden++
        continue
      }
      // Paper is drawn exactly as built, and nothing still drawn is a streak.
      if (!burnt) expect([index[t * 3], index[t * 3 + 1], index[t * 3 + 2]]).toEqual([a, b, c])
      expect(Math.max(edge(a, b), edge(b, c), edge(c, a))).toBeLessThanOrEqual(1.5 + 1e-6)
    }
    expect(hidden).toBeGreaterThan(0)
  })

  it('tears nothing on a sheet still in one piece — its index stays exactly as built', () => {
    // A hole in the middle of a hanging sheet: the fire's usual case, and
    // what every burn looks like until it cuts something loose.
    const field = new DamageField()
    field.cut(0.3, 0.5, 0.7, 0.5, 0.08)
    const sim = new ClothSim(12, 14, 1, 1.4, 'top-edge', still)
    const coupling = new DamageCoupling(sim)
    const index = new THREE.PlaneGeometry(1, 1.4, 11, 13).index!.array as Uint16Array
    const built = Array.from(index)
    for (let f = 0; f < 120; f++) {
      coupling.update(field)
      sim.step(1 / 60)
      if (sim.asleep) continue
      coupling.follow()
      expect(coupling.tear(index)).toBe(false)
    }
    // There IS a hole — the paper in it left the solve — and still nothing tore.
    expect(Array.from(sim.invMass).some((m) => m === 0)).toBe(true)
    expect(Array.from(index)).toEqual(built)
  })

  it('starts the sheet over when its burn is rewound: fallen paper laid out again, the tear mended', () => {
    const src = source()
    src.paint(DAMAGE_CHANNELS.presence, 0.44, 0.58, 0)
    const sim = new ClothSim(12, 14, 1, 1.4, 'top-edge', still)
    const laidOut = Array.from(sim.positions)
    const coupling = new DamageCoupling(sim)
    const index = new THREE.PlaneGeometry(1, 1.4, 11, 13).index!.array as Uint16Array
    const built = Array.from(index)
    for (let f = 0; f < 60; f++) {
      coupling.update(src)
      sim.step(1 / 60)
      if (sim.asleep) continue
      coupling.follow()
      coupling.tear(index)
    }
    expect(Array.from(index)).not.toEqual(built)
    // Played back from before the cut: the paper is all there again. Solved
    // from the floor it would be hauled up through the sheet; it is laid out.
    src.paint(DAMAGE_CHANNELS.presence, 0, 1, 255)
    coupling.update(src)
    expect(Array.from(sim.positions)).toEqual(laidOut)
    expect(coupling.tear(index)).toBe(true)
    expect(Array.from(index)).toEqual(built)
  })

  it('starts over when a different source takes the sheet — even one with the same holes', () => {
    const first = source()
    first.paint(DAMAGE_CHANNELS.presence, 0.44, 0.58, 0)
    const sim = new ClothSim(12, 14, 1, 1.4, 'top-edge', still)
    const laidOut = Array.from(sim.positions)
    const coupling = new DamageCoupling(sim)
    run(sim, coupling, first, 1)
    expect(Array.from(sim.positions)).not.toEqual(laidOut)
    // Another sheet's burn with the very same cut. No paper comes back, so
    // only the source's identity says this is a different history.
    const second = source()
    second.paint(DAMAGE_CHANNELS.presence, 0.44, 0.58, 0)
    coupling.update(second)
    expect(Array.from(sim.positions)).toEqual(laidOut)
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
    // The pinch still catches the live paper around the hole — a hand holds a
    // patch, not a point — but nothing of the hole itself.
    expect(sim.grab(middle)).toBe(middle)
    expect(sim.grabWeightAt(middle)).toBe(0)

    // A hole wider than the patch is different: the pinch closes on nothing,
    // and has to say so rather than report a grab that can never move.
    const wide = source()
    wide.paint(DAMAGE_CHANNELS.presence, 0.2, 0.8, 0)
    const gone = new ClothSim(12, 12, 1, 1, 'none', still)
    new DamageCoupling(gone).update(wide)
    expect(gone.grab(middle)).toBe(-1)
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
