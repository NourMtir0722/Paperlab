import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { computeSheetNormals } from './normals'
import { applyDeformerStack } from '../deformers/compose'
import { resolveDeformerStack } from '../deformers/registry'
import { createSheetGeometry } from './sheet'

/**
 * The fast path replaces `BufferGeometry.computeVertexNormals()` on the one
 * loop that runs every frame, so "close enough" is not the bar: it has to be
 * the same numbers. Every case below asserts EXACT equality against three's
 * own answer, not a tolerance — the moment a difference is allowed, nothing
 * catches the day it becomes a visible one.
 */
const sheet = { width: 1, height: 1.4, thickness: 0.2, segments: 24 }

function deformed(stack: { type: string; options?: Record<string, unknown> }[], t = 0.7) {
  const geometry = createSheetGeometry(sheet as never, 2, 2)
  const base = Float32Array.from(geometry.attributes.position!.array as Float32Array)
  applyDeformerStack(geometry, base, resolveDeformerStack(stack), { t, sheet: sheet as never })
  return geometry
}

function threeNormals(geometry: THREE.BufferGeometry): Float32Array {
  geometry.computeVertexNormals()
  return Float32Array.from(geometry.attributes.normal!.array as Float32Array)
}

describe('computeSheetNormals', () => {
  for (const stack of [
    [{ type: 'roll' as const, options: {} }],
    [
      { type: 'drape' as const, options: {} },
      { type: 'wave' as const, options: {} },
    ],
    [{ type: 'crumple' as const, options: {} }],
    [{ type: 'fold' as const, options: {} }],
  ]) {
    const name = stack.map((s) => s.type).join('+')
    it(`matches three's answer bit for bit — ${name}`, () => {
      const geometry = deformed(stack)
      const fast = Float32Array.from(geometry.attributes.normal!.array as Float32Array)
      const reference = threeNormals(geometry)
      expect(fast).toEqual(reference)
      // A flat sheet's normals are all +Z, so an all-equal pair proves
      // nothing unless the geometry actually bent.
      expect(fast.some((v, i) => i % 3 === 2 && v < 0.999)).toBe(true)
    })
  }

  it('leaves a degenerate vertex at zero rather than writing NaN', () => {
    const geometry = new THREE.PlaneGeometry(1, 1, 2, 2)
    const position = geometry.attributes.position as THREE.BufferAttribute
    ;(position.array as Float32Array).fill(0)
    computeSheetNormals(geometry)
    expect([...(geometry.attributes.normal!.array as Float32Array)].every(Number.isFinite)).toBe(true)
  })

  it('falls back to three for a non-indexed geometry', () => {
    const geometry = new THREE.PlaneGeometry(1, 1, 2, 2).toNonIndexed()
    ;(geometry.attributes.normal!.array as Float32Array).fill(0)
    computeSheetNormals(geometry)
    const fast = Float32Array.from(geometry.attributes.normal!.array as Float32Array)
    expect(fast).toEqual(threeNormals(geometry))
  })
})
