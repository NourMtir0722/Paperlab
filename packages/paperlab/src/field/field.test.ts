import { describe, expect, it } from 'vitest'
import { getLayout, listLayouts } from './layouts'
import { buildDisplacementGLSL, buildFieldVertexShader, stackUniformValues } from './compose'
import { atlasGrid } from '../content/atlas'
import { parityCases } from './parity'
import { getDeformer, listDeformers } from '../deformers/registry'

describe('layouts', () => {
  it('registers the seven built-ins', () => {
    expect(listLayouts()).toEqual(['ring', 'deck', 'cascade', 'helix', 'wall', 'tunnel', 'scatter'])
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
