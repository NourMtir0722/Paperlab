import { describe, expect, it } from 'vitest'
import { getLayout, listLayouts } from './layouts'
import { fieldBounds, fitCamera, resolveLayoutOptions } from './framing'
import { fieldShapeStack } from './stack'
import type { PaperConfig } from '../config/schema'
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

const PAPER = { width: 1, height: 1.4 }

describe('layouts', () => {
  it('registers the eleven built-ins', () => {
    expect(listLayouts()).toEqual([
      'ring',
      'fan',
      'spread',
      'pile',
      'wall',
      'spill',
      'sweep',
      'book',
      'accordion',
      'rack',
      'sheet',
    ])
  })

  it('poses are pure and deterministic', () => {
    for (const id of listLayouts()) {
      const layout = getLayout(id)
      const a = layout.pose(3, 12, layout.defaults, 0.25, PAPER)
      const b = layout.pose(3, 12, layout.defaults, 0.25, PAPER)
      expect(a).toEqual(b)
    }
  })

  it('ring: sheets sit on the radius facing outward (front toward the viewer)', () => {
    const ring = getLayout('ring')
    const pose = ring.pose(0, 8, { radius: 3, tiltDeg: 0 }, 0, PAPER)
    expect(Math.hypot(pose.position[0], pose.position[2])).toBeCloseTo(3)
    // i=0 sits on +Z nearest the camera; facing outward means no Y-spin, so its
    // front (+Z) points at the viewer rather than into the ring.
    expect(pose.rotation[1]).toBeCloseTo(0)
  })

  it('ring: phase rotates the whole ring, one turn wraps', () => {
    const ring = getLayout('ring')
    const at0 = ring.pose(2, 8, ring.defaults, 0, PAPER)
    const at1 = ring.pose(2, 8, ring.defaults, 1, PAPER)
    expect(at0.position[0]).toBeCloseTo(at1.position[0], 5)
    expect(at0.position[2]).toBeCloseTo(at1.position[2], 5)
  })

  it('wall: a full grid is symmetric about the center', () => {
    const wall = getLayout('wall')
    // 8 papers → 4×2 grid, fully occupied.
    const poses = Array.from({ length: 8 }, (_, i) => wall.pose(i, 8, wall.defaults, 0, PAPER))
    const sumX = poses.reduce((a, p) => a + p.position[0], 0)
    const sumY = poses.reduce((a, p) => a + p.position[1], 0)
    expect(Math.abs(sumX)).toBeLessThan(1e-6)
    expect(Math.abs(sumY)).toBeLessThan(1e-6)
  })

  it('every pose bias stays within the 0..1 contract', () => {
    for (const id of listLayouts()) {
      const layout = getLayout(id)
      for (let i = 0; i < 12; i++) {
        const { bias } = layout.pose(i, 12, layout.defaults, 0.3, PAPER)
        if (bias === undefined) continue
        expect(bias).toBeGreaterThanOrEqual(0)
        expect(bias).toBeLessThanOrEqual(1)
      }
    }
  })

  it('fan: hinges at a shared pivot, the middle sheet centered and flattest', () => {
    const fan = getLayout('fan')
    const o = { ...fan.defaults, sweep: 90, hinge: 1, lift: 0, bow: 0.8 }
    const hinge = (o.hinge * PAPER.height) / 2
    const poses = Array.from({ length: 9 }, (_, i) => fan.pose(i, 9, o, 0, PAPER))
    // The middle sheet sits at the origin, unrotated.
    expect(poses[4]!.position[0]).toBeCloseTo(0)
    expect(poses[4]!.position[1]).toBeCloseTo(0)
    expect(poses[4]!.rotation[2]).toBeCloseTo(0)
    // Every sheet keeps its pinned corner the same distance away — that is
    // what makes the hinge a hinge rather than a circle of sheets.
    for (const p of poses) {
      const hingeY = p.position[1] - Math.cos(p.rotation[2]) * hinge
      const hingeX = p.position[0] + Math.sin(p.rotation[2]) * hinge
      expect(hingeX).toBeCloseTo(0)
      expect(hingeY).toBeCloseTo(-hinge)
    }
    // The outer sheets carry the curl, the middle of the fan lies flat.
    expect(poses[0]!.bias).toBeCloseTo(1)
    expect(poses[4]!.bias).toBeCloseTo(1 - 0.8)
  })

  it('spread: constant slip per sheet, bowing further along the slide', () => {
    const spread = getLayout('spread')
    const o = { ...spread.defaults, slip: 0.4, angle: 0, lift: 0, bow: 0.5, drift: 0 }
    const poses = Array.from({ length: 6 }, (_, i) => spread.pose(i, 6, o, 0, PAPER))
    for (let i = 1; i < poses.length; i++) {
      expect(poses[i]!.position[0] - poses[i - 1]!.position[0]).toBeCloseTo(0.4)
      expect(poses[i]!.bias!).toBeGreaterThan(poses[i - 1]!.bias!)
    }
  })

  it('pile: sheets stack upward and the ones underneath are pressed flat', () => {
    const pile = getLayout('pile')
    const poses = Array.from({ length: 8 }, (_, i) => pile.pose(i, 8, pile.defaults, 0, PAPER))
    for (let i = 1; i < poses.length; i++) {
      expect(poses[i]!.position[2]).toBeGreaterThan(poses[i - 1]!.position[2])
      expect(poses[i]!.bias!).toBeGreaterThan(poses[i - 1]!.bias!)
    }
    // Only the top of the pile keeps the preset's full deformation.
    expect(poses[7]!.bias).toBeCloseTo(1)
    expect(poses[0]!.bias).toBeCloseTo(1 - pile.defaults.press)
  })

  it('spill: no two sheets bend alike', () => {
    const spill = getLayout('spill')
    const biases = Array.from({ length: 10 }, (_, i) => spill.pose(i, 10, spill.defaults, 0, PAPER).bias)
    expect(new Set(biases).size).toBe(10)
  })
})

