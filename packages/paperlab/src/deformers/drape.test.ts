import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { drape, drapeOptionsSchema } from './drape'
import { resolveDeformerStack, listDeformers } from './registry'
import type { DeformerContext } from './types'

const ctx: DeformerContext = { t: 0, sheet: { width: 1.5, height: 8.5 } }
const options = (o: Record<string, unknown> = {}) => drapeOptionsSchema.parse(o)

/** Displace a point at a given uv and report where it lands. */
function at(u: number, v: number, o = options(), x = 0): THREE.Vector3 {
  const out = new THREE.Vector3(x, 0, 0)
  drape.displace(out, new THREE.Vector2(u, v), o, ctx)
  return out
}

describe('drape', () => {
  it('holds the pinned edge flat and deepens toward the free one', () => {
    const o = options()
    // uv.y = 1 is the top; pinned there, it must not move at all.
    expect(Math.abs(at(0.3, 1, o).z)).toBeLessThan(1e-9)
    const quarter = Math.abs(at(0.3, 0.75, o).z)
    const half = Math.abs(at(0.3, 0.5, o).z)
    const free = Math.abs(at(0.3, 0, o).z)
    expect(quarter).toBeLessThan(half)
    expect(half).toBeLessThan(free)
  })

  it('pins the other end when asked', () => {
    const o = options({ pinnedEdge: 'bottom' })
    expect(Math.abs(at(0.3, 0, o).z)).toBeLessThan(1e-9)
    expect(Math.abs(at(0.3, 1, o).z)).toBeGreaterThan(0)
  })

  it('folds run WITH the drop, not across it — that is the whole difference from wave', () => {
    const o = options()
    // Along a horizontal line the surface undulates…
    const across = [0, 0.1, 0.2, 0.3, 0.4].map((u) => at(u, 0.2, o).z)
    expect(Math.max(...across) - Math.min(...across)).toBeGreaterThan(0.05)
    // …while a vertical line down one fold never changes sign: the fold is a
    // continuous channel from top to bottom, not a series of kinks.
    const down = [0.1, 0.3, 0.5, 0.7, 0.9].map((v) => at(0.125, v, o).z)
    const signs = new Set(down.filter((z) => Math.abs(z) > 1e-9).map((z) => Math.sign(z)))
    expect(signs.size).toBe(1)
  })

  it('is not harmonic — a pure sine reads as corrugated metal', () => {
    const o = options({ irregular: 1, folds: 4 })
    // With a pure sine, samples exactly one fold apart would be identical.
    const a = at(0.1, 0, o).z
    const b = at(0.35, 0, o).z
    expect(Math.abs(a - b)).toBeGreaterThan(1e-3)
    // Turning irregularity off restores the exact repeat.
    const pure = options({ irregular: 0, folds: 4 })
    expect(at(0.1, 0, pure).z).toBeCloseTo(at(0.35, 0, pure).z, 6)
  })

  it('gathers: deep folds pull the surface toward its centerline', () => {
    const o = options({ gather: 1, amplitude: 0.4, folds: 6 })
    // A point out at the edge moves inward, and more so at the free end.
    const nearPin = at(1, 0.95, o, 0.75).x
    const nearFree = at(1, 0, o, 0.75).x
    expect(nearFree).toBeLessThan(nearPin)
    expect(nearFree).toBeGreaterThan(0)
    // The centerline itself has nothing to gather toward.
    expect(at(0.5, 0, o, 0).x).toBe(0)
  })

  it('gather 0 leaves the width alone', () => {
    expect(at(1, 0, options({ gather: 0 }), 0.75).x).toBeCloseTo(0.75, 9)
  })

  it('zero amplitude is a no-op, not a flat sheet with a pinch', () => {
    const out = at(0.3, 0, options({ amplitude: 0 }), 0.6)
    expect(out.z).toBe(0)
    expect(out.x).toBe(0.6)
  })

  it('ships a GLSL twin — a deformer without one cannot run in field mode', () => {
    expect(drape.glsl).toBeDefined()
    expect(drape.glsl!.strength).toBe('amplitude')
    expect(Object.keys(drape.glsl!.uniforms(options())).sort()).toEqual([
      'amplitude',
      'falloff',
      'folds',
      'gather',
      'irregular',
      'pin',
    ])
  })

  it('is registered, and is not time-driven', () => {
    expect(listDeformers()).toContain('drape')
    expect(drape.animated).toBeFalsy()
  })
})

describe('resolveDeformerStack', () => {
  it('fills defaults for whatever a hand-written preset left out', () => {
    const [entry] = resolveDeformerStack([{ type: 'drape', options: { folds: 7 } }])
    expect(entry!.options).toEqual({ ...drape.defaults, folds: 7 })
  })

  it('names the deformer and the slot when options are wrong', () => {
    expect(() => resolveDeformerStack([{ type: 'drape', options: { folds: 999 } }])).toThrow(
      /deformers\[0\] \("drape"\): folds/,
    )
  })

  it('catches the typo that used to reach the GLSL builder as undefined', () => {
    // `frequency` is not a wave option — `wavelength` is. Unchecked, it left
    // an undefined uniform and crashed with a message about `.length`.
    expect(() =>
      resolveDeformerStack([
        { type: 'drape', options: {} },
        { type: 'wave', options: { frequency: 2 } },
      ]),
    ).toThrow(/deformers\[1\] \("wave"\)/)
  })

  it('rejects an unknown deformer by name', () => {
    expect(() => resolveDeformerStack([{ type: 'nope', options: {} }])).toThrow(/Unknown deformer/)
  })

  it('keeps disabled entries in their slot — GLSL uniforms are indexed by position', () => {
    const stack = resolveDeformerStack([
      { type: 'drape', options: {}, enabled: false },
      { type: 'wave', options: {} },
    ])
    expect(stack).toHaveLength(2)
    expect(stack[0]!.enabled).toBe(false)
    expect(stack[1]!.type).toBe('wave')
  })
})
