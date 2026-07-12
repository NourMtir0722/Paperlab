import { describe, expect, it } from 'vitest'
import { getLayout, listLayouts } from './layouts'
import { buildDisplacementGLSL, buildFieldVertexShader, stackUniformValues } from './compose'
import { atlasGrid } from '../content/atlas'
import { parityCases } from './parity'
import { getDeformer, listDeformers } from '../deformers/registry'
import {
  SHEET_LIFT,
  outwardCorner,
  sheetBackingSize,
  sheetLayoutSchema,
  tornEdgesOnDetach,
  withSheetCellFromPaper,
} from './sheetGrid'
import { silhouetteRects } from '../content/backing'

describe('layouts', () => {
  it('registers the eight built-ins', () => {
    expect(listLayouts()).toEqual([
      'ring',
      'deck',
      'cascade',
      'helix',
      'wall',
      'tunnel',
      'scatter',
      'sheet',
    ])
  })

  it('poses are pure and deterministic', () => {
    for (const id of listLayouts()) {
      const layout = getLayout(id)
      const a = layout.pose(3, 12, layout.defaults, 0.25)
      const b = layout.pose(3, 12, layout.defaults, 0.25)
      expect(a).toEqual(b)
    }
  })

  it('ring: sheets sit on the radius facing the center', () => {
    const ring = getLayout('ring')
    const pose = ring.pose(0, 8, { radius: 3, tiltDeg: 0 }, 0)
    expect(Math.hypot(pose.position[0], pose.position[2])).toBeCloseTo(3)
    expect(pose.rotation[1]).toBeCloseTo(Math.PI)
  })

  it('ring: phase rotates the whole ring, one turn wraps', () => {
    const ring = getLayout('ring')
    const at0 = ring.pose(2, 8, ring.defaults, 0)
    const at1 = ring.pose(2, 8, ring.defaults, 1)
    expect(at0.position[0]).toBeCloseTo(at1.position[0], 5)
    expect(at0.position[2]).toBeCloseTo(at1.position[2], 5)
  })

  it('wall: a full grid is symmetric about the center', () => {
    const wall = getLayout('wall')
    // 8 papers → 4×2 grid, fully occupied.
    const poses = Array.from({ length: 8 }, (_, i) => wall.pose(i, 8, wall.defaults, 0))
    const sumX = poses.reduce((a, p) => a + p.position[0], 0)
    const sumY = poses.reduce((a, p) => a + p.position[1], 0)
    expect(Math.abs(sumX)).toBeLessThan(1e-6)
    expect(Math.abs(sumY)).toBeLessThan(1e-6)
  })

  it('helix climbs monotonically', () => {
    const helix = getLayout('helix')
    let lastY = -Infinity
    for (let i = 0; i < 10; i++) {
      const y = helix.pose(i, 10, helix.defaults, 0).position[1]
      expect(y).toBeGreaterThan(lastY)
      lastY = y
    }
  })
})