describe('contact layouts (they need the real sheet)', () => {
  it('wall sizes its cells from the paper, not a hardcoded footprint', () => {
    const wall = getLayout('wall')
    const o = { ...wall.defaults, gapX: 0.2, gapY: 0.2, jitterAmt: 0, sag: 0 }
    // Neighbours in a row sit one paper-width plus one gutter apart, whatever
    // the paper is — a 1×1.4 letter and a 2×1.4 landscape print alike.
    for (const paper of [PAPER, { width: 2, height: 1.4 }]) {
      const a = wall.pose(0, 8, o, 0, paper)
      const b = wall.pose(1, 8, o, 0, paper)
      expect(b.position[1]).toBeCloseTo(a.position[1]!)
      expect(b.position[0]! - a.position[0]!).toBeCloseTo(paper.width + o.gapX)
    }
  })

  it('wall keeps the whole grid roughly square as the paper changes shape', () => {
    const wall = getLayout('wall')
    const o = { ...wall.defaults, jitterAmt: 0, sag: 0 }
    // A wide sheet wants fewer columns than a tall one for the same count.
    const cols = (paper: { width: number; height: number }) =>
      new Set(Array.from({ length: 12 }, (_, i) => wall.pose(i, 12, o, 0, paper).position[0])).size
    expect(cols({ width: 2, height: 0.5 })).toBeLessThan(cols({ width: 0.5, height: 2 }))
  })

  it('sweep ramps deformation across the series and nothing else', () => {
    const sweep = getLayout('sweep')
    const poses = Array.from({ length: 6 }, (_, i) => sweep.pose(i, 6, sweep.defaults, 0, PAPER))
    expect(poses[0]!.bias).toBeCloseTo(0)
    expect(poses[5]!.bias).toBeCloseTo(1)
    for (const p of poses) expect(p.rotation).toEqual([0, 0, 0])
    for (let i = 1; i < poses.length; i++) {
      expect(poses[i]!.bias!).toBeGreaterThan(poses[i - 1]!.bias!)
    }
  })

  it('book: every page hinges on the one shared spine', () => {
    const book = getLayout('book')
    const o = { spread: 70, split: 0.5, lift: 0, gutter: 0.5 }
    for (let i = 0; i < 8; i++) {
      const p = book.pose(i, 8, o, 0, PAPER)
      // Undo the page's swing: its inner edge must land back on the spine.
      const theta = -p.rotation[1]!
      const spineX = p.position[0]! - Math.cos(theta) * (PAPER.width / 2) * Math.sign(p.position[0]! || 1)
      expect(spineX).toBeCloseTo(0)
      expect(Math.hypot(p.position[0]!, p.position[2]!)).toBeCloseTo(PAPER.width / 2)
    }
  })

  it('book: split slides between an open codex and a one-sided sample deck', () => {
    const book = getLayout('book')
    const codex = Array.from({ length: 8 }, (_, i) =>
      book.pose(i, 8, { ...book.defaults, split: 0.5 }, 0, PAPER),
    )
    expect(codex.filter((p) => p.position[0]! < 0)).toHaveLength(4)

    const deck = Array.from({ length: 8 }, (_, i) =>
      book.pose(i, 8, { ...book.defaults, split: 0 }, 0, PAPER),
    )
    expect(deck.every((p) => p.position[0]! > 0)).toBe(true)
  })

  it('accordion: adjacent panels genuinely share a crease', () => {
    const accordion = getLayout('accordion')
    const o = { angle: 50, slack: 0 }
    const edge = (p: ReturnType<typeof accordion.pose>, dir: number) => {
      const a = p.rotation[1]!
      return [
        p.position[0]! + dir * (PAPER.width / 2) * Math.cos(a),
        p.position[2]! - dir * (PAPER.width / 2) * Math.sin(a),
      ]
    }
    for (let i = 0; i < 5; i++) {
      const right = edge(accordion.pose(i, 6, o, 0, PAPER), 1)
      const left = edge(accordion.pose(i + 1, 6, o, 0, PAPER), -1)
      expect(right[0]!).toBeCloseTo(left[0]!)
      expect(right[1]!).toBeCloseTo(left[1]!)
    }
  })

  it('accordion: panels alternate, and a wider strip spreads further', () => {
    const accordion = getLayout('accordion')
    const o = { angle: 50, slack: 0 }
    expect(accordion.pose(0, 4, o, 0, PAPER).rotation[1]).toBeCloseTo(
      -accordion.pose(1, 4, o, 0, PAPER).rotation[1]!,
    )
    const narrow = accordion.pose(3, 4, o, 0, { width: 1, height: 1 }).position[0]!
    const broad = accordion.pose(3, 4, o, 0, { width: 2, height: 1 }).position[0]!
    expect(broad).toBeCloseTo(narrow * 2)
  })

  it('rack: every sheet stands on the same floor, whatever its lean', () => {
    const rack = getLayout('rack')
    const poses = Array.from({ length: 8 }, (_, i) => rack.pose(i, 8, rack.defaults, 0, PAPER))
    for (const p of poses) {
      // Undo the lean about the bottom edge — the foot must land on y = 0.
      const footY = p.position[1]! - Math.cos(-p.rotation[0]!) * (PAPER.height / 2)
      expect(footY).toBeCloseTo(0)
      expect(p.rotation[0]!).toBeLessThanOrEqual(0)
    }
  })

  it('rack: spacing is measured in real paper widths', () => {
    const rack = getLayout('rack')
    const o = { ...rack.defaults, spacing: 0.5, vary: 0, sway: 0 }
    const step = (paper: { width: number; height: number }) =>
      rack.pose(1, 4, o, 0, paper).position[0]! - rack.pose(0, 4, o, 0, paper).position[0]!
    expect(step(PAPER)).toBeCloseTo(PAPER.width * 0.5)
    expect(step({ width: 3, height: 1 })).toBeCloseTo(1.5)
  })

  it('rack: a sheet leaning further carries more bow', () => {
    const rack = getLayout('rack')
    const poses = Array.from({ length: 10 }, (_, i) => rack.pose(i, 10, rack.defaults, 0, PAPER))
    const sorted = [...poses].sort((a, b) => a.rotation[0]! - b.rotation[0]!)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.bias!).toBeLessThanOrEqual(sorted[i - 1]!.bias! + 1e-9)
    }
  })
})

