import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { getBehavior, listBehaviors } from '../behaviors/registry'
import { displacePoint, stackAutoSegments, stackMinSegments } from '../deformers/compose'
import { getDeformer, listDeformers } from '../deformers/registry'
import type { DeformerInstance, SheetDims } from '../deformers/types'
import { resolveSegments } from './sheet'
import {
  AUTO_CEILING,
  FLAT_SEGMENTS,
  LEGACY_FLAT_SEGMENTS,
  quantizeSegments,
  SAG_TOL,
  segmentsForArc,
  segmentsForSine,
  spanAlong,
} from './tessellation'

const SHEET = { width: 1, height: 1.4 }

/** What `'auto'` handed out flat before it adapted — the baseline every
 *  "is this worse than it was?" question is asked against. */
const LEGACY_FLAT = LEGACY_FLAT_SEGMENTS

describe('quantizeSegments', () => {
  it('snaps up to the next ladder step, never down', () => {
    expect(quantizeSegments(1)).toBe(FLAT_SEGMENTS)
    expect(quantizeSegments(FLAT_SEGMENTS)).toBe(FLAT_SEGMENTS)
    expect(quantizeSegments(13)).toBe(16)
    expect(quantizeSegments(25)).toBe(32)
    expect(quantizeSegments(65)).toBe(LEGACY_FLAT)
    expect(quantizeSegments(100)).toBe(128)
    expect(quantizeSegments(130)).toBe(AUTO_CEILING)
  })

  it('clamps at the ceiling rather than growing without bound', () => {
    expect(quantizeSegments(400)).toBe(AUTO_CEILING)
    expect(quantizeSegments(Number.POSITIVE_INFINITY)).toBe(AUTO_CEILING)
  })

  it('is monotonic — a tighter request never resolves to a coarser grid', () => {
    let previous = 0
    for (let n = 0; n <= 200; n++) {
      const q = quantizeSegments(n)
      expect(q).toBeGreaterThanOrEqual(previous)
      previous = q
    }
  })
})

describe('spanAlong', () => {
  it('reads the sheet extent along the axis, not the diagonal', () => {
    expect(spanAlong(SHEET, 0)).toBeCloseTo(1, 10)
    expect(spanAlong(SHEET, 90)).toBeCloseTo(1.4, 10)
    // A rectangle's extent along 45° is the sum of the half-extents' projections.
    expect(spanAlong(SHEET, 45)).toBeCloseTo((1 + 1.4) * Math.SQRT1_2, 10)
  })

  it('is sign- and wrap-agnostic, because bend angles are not', () => {
    expect(spanAlong(SHEET, -90)).toBeCloseTo(spanAlong(SHEET, 90), 10)
    expect(spanAlong(SHEET, 270)).toBeCloseTo(spanAlong(SHEET, 90), 10)
  })
})

describe('segmentsFor* return 0 for a shape with no curvature', () => {
  it('a flat arc asks for nothing', () => {
    expect(segmentsForArc(1.4, Number.POSITIVE_INFINITY)).toBe(0)
    expect(segmentsForArc(1.4, 0)).toBe(0)
    expect(segmentsForArc(0, 0.1)).toBe(0)
  })

  it('a wave with no amplitude asks for nothing', () => {
    expect(segmentsForSine(1.4, 0, 0.5)).toBe(0)
    expect(segmentsForSine(1.4, 0.04, 0)).toBe(0)
  })

  it('halving the radius asks for √2 more, as the sagitta form requires', () => {
    const coarse = segmentsForArc(1.4, 0.2)
    const tight = segmentsForArc(1.4, 0.1)
    expect(tight / coarse).toBeCloseTo(Math.SQRT2, 6)
  })
})

/**
 * The one that matters: does the grid `'auto'` picks actually hold the surface?
 *
 * Sagitta is measured directly rather than trusted. For every edge of the
 * resolved grid, the deformed midpoint of the chord is compared against the
 * deformer's own answer at that midpoint — which is exactly the gap between
 * the polygon and the surface it stands in for. If `autoSegments` under-asks,
 * this is the number that grows.
 *
 * The bound is `SAG_TOL` with headroom, because `h²/8r` is the small-angle
 * form and the real sagitta runs slightly above it as the chord opens up.
 */