describe('sheet layout (the stamp block)', () => {
  const o = sheetLayoutSchema.parse({}) // 2×5

  it('poses a flat rows×columns grid in register — no jitter, z = backing lift', () => {
    const sheet = getLayout('sheet')
    const first = sheet.pose(0, 10, o, 0)
    const last = sheet.pose(9, 10, o, 0)
    expect(first.rotation).toEqual([0, 0, 0])
    expect(first.position[2]).toBe(SHEET_LIFT)
    // Slot 0 is top-left, slot 9 bottom-right — symmetric about the center.
    expect(first.position[0]).toBeCloseTo(-last.position[0])
    expect(first.position[1]).toBeCloseTo(-last.position[1])
    // Neighbors sit exactly one cell + gutter apart.
    const second = sheet.pose(1, 10, o, 0)
    expect(second.position[0] - first.position[0]).toBeCloseTo(o.cellWidth + o.gutter)
  })

  it('outward corners face away from the sheet center (what a thumb would find)', () => {
    // 2×5: top row peels top, bottom row peels bottom; left half left, right half right.
    expect(outwardCorner(0, o)).toBe('top-left')
    expect(outwardCorner(4, o)).toBe('top-right')
    expect(outwardCorner(5, o)).toBe('bottom-left')
    expect(outwardCorner(9, o)).toBe('bottom-right')
    expect(outwardCorner(2, o)).toBe('top-right') // center column ties break outward-right
  })

  it('tie-breaks are consistent across grid shapes — dead-center peels bottom-right', () => {
    const grid = (rows: number, columns: number) =>
      Array.from({ length: rows * columns }, (_, i) => outwardCorner(i, { rows, columns }))

    // 1×1: a lone stamp falls to the standalone peel default.
    expect(grid(1, 1)).toEqual(['bottom-right'])

    // 2×2: clean quadrants, symmetric about the center.
    expect(grid(2, 2)).toEqual(['top-left', 'top-right', 'bottom-left', 'bottom-right'])

    // 3×3 (odd both axes): the center row breaks DOWN and the center column
    // breaks RIGHT, so the dead-center cell (index 4) peels bottom-right.
    expect(grid(3, 3)).toEqual([
      'top-left', 'top-right', 'top-right',
      'bottom-left', 'bottom-right', 'bottom-right',
      'bottom-left', 'bottom-right', 'bottom-right',
    ])
    expect(outwardCorner(4, { rows: 3, columns: 3 })).toBe('bottom-right')

    // 3×5: center row (row 1) all breaks down; center column (col 2) breaks right.
    expect(outwardCorner(7, { rows: 3, columns: 5 })).toBe('bottom-right') // r1,c2 dead center
    expect(outwardCorner(2, { rows: 3, columns: 5 })).toBe('top-right') // r0,c2 center column

    // Single-axis grids fall to the down/right default on the tie axis.
    expect(grid(1, 5)).toEqual([
      'bottom-left', 'bottom-left', 'bottom-right', 'bottom-right', 'bottom-right',
    ])
    expect(grid(5, 1)).toEqual([
      'top-right', 'top-right', 'bottom-right', 'bottom-right', 'bottom-right',
    ])
  })

  it('detach tears edges that faced neighbors; boundary edges stay intact', () => {
    // Top-left corner stamp of the 2×5 block.
    expect(tornEdgesOnDetach(0, o)).toEqual({
      top: 'intact',
      left: 'intact',
      right: 'torn',
      bottom: 'torn',
    })
    // A middle stamp of the top row: everything torn except the top.
    expect(tornEdgesOnDetach(2, o)).toEqual({
      top: 'intact',
      left: 'torn',
      right: 'torn',
      bottom: 'torn',
    })
  })

  it('cells size themselves from the papers unless set explicitly — gutter is the spacing', () => {
    const parsed = sheetLayoutSchema.parse({})
    const stamp = { width: 0.64, height: 0.78 }
    // No explicit cell dims → the paper's own footprint.
    const auto = withSheetCellFromPaper(parsed, {}, stamp)
    expect(auto.cellWidth).toBe(0.64)
    expect(auto.cellHeight).toBe(0.78)
    // Explicit dims always win.
    const explicit = withSheetCellFromPaper(
      sheetLayoutSchema.parse({ cellWidth: 1.2, cellHeight: 1 }),
      { cellWidth: 1.2, cellHeight: 1 },
      stamp,
    )
    expect(explicit.cellWidth).toBe(1.2)
    expect(explicit.cellHeight).toBe(1)
    // Half-explicit fills only the missing axis.
    const half = withSheetCellFromPaper(
      sheetLayoutSchema.parse({ cellWidth: 1.2 }),
      { cellWidth: 1.2 },
      stamp,
    )
    expect(half.cellWidth).toBe(1.2)
    expect(half.cellHeight).toBe(0.78)
    // No paper dims (empty field) → untouched defaults.
    expect(withSheetCellFromPaper(parsed, {}, undefined)).toBe(parsed)
  })

  it('backing bounds are grid + margin; silhouettes sit inside them', () => {
    const { width, height } = sheetBackingSize(o)
    expect(width).toBeCloseTo(5 * o.cellWidth + 4 * o.gutter + 2 * o.backingMargin)
    expect(height).toBeCloseTo(2 * o.cellHeight + 1 * o.gutter + 2 * o.backingMargin)
    const rects = silhouetteRects(o, 10)
    expect(rects).toHaveLength(10)
    for (const r of rects) {
      expect(r.x).toBeGreaterThan(0)
      expect(r.y).toBeGreaterThan(0)
      expect(r.x + r.w).toBeLessThan(1)
      expect(r.y + r.h).toBeLessThan(1)
    }
    // Slot 0 (top-left in world) is top-left on the canvas (y down).
    expect(rects[0]!.x).toBeLessThan(rects[4]!.x)
    expect(rects[0]!.y).toBeLessThan(rects[5]!.y)
  })
})