describe('sheet layout (the stamp block)', () => {
  const o = sheetLayoutSchema.parse({}) // 2×5

  it('poses a flat rows×columns grid in register — no jitter, z = backing lift', () => {
    const sheet = getLayout('sheet')
    const first = sheet.pose(0, 10, o, 0, PAPER)
    const last = sheet.pose(9, 10, o, 0, PAPER)
    expect(first.rotation).toEqual([0, 0, 0])
    expect(first.position[2]).toBe(SHEET_LIFT)
    // Slot 0 is top-left, slot 9 bottom-right — symmetric about the center.
    expect(first.position[0]).toBeCloseTo(-last.position[0])
    expect(first.position[1]).toBeCloseTo(-last.position[1])
    // Neighbors sit exactly one cell + gutter apart.
    const second = sheet.pose(1, 10, o, 0, PAPER)
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
      'top-left',
      'top-right',
      'top-right',
      'bottom-left',
      'bottom-right',
      'bottom-right',
      'bottom-left',
      'bottom-right',
      'bottom-right',
    ])
    expect(outwardCorner(4, { rows: 3, columns: 3 })).toBe('bottom-right')

    // 3×5: center row (row 1) all breaks down; center column (col 2) breaks right.
    expect(outwardCorner(7, { rows: 3, columns: 5 })).toBe('bottom-right') // r1,c2 dead center
    expect(outwardCorner(2, { rows: 3, columns: 5 })).toBe('top-right') // r0,c2 center column

    // Single-axis grids fall to the down/right default on the tie axis.
    expect(grid(1, 5)).toEqual(['bottom-left', 'bottom-left', 'bottom-right', 'bottom-right', 'bottom-right'])
    expect(grid(5, 1)).toEqual(['top-right', 'top-right', 'bottom-right', 'bottom-right', 'bottom-right'])
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
    const composed = buildDisplacementGLSL([{ type: 'bend', options: { curvature: 0.5, angle: 0 } }], sheet)
    const vs = buildFieldVertexShader(composed)
    expect(vs).toContain('csm_Position = p;')
    expect(vs).toContain('csm_Normal')
    expect(vs).toContain('attribute float aAtlas;')
    expect(vs).toContain('uPlTime + aPhase')
    // Displacement (and both normal probes) read the per-instance bias.
    expect(vs).toContain('attribute float aBias;')
    expect(vs.match(/, aBias\)/g)).toHaveLength(3)
  })

  it('the strength uniform scales by bias; other uniforms do not', () => {
    const composed = buildDisplacementGLSL(
      [{ type: 'curl', options: { corner: 'bottom-right', amount: 0.4, radius: 0.2, skew: 0 } }],
      sheet,
    )
    expect(composed.functionsSrc).toContain('(uCurl0_amount * plBias)')
    expect(composed.functionsSrc).toContain('uCurl0_radius')
    expect(composed.functionsSrc).not.toContain('(uCurl0_radius * plBias)')
    expect(composed.displaceSrc).toContain('plDisplace(vec3 p, vec2 uv, float t, float bias)')
  })

  it('roll opts out of bias — its strength has no linear form', () => {
    const composed = buildDisplacementGLSL(
      [{ type: 'roll', options: { angle: 90, boundary: 0, radius: 0.1, spiral: 0 } }],
      sheet,
    )
    expect(composed.functionsSrc).not.toContain('plBias)')
  })
})

