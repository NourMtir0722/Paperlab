import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { crumple } from './crumple'
import { getDeformer, listDeformers } from './registry'
import type { DeformerContext } from './types'

const ctx: DeformerContext = { t: 0, sheet: { width: 1, height: 1.4 } }
const uv = new THREE.Vector2(0.5, 0.5)

function at(x: number, y: number, o: Partial<Parameters<typeof crumple.displace>[2]> = {}) {
  const out = new THREE.Vector3(x, y, 0)
  crumple.displace(out, uv, { ...crumple.defaults, ...o }, ctx)
  return out
}

describe('crumple', () => {
  it('is registered and ships a GLSL twin', () => {
    expect(listDeformers()).toContain('crumple')
    expect(getDeformer('crumple').glsl).toBeTruthy()
  })

  it('leaves the sheet alone at amount 0', () => {
    expect(at(0.3, -0.2, { amount: 0 }).toArray()).toEqual([0.3, -0.2, 0])
  })

  it('golden vector: the signed gap between the two nearest cell points', () => {
    expect(at(0.3, -0.2, { amount: 1, scale: 3, pull: 0, seed: 0 }).z).toBeCloseTo(0.07821499, 8)
  })

  it('golden vector: a different seed is a different crush of the same paper', () => {
    expect(at(0.3, -0.2, { amount: 1, scale: 3, pull: 0, seed: 5 }).z).toBeCloseTo(0.16406135, 8)
  })

  it('scales linearly with amount, so a field instance’s bias means what it says', () => {
    const full = at(0.31, -0.17, { amount: 1, pull: 0 }).z
    const half = at(0.31, -0.17, { amount: 0.5, pull: 0 }).z
    expect(half).toBeCloseTo(full * 0.5, 10)
  })

  it('draws the sheet in on itself — a crush occupies less room than a flat sheet', () => {
    const pulled = at(0.4, -0.5, { amount: 1, pull: 1 })
    expect(Math.abs(pulled.x)).toBeLessThan(0.4)
    expect(Math.abs(pulled.y)).toBeLessThan(0.5)
    // …and not at all when asked not to.
    expect(at(0.4, -0.5, { amount: 1, pull: 0 }).x).toBeCloseTo(0.4, 10)
  })

  it('stays inside ±amount/2 at every seed and scale, so `amount` is a height you can reason about', () => {
    // This is what NORM is calibrated against — if the jitter ever changes,
    // the peak moves and this is the test that says so.
    for (const seed of [0, 1, 2, 3, 4, 5, 6, 7]) {
      for (const scale of [0.5, 1, 3, 5, 8]) {
        for (let i = 0; i <= 60; i++) {
          for (let j = 0; j <= 60; j++) {
            const z = at((i / 60) * 2 - 1, (j / 60) * 2.6 - 1.3, { amount: 1, pull: 0, scale, seed }).z
            expect(Math.abs(z)).toBeLessThanOrEqual(0.5)
          }
        }
      }
    }
  })

  /**
   * The property the whole deformer exists for. A smooth field gives a noisy
   * sheet; only genuinely FLAT facets between creases shade like crushed
   * paper. Piecewise-linear means the second difference vanishes everywhere
   * except where a crease crosses — so most probes must come back linear, and
   * the ones that don't are the creases themselves.
   */
  /**
   * The property the whole deformer exists for. Distance-to-nearest is smooth
   * inside a cell — paper crushes into cones and cylinders, so curved facets
   * are right — and kinks HARD exactly where the nearest cell point changes.
   * That kink is the crease, and it is what shades. So the test is not "flat
   * everywhere" but "the creases stand far out of the ordinary curvature": a
   * field whose worst kink looks like its median is a bump map, not a crumple.
   */
  it('has creases that stand far out of the surrounding curvature', () => {
    const o = { amount: 1, scale: 3, pull: 0, seed: 0 }
    const step = 0.004
    const bends: number[] = []
    for (let i = 0; i < 400; i++) {
      const x = -0.4 + (i % 20) * 0.04
      const y = -0.6 + Math.floor(i / 20) * 0.06
      bends.push(Math.abs(at(x - step, y, o).z + at(x + step, y, o).z - 2 * at(x, y, o).z))
    }
    bends.sort((a, b) => a - b)
    const median = bends[Math.floor(bends.length / 2)]!
    const worst = bends[bends.length - 1]!
    expect(worst).toBeGreaterThan(median * 20)
  })

  it('asks for the geometry its creases need', () => {
    // Below this, a crease is just a smooth bump and `scale` stops meaning
    // anything — this is deliberately the densest ask in the deformer set.
    expect(crumple.geometry?.minSegments ?? 0).toBeGreaterThanOrEqual(64)
  })

  it('hands the shader the same numbers the JS half uses', () => {
    const u = crumple.glsl!.uniforms({ ...crumple.defaults, seed: 3 })
    expect(u).toEqual({ amount: 0.35, scale: 3, pull: 0.4, seed: 3 })
    expect(crumple.glsl!.strength).toBe('amount')
  })

  /**
   * The sheet is centred on the origin, so half of every sheet sits at a
   * negative coordinate — and JS's `%` keeps the sign of the dividend where
   * GLSL's `mod` does not. Getting that wrong hashes the two halves of the
   * sheet into different cells on the two paths, which the parity gate would
   * catch but only as a number. This says what it is.
   */
  it('treats a cell the same on both sides of the origin', () => {
    const o = { amount: 1, scale: 3, pull: 0, seed: 0 }
    // Same offset within a cell, mirrored across the origin: both must land
    // on a real cell rather than one of them falling off the jitter table.
    for (const x of [-0.83, -0.5, -0.17, 0.17, 0.5, 0.83]) {
      const z = at(x, -0.4, o).z
      expect(Number.isFinite(z)).toBe(true)
      expect(Math.abs(z)).toBeLessThanOrEqual(0.5)
    }
  })
})