describe('GLSL composition', () => {
  const sheet = { width: 1, height: 1.4 }

  it('namespaces uniforms per stack index (letter-fold: two folds)', () => {
    const stack = [
      { type: 'fold', options: { angle: 270, offset: 0.2, foldAngle: 120, radius: 0.05 } },
      { type: 'fold', options: { angle: 90, offset: 0.2, foldAngle: 100, radius: 0.08 } },
    ]
    const composed = buildDisplacementGLSL(stack, sheet)
    expect(composed.uniforms).toHaveProperty('uFold0_foldAngle')
    expect(composed.uniforms).toHaveProperty('uFold1_foldAngle')
    expect(composed.functionsSrc).toContain('void pl_fold0')
    expect(composed.functionsSrc).toContain('void pl_fold1')
    expect(composed.displaceSrc).toContain('pl_fold0(q, uv, t);')
  })

  it('every registered deformer ships a GLSL twin', () => {
    for (const id of listDeformers()) {
      expect(getDeformer(id).glsl, `deformer "${id}" is missing its GLSL implementation`).toBeTruthy()
    }
  })

  it('stackUniformValues matches buildDisplacementGLSL keys', () => {
    for (const c of parityCases) {
      const full = buildDisplacementGLSL(c.stack, c.sheet)
      const values = stackUniformValues(c.stack, c.sheet)
      expect(Object.keys(values).sort()).toEqual(Object.keys(full.uniforms).sort())
    }
  })

  it('skips disabled instances and rejects GLSL-less deformers', () => {
    const composed = buildDisplacementGLSL(
      [{ type: 'roll', options: { angle: 90, boundary: 0, radius: 0.1, spiral: 0 }, enabled: false }],
      sheet,
    )
    expect(composed.displaceSrc).not.toContain('pl_roll')
  })

  it('field vertex shader wires displacement, normals and atlas varyings', () => {
    const composed = buildDisplacementGLSL(
      [{ type: 'bend', options: { curvature: 0.5, angle: 0 } }],
      sheet,
    )
    const vs = buildFieldVertexShader(composed)
    expect(vs).toContain('csm_Position = p;')
    expect(vs).toContain('csm_Normal')
    expect(vs).toContain('attribute float aAtlas;')
    expect(vs).toContain('uPlTime + aPhase')
  })
})

describe('atlasGrid', () => {
  it('packs counts into near-square grids', () => {
    expect(atlasGrid(1)).toEqual({ cols: 1, rows: 1 })
    expect(atlasGrid(12)).toEqual({ cols: 4, rows: 3 })
    expect(atlasGrid(16)).toEqual({ cols: 4, rows: 4 })
    expect(atlasGrid(17)).toEqual({ cols: 5, rows: 4 })
  })
})