describe('field framing', () => {
  const sheet = { width: 1.2, height: 0.9 }

  it('bounds cover every sheet the layout poses, across the whole phase cycle', () => {
    const reach = Math.hypot(sheet.width, sheet.height) / 2
    for (const id of listLayouts()) {
      const layout = getLayout(id)
      const b = fieldBounds(layout, 9, layout.defaults, sheet)
      for (let i = 0; i < 9; i++) {
        for (const phase of [0, 0.25, 0.5, 0.75]) {
          const pose = layout.pose(i, 9, layout.defaults, phase, sheet)
          for (let axis = 0; axis < 3; axis++) {
            const r = reach * pose.scale
            expect(pose.position[axis]! - r).toBeGreaterThanOrEqual(b.center[axis]! - b.half[axis]! - 1e-9)
            expect(pose.position[axis]! + r).toBeLessThanOrEqual(b.center[axis]! + b.half[axis]! + 1e-9)
          }
        }
      }
    }
  })

  it('a wall needs a wider box than a pile of the same papers', () => {
    const wall = fieldBounds(getLayout('wall'), 12, getLayout('wall').defaults, sheet)
    const pile = fieldBounds(getLayout('pile'), 12, getLayout('pile').defaults, sheet)
    expect(wall.half[0]).toBeGreaterThan(pile.half[0])
    expect(wall.half[1]).toBeGreaterThan(pile.half[1])
  })

  it('empty fields still frame something rather than dividing by zero', () => {
    const ring = getLayout('ring')
    expect(Number.isFinite(fitCamera(ring, 0, ring.defaults, sheet, 45, 1.6).position[2])).toBe(true)
  })

  it('every sheet lands inside the frustum the camera is placed for', () => {
    const fov = 45
    const aspect = 1.6
    const vTan = Math.tan((fov * Math.PI) / 180 / 2)
    const hTan = vTan * aspect
    const reach = Math.hypot(sheet.width, sheet.height) / 2
    for (const id of listLayouts()) {
      const layout = getLayout(id)
      const { position, target } = fitCamera(layout, 9, layout.defaults, sheet, fov, aspect, 1)
      for (let i = 0; i < 9; i++) {
        for (const phase of [0, 0.25, 0.5, 0.75]) {
          const pose = layout.pose(i, 9, layout.defaults, phase, sheet)
          const depth = position[2] - pose.position[2]!
          const r = reach * pose.scale
          expect(Math.abs(pose.position[0]! - target[0])).toBeLessThanOrEqual(depth * hTan - r + 1e-9)
          expect(Math.abs(pose.position[1]! - target[1])).toBeLessThanOrEqual(depth * vTan - r + 1e-9)
        }
      }
    }
  })

  it('a ring is framed from inside its own depth, not behind its whole box', () => {
    // The widest sheets of a ring sit at mid-depth. Treating the ring as a
    // box would add its full half-depth on top of the width fit and push the
    // camera far enough back to lose the gallery.
    const ring = getLayout('ring')
    const o = { radius: 2.6, tiltDeg: 8 }
    const { position } = fitCamera(ring, 9, o, sheet, 45, 1.96)
    const box = fieldBounds(ring, 9, o, sheet)
    expect(position[2]).toBeLessThan(box.half[0] + box.half[2])
  })

  it('a narrower viewport pushes the camera further back', () => {
    const wall = getLayout('wall')
    const near = fitCamera(wall, 9, wall.defaults, sheet, 45, 0.8).position[2]
    const far = fitCamera(wall, 9, wall.defaults, sheet, 45, 2.4).position[2]
    expect(near).toBeGreaterThan(far)
  })

  it('sheet grids resolve their cells from the paper, for camera and renderer alike', () => {
    const layout = getLayout('sheet')
    const o = resolveLayoutOptions('sheet', layout, undefined, { width: 0.7, height: 0.9 })
    expect(o.cellWidth).toBeCloseTo(0.7)
    expect(o.cellHeight).toBeCloseTo(0.9)
  })
})