function maxSagitta(stack: DeformerInstance[], sheet: SheetDims, segments: [number, number]): number {
  const [sx, sy] = segments
  const ctx = { sheet, t: 0 } as never
  const at = (u: number, v: number) => {
    const p = new THREE.Vector3((u - 0.5) * sheet.width, (v - 0.5) * sheet.height, 0)
    return displacePoint(p, u, v, stack, ctx).clone()
  }

  let worst = 0
  const mid = new THREE.Vector3()
  for (let iy = 0; iy <= sy; iy++) {
    for (let ix = 0; ix <= sx; ix++) {
      const u = ix / sx
      const v = iy / sy
      // Both grid directions: a deformer angled across the sheet is held by
      // whichever axis runs along its curvature, and we do not know which.
      if (ix < sx) {
        const a = at(u, v)
        const b = at((ix + 1) / sx, v)
        const trueMid = at((u + (ix + 1) / sx) / 2, v)
        worst = Math.max(worst, mid.copy(a).add(b).multiplyScalar(0.5).distanceTo(trueMid))
      }
      if (iy < sy) {
        const a = at(u, v)
        const b = at(u, (iy + 1) / sy)
        const trueMid = at(u, (v + (iy + 1) / sy) / 2)
        worst = Math.max(worst, mid.copy(a).add(b).multiplyScalar(0.5).distanceTo(trueMid))
      }
    }
  }
  return worst
}

const AS_SHEET = { ...SHEET, segments: 'auto', thickness: 0.2, cornerRadius: 0 } as const

/**
 * Grid `'auto'` resolves to for a single deformer carrying these options —
 * through the same two helpers the renderers use, so what is measured here is
 * the grid a sheet actually gets, projection included. Reading
 * `autoSegments` directly instead would test the arithmetic and skip the part
 * that turns it into a grid, which is where the axes are decided.
 */
function autoGridFor(type: string, options: Record<string, unknown>): [number, number] {
  const stack = [{ type, options }]
  return resolveSegments(AS_SHEET, stackMinSegments(stack, SHEET), stackAutoSegments(stack, SHEET))
}

/** The grid the old flat-72 `'auto'` would have produced for the same sheet. */
function legacyGridFor(type: string): [number, number] {
  return resolveSegments(AS_SHEET, getDeformer(type).geometry?.minSegments ?? 2, LEGACY_FLAT)
}

