import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { roll } from './roll'
import { curl } from './curl'
import { bend } from './bend'
import { applyDeformerStack, displacePoint, stackMinSegments } from './compose'
import type { DeformerContext } from './types'
import { createSheetGeometry } from '../core/sheet'
import { sheetSchema } from '../config/schema'

/**
 * Golden-vector tests: exact expected outputs for known inputs. When the GLSL
 * implementations land (M4, field mode), the same vectors run against the GPU
 * path with epsilon comparison — that parity gate is what makes dual
 * implementation maintainable.
 */

const ctx: DeformerContext = { t: 0, sheet: { width: 1, height: 1 } }
const uv = new THREE.Vector2(0.5, 0.5)

function displaceWith<O>(
  deformer: { displace(out: THREE.Vector3, uv: THREE.Vector2, o: O, ctx: DeformerContext): void },
  point: [number, number, number],
  options: O,
  context = ctx,
): THREE.Vector3 {
  const out = new THREE.Vector3(...point)
  deformer.displace(out, uv, options, context)
  return out
}

describe('roll', () => {
  const o = { angle: 90, boundary: 0, radius: 0.2, spiral: 0 }

  it('leaves the flat region untouched', () => {
    const out = displaceWith(roll, [0.3, -0.4, 0], o)
    expect(out.toArray()).toEqual([0.3, -0.4, 0])
  })

  it('golden vector: quarter turn (θ = π/2)', () => {
    // s = 0.2·π/2 → wraps to the top of the cylinder: d = r, z = r.
    const s = 0.2 * (Math.PI / 2)
    const out = displaceWith(roll, [0.1, s, 0], o)
    expect(out.x).toBeCloseTo(0.1, 6) // perpendicular axis untouched
    expect(out.y).toBeCloseTo(0.2, 6)
    expect(out.z).toBeCloseTo(0.2, 6)
  })

  it('golden vector: full turn returns to the boundary (θ = 2π)', () => {
    const s = 0.2 * Math.PI * 2
    const out = displaceWith(roll, [0, s, 0], o)
    expect(out.y).toBeCloseTo(0, 6)
    expect(out.z).toBeCloseTo(0, 6)
  })

  it('is C0-continuous at the boundary', () => {
    const eps = 1e-5
    const inside = displaceWith(roll, [0, -eps, 0], o)
    const outside = displaceWith(roll, [0, eps, 0], o)
    expect(inside.distanceTo(outside)).toBeLessThan(1e-3)
  })

  it('preserves arc length (content never stretches)', () => {
    const a = displaceWith(roll, [0, 0.3, 0], o)
    const b = displaceWith(roll, [0, 0.301, 0], o)
    expect(a.distanceTo(b)).toBeCloseTo(0.001, 4)
  })

  it('offsets incoming z along the rolled surface normal', () => {
    // At θ = π/2 the surface normal points along -d: a +z offset moves the
    // point backward along y, not up.
    const s = 0.2 * (Math.PI / 2)
    const out = displaceWith(roll, [0, s, 0.05], o)
    expect(out.y).toBeCloseTo(0.2 - 0.05, 6)
    expect(out.z).toBeCloseTo(0.2, 6)
  })

  it('spiral grows the radius as the wrap advances', () => {
    // At θ = π the point sits atop the cylinder: z = 2·r(θ). With spiral,
    // r(π) = radius + spiral·π, so the layer rides higher than without.
    const s = 0.2 * Math.PI
    const flatSpiral = displaceWith(roll, [0, s, 0], o)
    const withSpiral = displaceWith(roll, [0, s, 0], { ...o, spiral: 0.02 })
    expect(flatSpiral.z).toBeCloseTo(0.4, 6)
    expect(withSpiral.z).toBeCloseTo(2 * (0.2 + 0.02 * Math.PI), 6)
  })
})

describe('curl', () => {
  const o = { corner: 'bottom-right', amount: 0.5, radius: 0.16, skew: 0 } as const

  it('is the identity at amount 0', () => {
    const zero = { ...o, amount: 0 }
    for (const p of [
      [0.5, -0.5, 0],
      [0, 0, 0],
      [-0.5, 0.5, 0],
    ] as const) {
      const out = displaceWith(curl, [...p], zero)
      expect(out.toArray()).toEqual([...p])
    }
  })

  it('lifts the target corner, monotonically with amount', () => {
    let last = -1
    for (const amount of [0.1, 0.2, 0.3]) {
      const out = displaceWith(curl, [0.5, -0.5, 0], { ...o, amount })
      expect(out.z).toBeGreaterThan(0)
      expect(out.z).toBeGreaterThan(last)
      last = out.z
    }
  })

  it('leaves the far half of the sheet flat at moderate amounts', () => {
    const out = displaceWith(curl, [-0.5, 0.5, 0], o)
    expect(out.toArray()).toEqual([-0.5, 0.5, 0])
  })

  it('respects the corner choice', () => {
    const tl = displaceWith(curl, [-0.5, 0.5, 0], { ...o, corner: 'top-left' })
    expect(tl.z).toBeGreaterThan(0)
    const untouched = displaceWith(curl, [0.5, -0.5, 0], { ...o, corner: 'top-left' })
    expect(untouched.z).toBe(0)
  })
})