describe('field deformer stack', () => {
  const base = { sheet: { width: 1, height: 1.4 } } as unknown as PaperConfig

  it('a raw deformer stack wins over a behavior — the Advanced fork', () => {
    const config = {
      ...base,
      behavior: { type: 'peel', progress: 0.5, corner: 'bottom-right', radius: 0.16 },
      deformers: [{ type: 'bend', options: { curvature: 0.4, angle: 0 }, enabled: true }],
    } as unknown as PaperConfig
    expect(fieldShapeStack(config, 0.5).map((d) => d.type)).toEqual(['bend'])
  })

  it('a preset shaped only by deformers is not flat in a field', () => {
    const config = {
      ...base,
      deformers: [{ type: 'bend', options: { curvature: 0.35, angle: 0 }, enabled: true }],
    } as unknown as PaperConfig
    expect(fieldShapeStack(config, 0)).toHaveLength(1)
  })

  it('behaviors still drive off progress when no deformers fork them', () => {
    const config = {
      ...base,
      behavior: { type: 'peel', progress: 0.2, corner: 'bottom-right', radius: 0.16 },
    } as unknown as PaperConfig
    const early = fieldShapeStack(config, 0.1)
    const late = fieldShapeStack(config, 0.9)
    expect(early).not.toEqual(late)
  })

  it('a config with neither is an empty stack', () => {
    expect(fieldShapeStack(base, 0)).toEqual([])
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
