import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ClothSim } from './cloth'
import { idleNames, idlePresets } from './idle'
import { paperConfigSchema, physicsNames, physicsSchema } from '../config/schema'
import { wave } from '../deformers/wave'
import { stackIsAnimated } from '../deformers/registry'
import { hang } from '../behaviors/hang'
import { fly } from '../behaviors/fly'
import { fall } from '../behaviors/fall'

const params = { stiffness: 0.8, gravity: 1, wind: 0, floor: -10 }

function makeSim(
  pins: Parameters<typeof ClothSim.prototype.grabNearest> extends never
    ? never
    : ConstructorParameters<typeof ClothSim>[4] = 'top-edge',
) {
  return new ClothSim(8, 10, 1, 1.4, pins, { ...params })
}

function runSeconds(sim: ClothSim, seconds: number) {
  const dt = 1 / 60
  for (let i = 0; i < Math.round(seconds / dt); i++) sim.step(dt)
}

describe('ClothSim', () => {
  it('unpinned cloth falls under gravity', () => {
    const sim = makeSim('none')
    const beforeY = sim.positions[1]!
    runSeconds(sim, 0.5)
    expect(sim.positions[1]!).toBeLessThan(beforeY - 0.1)
  })

  it('pinned particles hold their rest position exactly', () => {
    const sim = makeSim('top-edge')
    runSeconds(sim, 1)
    // Top row: y stays at +h/2, x keeps its grid position.
    for (let c = 0; c < sim.cols; c++) {
      expect(sim.positions[c * 3 + 1]).toBeCloseTo(0.7, 6)
      expect(sim.positions[c * 3 + 2]).toBeCloseTo(0, 6)
    }
    // While the bottom row has dropped below its rest y.
    const bottomStart = (sim.count - sim.cols) * 3
    expect(sim.positions[bottomStart + 1]!).toBeLessThan(-0.7)
  })

  it('springs keep the sheet from stretching apart', () => {
    const sim = makeSim('top-edge')
    runSeconds(sim, 2)
    // Neighbor distance in the top rows stays near rest length (some sag stretch allowed).
    const rest = 1.4 / 9
    const a = 0
    const b = sim.cols // directly below a
    const dx = sim.positions[a * 3]! - sim.positions[b * 3]!
    const dy = sim.positions[a * 3 + 1]! - sim.positions[b * 3 + 1]!
    const dz = sim.positions[a * 3 + 2]! - sim.positions[b * 3 + 2]!
    expect(Math.hypot(dx, dy, dz)).toBeLessThan(rest * 1.3)
  })

  it('settles onto the floor and eventually sleeps (wind = 0)', () => {
    const sim = new ClothSim(6, 6, 1, 1, 'none', { ...params, floor: -0.8 })
    runSeconds(sim, 6)
    expect(sim.asleep).toBe(true)
    for (let i = 0; i < sim.count; i++) {
      expect(sim.positions[i * 3 + 1]!).toBeGreaterThanOrEqual(-0.8 - 1e-6)
    }
  })

  it('wind keeps the sheet awake and pushes it out of plane', () => {
    const sim = new ClothSim(6, 6, 1, 1, 'top-edge', { ...params, wind: 0.6 })
    runSeconds(sim, 2)
    expect(sim.asleep).toBe(false)
    let maxZ = 0
    for (let i = 0; i < sim.count; i++) maxZ = Math.max(maxZ, Math.abs(sim.positions[i * 3 + 2]!))
    expect(maxZ).toBeGreaterThan(0.05)
  })

  it('grabbed particles follow the pointer and wake a sleeping sheet', () => {
    const sim = new ClothSim(6, 6, 1, 1, 'none', { ...params, floor: -0.8 })
    runSeconds(sim, 6)
    expect(sim.asleep).toBe(true)
    const idx = sim.grabNearest(0, -0.8, 0)
    sim.moveGrab(0.3, 0.5, 0.2)
    expect(sim.asleep).toBe(false)
    sim.step(1 / 60)
    expect(sim.positions[idx * 3]).toBeCloseTo(0.3, 6)
    expect(sim.positions[idx * 3 + 1]).toBeCloseTo(0.5, 6)
    sim.release()
  })
})

describe('idle presets', () => {
  it('names stay in sync with the physics schema', () => {
    expect([...physicsNames]).toEqual(['none', ...idleNames])
  })

  it('transforms are bounded and deterministic', () => {
    for (const name of idleNames) {
      const preset = idlePresets[name]
      if (!preset.transform) continue
      const pose = {
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
      }
      preset.transform(1.7, pose)
      const again = {
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
      }
      preset.transform(1.7, again)
      expect(pose).toEqual(again)
      for (const v of [...pose.position, ...pose.rotation]) expect(Math.abs(v)).toBeLessThan(1)
    }
  })

  it('stack-based idles produce animated stacks', () => {
    expect(stackIsAnimated(idlePresets.breeze.stack!())).toBe(true)
    expect(stackIsAnimated(idlePresets.taped.stack!())).toBe(true)
  })
})

describe('wave deformer', () => {
  const o = { amplitude: 0.05, wavelength: 0.5, speed: 1, angle: 90, pinnedEdge: 'none' } as const
  const sheet = { width: 1, height: 1.4 }

  it('time moves the ripple', () => {
    const uv = new THREE.Vector2(0.5, 0.5)
    const a = new THREE.Vector3(0, 0.2, 0)
    const b = new THREE.Vector3(0, 0.2, 0)
    wave.displace(a, uv, o, { t: 0, sheet })
    wave.displace(b, uv, o, { t: 0.3, sheet })
    expect(a.z).not.toBeCloseTo(b.z, 4)
  })

  it('a pinned edge stays still', () => {
    const top = new THREE.Vector3(0, 0.7, 0)
    wave.displace(top, new THREE.Vector2(0.5, 1), { ...o, pinnedEdge: 'top' }, { t: 1, sheet })
    expect(top.z).toBe(0)
  })
})

describe('physics schema', () => {
  it("accepts the shorthand 'cloth' and expands defaults", () => {
    const parsed = physicsSchema.parse('cloth')
    expect(parsed).toMatchObject({ type: 'cloth', pins: 'top-edge', stiffness: 0.8 })
  })

  it('enforces cloth ⊕ behavior exclusivity', () => {
    expect(() =>
      paperConfigSchema.parse({
        behavior: { type: 'peel' },
        physics: { type: 'cloth' },
      }),
    ).toThrow(/exclusive/)
    // Idle presets compose with behaviors just fine.
    expect(() => paperConfigSchema.parse({ behavior: { type: 'fly' }, physics: 'tumble' })).not.toThrow()
  })
})

describe('hang / fly / fall stacks', () => {
  const sheet = { width: 1, height: 1.4 }

  it('hang: wind drives the ripple amplitude, sag the bend', () => {
    const calm = hang.stack({ wind: 0, sag: 0.5 }, sheet)
    const windy = hang.stack({ wind: 1, sag: 0.5 }, sheet)
    expect((calm[1]!.options as { amplitude: number }).amplitude).toBe(0)
    expect((windy[1]!.options as { amplitude: number }).amplitude).toBeGreaterThan(0.04)
    expect(calm[1]!.options).toMatchObject({ pinnedEdge: 'top' })
  })

  it('fly and fall expand to animated stacks', () => {
    expect(stackIsAnimated(fly.stack(fly.defaults, sheet))).toBe(true)
    expect(stackIsAnimated(fall.stack(fall.defaults, sheet))).toBe(true)
  })
})
