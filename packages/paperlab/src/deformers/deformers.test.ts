import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { roll, rollRadius, windAngle, windRadius } from './roll'
import { curl } from './curl'
import { bend } from './bend'
import { applyDeformerStack, displacePoint, stackMinSegments } from './compose'
import type { DeformerContext } from './types'
import { createSheetGeometry } from '../core/sheet'
import { sheetSchema } from '../config/schema'

/**
 * Golden-vector tests: exact expected outputs for known inputs. When the GLSL
 * implementations land (field mode), the same vectors run against the GPU
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
  const o = { angle: 90, boundary: 0, radius: 0.2, thickness: 0 }

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

  it('winds inward: successive wraps sit exactly `thickness` apart', () => {
    // THE regression this file exists for. Every wrap used to be a circle
    // tangent to the plane at the boundary, so all of them passed through
    // that one point and the sheet intersected itself once per turn — and
    // because the error cancelled exactly at multiples of 2π, the old
    // "full turn returns to the boundary" vector below passed anyway.
    const thickness = 0.004
    const k = thickness / (2 * Math.PI)
    const wrapped = { ...o, thickness }
    let previous: number | null = null
    for (let turn = 1; turn <= 4; turn++) {
      const theta = turn * 2 * Math.PI
      const arc = o.radius * theta - (k * theta * theta) / 2
      const out = displaceWith(roll, [0, arc, 0], wrapped)
      expect(out.y).toBeCloseTo(0, 6)
      // Toward the core by one layer per turn, never back onto the boundary.
      expect(out.z).toBeCloseTo(turn * thickness, 6)
      if (previous !== null) expect(out.z - previous).toBeCloseTo(thickness, 6)
      previous = out.z
    }
  })

  it('preserves arc length once wound, not just on the first turn', () => {
    // The old code advanced the angle by `s / radius` using the BASE radius
    // while placing the point at a different one, so content stretched as
    // the wrap went on. Sample deep into the roll, not near the boundary.
    const wrapped = { ...o, thickness: 0.004 }
    for (const s of [0.05, 0.3, 0.9]) {
      const a = displaceWith(roll, [0, s, 0], wrapped)
      const b = displaceWith(roll, [0, s + 0.001, 0], wrapped)
      expect(a.distanceTo(b)).toBeCloseTo(0.001, 6)
    }
  })

  it('thickness 0 is exactly the old cylinder', () => {
    // The whole fix has to be invisible at thickness 0, which is what lets
    // every golden vector above stand unchanged.
    for (const s of [0.1, 0.2 * Math.PI, 0.2 * Math.PI * 2, 0.9]) {
      const out = displaceWith(roll, [0, s, 0], o)
      const theta = s / 0.2
      expect(out.y).toBeCloseTo(0.2 * Math.sin(theta), 9)
      expect(out.z).toBeCloseTo(0.2 * (1 - Math.cos(theta)), 9)
    }
  })

  it('windAngle degrades to s/r0 as thickness vanishes', () => {
    expect(windAngle(0.3, 0.17, 0)).toBeCloseTo(0.3 / 0.17, 12)
    // Rationalized form: no catastrophic cancellation at a tiny k.
    expect(windAngle(0.3, 0.17, 1e-12)).toBeCloseTo(0.3 / 0.17, 9)
  })

  it('over-winding coils at a floor radius instead of collapsing to a point', () => {
    // A spiral run to zero radius puts every remaining vertex on one point:
    // degenerate triangles and an unlit hole. `roll` is public and its
    // options are independent numbers, so this has to stay drawable.
    const r0 = 0.05
    const k = 0.01
    for (const s of [1, 100, 1e6]) {
      const theta = windAngle(s, r0, k)
      expect(Number.isFinite(theta)).toBe(true)
      expect(windRadius(theta, r0, k)).toBeGreaterThan(0)
    }
    // Far past the floor the radius sits exactly on it, not below.
    expect(windRadius(windAngle(1e6, r0, k), r0, k)).toBeCloseTo(r0 * 0.08, 12)
  })

  it('rollRadius is the exact inverse of the wind: the roll ends on its core', () => {
    // Size a roll for a given length of paper and the innermost wrap lands
    // on the core — this identity is what makes the roll shrink truthfully.
    const core = 0.03
    const thickness = 0.006
    const k = thickness / (2 * Math.PI)
    for (const length of [0.3, 1.0, 2.6]) {
      const r0 = rollRadius(length, core, thickness)
      const inner = r0 - k * windAngle(length, r0, k)
      expect(inner).toBeCloseTo(core, 9)
    }
  })

  it('rollRadius shrinks monotonically as paper leaves the roll', () => {
    const radii = [2.6, 2.0, 1.0, 0.3, 0].map((l) => rollRadius(l, 0.03, 0.006))
    for (let i = 1; i < radii.length; i++) expect(radii[i]!).toBeLessThan(radii[i - 1]!)
    expect(radii.at(-1)).toBeCloseTo(0.03, 12)
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

  /**
   * The gentle end used to be where the GLSL twin fell apart: `r(1 − cos θ)`
   * and `r·sin θ − d` are both differences of nearly-equal large numbers as
   * curvature → 0, and float32 has nothing left after the subtraction. These
   * pin the limit the cancellation-free form has to reproduce — a shallow arc
   * is a parabola, z → d²·k/2, and the in-plane pull-in is third order.
   */
  it('approaches the parabola z = d²·k/2 for a shallow arc', () => {
    const d = 0.45
    for (const curvature of [0.35, 0.1, 0.02]) {
      const out = displaceWith(bend, [d, 0, 0], { curvature, angle: 0 })
      // Relative, not absolute: at 0.02 the whole arc is 2e-3 tall, and the
      // gap from the parabola is the (tiny) fourth-order term.
      expect(out.z / ((d * d * curvature) / 2)).toBeCloseTo(1, 2)
      expect(Math.abs(out.x)).toBeLessThan(d)
      // Shallower arc, less lift — monotone, and never the wrong sign.
      expect(out.z).toBeGreaterThan(0)
    }
  })

  it('has no kink where the series hands over to the exact form at |θ| = 1', () => {
    // The branch is an implementation detail and must not be visible in the
    // surface: a step or a crease here would shade as a ring. Probe the
    // second difference straight through the crossover — smooth is ~h², a
    // discontinuity would show up whole.
    const k = 1.2
    const h = 1e-4
    const curl = (d: number, axis: 'x' | 'z') => {
      const at = (x: number) => displaceWith(bend, [x, 0, 0], { curvature: k, angle: 0 })[axis]
      return Math.abs(at(d - h) + at(d + h) - 2 * at(d))
    }
    for (const axis of ['z', 'x'] as const) {
      // A second difference is never zero — it is the real curvature, ~f''h².
      // What matters is that the crossover is not an OUTLIER against the same
      // measurement taken well inside each branch.
      const atCrossover = curl(1 / k, axis)
      const inSeries = curl(0.7 / k, axis)
      const inExact = curl(1.4 / k, axis)
      const ordinary = Math.max(inSeries, inExact)
      expect(atCrossover).toBeLessThan(ordinary * 3)
    }
  })
})

