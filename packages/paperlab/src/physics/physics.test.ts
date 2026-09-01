import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ClothSim } from './cloth'
import { applyDeformerStack } from '../deformers/compose'
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

  it('lets cloth host a shape, because a deformer is a map from a point', () => {
    // The exclusivity that used to be here was the single biggest constraint
    // in the library: it kept every behavior but one out of reach of a sheet
    // that could be held. Cloth simulates the sheet's own grid, so a deformer
    // running over it means what it means anywhere else.
    expect(() =>
      paperConfigSchema.parse({
        behavior: { type: 'peel' },
        physics: { type: 'cloth' },
      }),
    ).not.toThrow()
    expect(() =>
      paperConfigSchema.parse({
        deformers: [{ type: 'fold', options: { angle: 90 } }],
        physics: { type: 'cloth', pins: 'top-corners' },
      }),
    ).not.toThrow()
  })

  it('still refuses a strip a shape, because its rows are chain nodes', () => {
    // A strip's uv runs along a length of paper that is partly wound on a
    // roll, so a fold placed by uv lands somewhere the sheet is not.
    expect(() =>
      paperConfigSchema.parse({
        behavior: { type: 'peel' },
        physics: { type: 'strip' },
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

describe('ClothSim.adopt', () => {
  /** A sheet dropped until it hangs, so there is a drape worth carrying. */
  function draped(width = 1, height = 1.4): ClothSim {
    const sim = new ClothSim(9, 9, width, height, 'top-corners', {
      stiffness: 0.8,
      gravity: 1,
      wind: 0,
      floor: -5,
    })
    for (let i = 0; i < 120; i++) sim.step(1 / 60)
    return sim
  }

  it('carries the drape across a resize instead of starting flat', () => {
    const before = draped()
    const middle = Math.floor(before.count / 2)
    const sagged = before.positions[middle * 3 + 2]!

    const after = new ClothSim(9, 9, 2, 2.8, 'top-corners', {
      stiffness: 0.8,
      gravity: 1,
      wind: 0,
      floor: -5,
    })
    // Flat until it adopts: this is exactly the snap the carry-over exists
    // to remove.
    expect(after.positions[middle * 3 + 2]!).toBe(0)
    expect(after.adopt(before)).toBe(true)
    expect(after.positions[middle * 3 + 2]!).toBeCloseTo(sagged * 2, 6)
  })

  it('scales the drape by how much the sheet grew', () => {
    const before = draped()
    const after = new ClothSim(9, 9, 0.5, 0.7, 'top-corners', {
      stiffness: 0.8,
      gravity: 1,
      wind: 0,
      floor: -5,
    })
    after.adopt(before)
    const free = 40
    expect(after.positions[free * 3]!).toBeCloseTo(before.positions[free * 3]! * 0.5, 6)
    expect(after.positions[free * 3 + 1]!).toBeCloseTo(before.positions[free * 3 + 1]! * 0.5, 6)
  })

  it('leaves the pins where the resized sheet says its corners are', () => {
    // A pin holds a CORNER. Carrying the old corner over would hang the new
    // sheet from a point that is no longer on it.
    const before = draped()
    const after = new ClothSim(9, 9, 2, 2.8, 'top-corners', {
      stiffness: 0.8,
      gravity: 1,
      wind: 0,
      floor: -5,
    })
    const corner = after.positions[0]!
    after.adopt(before)
    expect(after.positions[0]!).toBe(corner)
    expect(corner).toBeCloseTo(-1, 6)
  })

  it('carries velocity, so the sheet does not arrive perfectly still', () => {
    const before = draped()
    const moving = 40
    // Give it a push, so there is a velocity to lose.
    before.moveGrab(1, 1, 1)
    for (let i = 0; i < 3; i++) before.step(1 / 60)
    const speed =
      before.positions[moving * 3 + 2]! - (before as unknown as { prev: Float32Array }).prev[moving * 3 + 2]!

    const after = new ClothSim(9, 9, 2, 2.8, 'top-corners', {
      stiffness: 0.8,
      gravity: 1,
      wind: 0,
      floor: -5,
    })
    after.adopt(before)
    const carried =
      after.positions[moving * 3 + 2]! - (after as unknown as { prev: Float32Array }).prev[moving * 3 + 2]!
    expect(carried).toBeCloseTo(speed * 2, 6)
  })

  it('refuses a different grid, because the particles do not correspond', () => {
    const before = draped()
    const finer = new ClothSim(17, 17, 2, 2.8, 'top-corners', {
      stiffness: 0.8,
      gravity: 1,
      wind: 0,
      floor: -5,
    })
    expect(finer.adopt(before)).toBe(false)
  })

  it('carries across a rebuild that was not a resize at all', () => {
    // A shape arriving over the simulation rebuilds the mesh — the stack has
    // its own opinion about tessellation — without touching anything the
    // physics knows. Starting flat there would snap the sheet the instant you
    // tried to fold the one you were holding.
    const before = draped()
    const middle = Math.floor(before.count / 2)
    const same = new ClothSim(9, 9, 1, 1.4, 'top-corners', {
      stiffness: 0.8,
      gravity: 1,
      wind: 0,
      floor: -5,
    })
    expect(same.adopt(before)).toBe(true)
    expect(same.positions[middle * 3 + 2]!).toBeCloseTo(before.positions[middle * 3 + 2]!, 6)
  })

  it('re-pins to the new layout while the rest of the sheet stays where it was', () => {
    const before = draped()
    const free = 40
    const unpinned = new ClothSim(9, 9, 1, 1.4, 'none', {
      stiffness: 0.8,
      gravity: 1,
      wind: 0,
      floor: -5,
    })
    expect(unpinned.adopt(before)).toBe(true)
    // Nothing is pinned now, so the old corner comes across with everything
    // else and the sheet falls from where it was hanging.
    expect(unpinned.positions[free * 3 + 1]!).toBeCloseTo(before.positions[free * 3 + 1]!, 6)
  })

  it('has nothing to adopt from on the first build', () => {
    const first = new ClothSim(9, 9, 1, 1.4, 'top-corners', {
      stiffness: 0.8,
      gravity: 1,
      wind: 0,
      floor: -5,
    })
    expect(first.adopt(null)).toBe(false)
  })
})

describe('a shape over a simulation', () => {
  /**
   * The composition C1 opened up, at the level it actually happens: the
   * deformer stack takes the base array it is handed, so handing it the
   * simulation's live particles instead of the flat rest pose IS the feature.
   * `PaperMesh` is a React component and this is the part of it worth pinning
   * without a renderer.
   */
  const fold = [{ type: 'fold', options: { angle: 90, offset: 0, foldAngle: 90, radius: 0.04 } }]
  const ctx = { t: 0, sheet: { width: 1, height: 1.4 } }

  function grid(sim: ClothSim): THREE.BufferGeometry {
    const geometry = new THREE.PlaneGeometry(1, 1.4, sim.cols - 1, sim.rows - 1)
    return geometry
  }

  function draped(): ClothSim {
    const sim = new ClothSim(9, 9, 1, 1.4, 'top-corners', {
      stiffness: 0.8,
      gravity: 1,
      wind: 0.4,
      floor: -5,
    })
    for (let i = 0; i < 200; i++) sim.step(1 / 60)
    return sim
  }

  it('folds the sheet the sim is holding, not a flat one', () => {
    const sim = draped()
    const geometry = grid(sim)
    const flat = Float32Array.from(geometry.attributes.position!.array as Float32Array)

    applyDeformerStack(geometry, sim.positions, fold, ctx)
    const overSim = Float32Array.from(geometry.attributes.position!.array as Float32Array)

    applyDeformerStack(geometry, flat, fold, ctx)
    const overFlat = geometry.attributes.position!.array as Float32Array

    // It is not the drape (something folded it) and not the flat fold
    // (it folded the drape). Those two together are the whole claim.
    let fromSim = 0
    let fromFlat = 0
    for (let i = 0; i < overSim.length; i++) {
      fromSim = Math.max(fromSim, Math.abs(overSim[i]! - sim.positions[i]!))
      fromFlat = Math.max(fromFlat, Math.abs(overSim[i]! - overFlat[i]!))
    }
    expect(fromSim).toBeGreaterThan(0.05)
    expect(fromFlat).toBeGreaterThan(0.02)
  })

  it('leaves the simulation itself untouched — the stack is a pass, not a write', () => {
    // If the stack wrote back into the particles, the next substep would
    // solve constraints against a folded sheet and the fold would compound
    // into the physics until the paper tore itself apart.
    const sim = draped()
    const before = Float32Array.from(sim.positions)
    applyDeformerStack(grid(sim), sim.positions, fold, ctx)
    expect(Array.from(sim.positions)).toEqual(Array.from(before))
  })

  it('keeps vertex and particle indices in step, which is what lets a grab land', () => {
    const sim = draped()
    const geometry = grid(sim)
    applyDeformerStack(geometry, sim.positions, fold, ctx)
    expect(geometry.attributes.position!.count).toBe(sim.count)
  })
})