describe("the grid 'auto' picks holds the surface", () => {
  // Swept across each deformer's real range, including both ends, because the
  // whole point of making this parametric is that the ends disagree.
  const CASES: [string, Record<string, unknown>[]][] = [
    [
      'bend',
      [
        { curvature: 0.05, angle: 0 },
        { curvature: 0.35, angle: 0 }, // photo-print, the field starter
        { curvature: 0.6, angle: 0 }, // the default
        { curvature: 4, angle: 0 }, // the schema's tightest
        { curvature: 2, angle: 37 }, // off-axis, so spanAlong has to be right
      ],
    ],
    [
      'roll',
      [
        { angle: 90, boundary: 0, radius: 0.12, spiral: 0.015 },
        { angle: 90, boundary: 0, radius: 0.5, spiral: 0.015 },
        { angle: 0, boundary: 0.2, radius: 0.3, spiral: 0 },
      ],
    ],
    [
      'curl',
      [
        { corner: 'bottom-right', amount: 0.35, radius: 0.16, skew: 0 },
        { corner: 'top-left', amount: 0.8, radius: 0.5, skew: 12 },
      ],
    ],
    [
      'fold',
      [
        { angle: 90, offset: 0, foldAngle: 90, radius: 0.04 },
        { angle: 0, offset: 0.1, foldAngle: 180, radius: 0.2 },
      ],
    ],
    [
      'wave',
      [
        { amplitude: 0.04, wavelength: 0.5, speed: 0, angle: 90, pinnedEdge: 'none' },
        { amplitude: 0.3, wavelength: 0.5, speed: 0, angle: 90, pinnedEdge: 'none' },
        { amplitude: 0.1, wavelength: 2, speed: 0, angle: 0, pinnedEdge: 'top' },
      ],
    ],
    [
      'drape',
      [
        {
          amplitude: 0.12,
          folds: 4,
          falloff: 1.6,
          irregular: 0.45,
          gather: 0.5,
          pinnedEdge: 'top',
        },
        {
          amplitude: 0.3,
          folds: 2,
          falloff: 1,
          irregular: 0,
          gather: 0,
          pinnedEdge: 'top',
        },
      ],
    ],
  ]

  for (const [type, optionSets] of CASES) {
    for (const options of optionSets) {
      it(`${type} ${JSON.stringify(options)}`, () => {
        const stack = [{ type, options }]
        const sag = maxSagitta(stack, SHEET, autoGridFor(type, options))
        const legacy = maxSagitta(stack, SHEET, legacyGridFor(type))
        // Two ways to pass, and the second one is the point.
        //
        // Either the grid holds the surface within tolerance (headroom over
        // `h²/8r`, which is the small-angle form and runs under the truth as
        // the chord opens up) — or it is no worse than the flat 72 it
        // replaced, which is the actual promise this change makes.
        //
        // The second clause is not slack. `fold`, `wave` and `drape` ask for
        // more than the ceiling at their tighter settings (127, 165, …), so
        // they are pinned at 72 and carry exactly the sagitta they have
        // always carried. That is a real and known gap in the library —
        // but it predates this change, and a test that
        // failed on it would be reporting the ceiling, not a regression.
        expect(sag).toBeLessThan(Math.max(SAG_TOL * 3, legacy * 1.05))
      })
    }
  }

  it('under-tessellating is caught — the measure has teeth', () => {
    // Same tight bend the sweep passes, forced onto the coarsest grid the
    // ladder can produce. If this does NOT blow the bound, the check above
    // is vacuous.
    const stack = [{ type: 'bend', options: { curvature: 4, angle: 0 } }]
    const sag = maxSagitta(stack, SHEET, [FLAT_SEGMENTS, FLAT_SEGMENTS])
    const legacy = maxSagitta(stack, SHEET, legacyGridFor('bend'))
    expect(sag).toBeGreaterThan(Math.max(SAG_TOL * 3, legacy * 1.05))
  })
})

describe("'auto' stays inside its budget", () => {
  it('no deformer at its defaults resolves above the ceiling', () => {
    for (const id of listDeformers()) {
      const deformer = getDeformer(id)
      const options = deformer.defaults as Record<string, unknown>
      const [sx, sy] = autoGridFor(id, options)
      expect(Math.max(sx, sy)).toBeLessThanOrEqual(AUTO_CEILING)
    }
  })
})

describe('the progress sweep samples the right range', () => {
  it("every behavior's progressParam is a 0..1 number", () => {
    // PaperMesh and fieldGroup size the grid by sampling this parameter from
    // 0 to 1. A behavior whose progress ran 0..100 or -1..1 would be sampled
    // across a sliver of its range and quietly under-tessellated, with
    // nothing else in the suite to notice.
    for (const id of listBehaviors()) {
      const behavior = getBehavior(id)
      const param = behavior.progressParam
      const withProgress = (value: number) =>
        behavior.optionsSchema.parse({ ...(behavior.defaults as object), [param]: value }) as Record<
          string,
          number
        >
      // Both ends accepted...
      expect(withProgress(0)[param], `${id}.${param} rejects 0`).toBe(0)
      expect(withProgress(1)[param], `${id}.${param} rejects 1`).toBe(1)
      // ...and nothing beyond them, which is what makes 0..1 the whole range
      // rather than merely a valid slice of a wider one.
      expect(() => withProgress(1.5), `${id}.${param} accepts > 1`).toThrow()
      expect(() => withProgress(-0.5), `${id}.${param} accepts < 0`).toThrow()
    }
  })
})