describe('bend', () => {
  it('is the identity at curvature ~0', () => {
    const out = displaceWith(bend, [0.4, 0.2, 0], { curvature: 0, angle: 0 })
    expect(out.toArray()).toEqual([0.4, 0.2, 0])
  })

  it('arcs symmetrically about the center', () => {
    const o = { curvature: 1.2, angle: 0 }
    const left = displaceWith(bend, [-0.4, 0, 0], o)
    const right = displaceWith(bend, [0.4, 0, 0], o)
    expect(left.z).toBeCloseTo(right.z, 6)
    expect(left.x).toBeCloseTo(-right.x, 6)
    expect(left.z).toBeGreaterThan(0)
  })

  it('flips direction with the curvature sign', () => {
    const up = displaceWith(bend, [0.4, 0, 0], { curvature: 1, angle: 0 })
    const down = displaceWith(bend, [0.4, 0, 0], { curvature: -1, angle: 0 })
    expect(up.z).toBeGreaterThan(0)
    expect(down.z).toBeLessThan(0)
  })
})

describe('compose', () => {
  const bendFirst = [
    { type: 'bend', options: { curvature: 1, angle: 0 } },
    { type: 'roll', options: { angle: 90, boundary: 0, radius: 0.2, spiral: 0 } },
  ]

  it('order matters: bend→roll differs from roll→bend', () => {
    const probe: [number, number, number] = [0.3, 0.4, 0]
    const ab = displacePoint(new THREE.Vector3(...probe), 0.8, 0.9, bendFirst, ctx)
    const ba = displacePoint(new THREE.Vector3(...probe), 0.8, 0.9, [...bendFirst].reverse(), ctx)
    expect(ab.distanceTo(ba)).toBeGreaterThan(1e-3)
  })

  it('skips disabled instances', () => {
    const stack = [
      { type: 'roll', options: { angle: 90, boundary: 0, radius: 0.2, spiral: 0 }, enabled: false },
    ]
    const out = displacePoint(new THREE.Vector3(0, 0.4, 0), 0.5, 0.9, stack, ctx)
    expect(out.toArray()).toEqual([0, 0.4, 0])
  })

  it('applyDeformerStack matches displacePoint per vertex and recomputes normals', () => {
    const sheet = sheetSchema.parse({ width: 1, height: 1, segments: 8 })
    const geometry = createSheetGeometry(sheet)
    const base = Float32Array.from(geometry.attributes.position!.array as Float32Array)
    applyDeformerStack(geometry, base, bendFirst, ctx)

    const pos = geometry.attributes.position as THREE.BufferAttribute
    const uvAttr = geometry.attributes.uv as THREE.BufferAttribute
    const v = 40 // arbitrary interior vertex
    const expected = displacePoint(
      new THREE.Vector3(base[v * 3]!, base[v * 3 + 1]!, base[v * 3 + 2]!),
      uvAttr.getX(v),
      uvAttr.getY(v),
      bendFirst,
      ctx,
    )
    expect(pos.getX(v)).toBeCloseTo(expected.x, 6)
    expect(pos.getY(v)).toBeCloseTo(expected.y, 6)
    expect(pos.getZ(v)).toBeCloseTo(expected.z, 6)

    const normal = geometry.attributes.normal as THREE.BufferAttribute
    // Deformed sheet normals are no longer uniformly +z.
    let maxTilt = 0
    for (let i = 0; i < normal.count; i++) maxTilt = Math.max(maxTilt, Math.abs(normal.getX(i)))
    expect(maxTilt).toBeGreaterThan(0.01)
  })

  it('stackMinSegments takes the densest requirement', () => {
    expect(stackMinSegments(bendFirst)).toBe(48) // roll wants 48, bend 16
    expect(stackMinSegments([{ type: 'bend', options: {} }])).toBe(16)
  })
})