describe('compose', () => {
  const bendFirst = [
    { type: 'bend', options: { curvature: 1, angle: 0 } },
    { type: 'roll', options: { angle: 90, boundary: 0, radius: 0.2, thickness: 0 } },
  ]

  it('order matters: bend→roll differs from roll→bend', () => {
    const probe: [number, number, number] = [0.3, 0.4, 0]
    const ab = displacePoint(new THREE.Vector3(...probe), 0.8, 0.9, bendFirst, ctx)
    const ba = displacePoint(new THREE.Vector3(...probe), 0.8, 0.9, [...bendFirst].reverse(), ctx)
    expect(ab.distanceTo(ba)).toBeGreaterThan(1e-3)
  })

  it('skips disabled instances', () => {
    const stack = [
      { type: 'roll', options: { angle: 90, boundary: 0, radius: 0.2, thickness: 0 }, enabled: false },
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

  it('stackMinSegments takes the densest requirement, on the axis that asks', () => {
    const sheet = { width: 1, height: 1.4 }
    // bend across x wants 16 and roll up y wants 48 — and they want them in
    // different DIRECTIONS, so neither pays for the other's floor. The old
    // answer was a single 48 spent on both axes.
    const [x, y] = stackMinSegments(bendFirst, sheet)
    expect(Math.round(x)).toBe(16)
    expect(Math.round(y)).toBe(48)

    // A bend asks nothing of the axis it does not bend.
    const bendOnly = stackMinSegments([{ type: 'bend', options: { curvature: 0.6, angle: 0 } }], sheet)
    expect(Math.round(bendOnly[0])).toBe(16)
    expect(bendOnly[1]).toBe(2)

    // An instance carrying no options cannot say which way it bends, so the
    // floor is spread over both axes rather than dropped on one of them.
    const unresolved = stackMinSegments([{ type: 'bend', options: {} }], sheet)
    expect(Math.min(...unresolved)).toBeGreaterThan(2)
  })
})
