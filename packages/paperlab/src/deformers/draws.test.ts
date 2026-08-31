import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { computeSheetNormals } from '../core/normals'
import { createSheetGeometry } from '../core/sheet'
import { applyDeformerStack, stackAutoSegments, stackMinSegments } from './compose'
import { getDeformer, listDeformers, resolveDeformerStack } from './registry'
import type { DeformerInstance } from './types'
import type { SheetConfig } from '../config/schema'

/**
 * Every deformer, built into a real sheet, actually draws one.
 *
 * This file exists because of a bug report that turned out to be wrong, and
 * the reason it could stand for a day is the interesting part. `drape` was
 * recorded as rendering an **invisible sheet** on the CPU path, on the
 * evidence that a screenshot of it contained exactly one colour while the
 * same frame of `roll` contained 698. `ribbon` was built around the finding
 * — it uses `wave` where it means `drape` — and it stood as an open bug.
 *
 * It does not reproduce. A drape at that size fills the frame with a nearly
 * flat, nearly evenly lit surface, and **counting colours cannot tell that
 * apart from an empty frame**. The measurement answered a different question
 * from the one being asked.
 *
 * What the report got right is the gap it named: *"a parity gate proves the
 * two implementations agree, not that either one draws."* Both halves of
 * `drape` could have returned zero forever and every existing test would
 * have passed — `drape.test.ts` checks `displace` at chosen uvs, and parity
 * checks CPU against GPU. Nothing checked that the pipeline in between
 * produces a surface.
 *
 * So this asserts the thing a screenshot was being used to guess at, on
 * geometry rather than on pixels:
 *
 * - every vertex is finite,
 * - the deformer *moved* the sheet (it is not silently a no-op),
 * - the surface still HAS area — an isometric-ish bend keeps most of it, and
 *   the failure this is really guarding against is total collapse,
 * - the normals come out unit length, which is what a lit sheet needs to be
 *   visible at all, and was the report's own leading suspicion.
 *
 * Run on a tall banner as well as an ordinary sheet, because the tall one is
 * the shape that provoked the report, and because it is the shape where the
 * two axes of the grid differ most.
 */

const SHEETS: { name: string; sheet: SheetConfig }[] = [
  {
    name: 'an ordinary sheet',
    sheet: { width: 1, height: 1.4, thickness: 0.0012, segments: 'auto', cornerRadius: 0 },
  },
  {
    // The ribbon stage's own banner — and the shape the false report was
    // filed against.
    name: 'a tall banner',
    sheet: { width: 1.05, height: 9, thickness: 0.0012, segments: 'auto', cornerRadius: 0 },
  },
]

/**
 * Options that make each deformer visibly do something. Several ship
 * defaults tuned for use *inside* a behavior, where another deformer is
 * carrying the shape — those are honest defaults and a poor test subject.
 */
const STRENGTH: Record<string, Record<string, unknown>> = {
  roll: { angle: 90, boundary: -0.1, radius: 0.12, thickness: 0.03 },
  curl: { corner: 'bottom-right', amount: 0.6, radius: 0.25 },
  bend: { curvature: 0.8, angle: 0 },
  fold: { angle: 90, offset: 0.15, foldAngle: 110, radius: 0.06 },
  wave: { amplitude: 0.09, wavelength: 0.4, speed: 0.9, angle: 75 },
  drape: { amplitude: 0.3, folds: 6, falloff: 1.2, irregular: 0.5, gather: 0.6 },
  crumple: { amount: 0.75, scale: 3, pull: 0.4, seed: 2 },
}

/** Build the sheet the way `<PaperMesh>` does, then deform it. */
function build(sheet: SheetConfig, stack: DeformerInstance[]) {
  const geometry = createSheetGeometry(sheet, stackMinSegments(stack, sheet), stackAutoSegments(stack, sheet))
  const flat = Float32Array.from(geometry.attributes.position!.array as Float32Array)
  applyDeformerStack(geometry, flat, stack, { t: 0.4, sheet })
  computeSheetNormals(geometry)
  return { geometry, flat }
}

/** Summed area of every triangle, which is what "there is a surface" means. */
function surfaceArea(geometry: THREE.BufferGeometry): number {
  const pos = geometry.attributes.position!.array as Float32Array
  const idx = geometry.index!.array
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  let total = 0
  for (let i = 0; i < idx.length; i += 3) {
    a.fromArray(pos, idx[i]! * 3)
    b.fromArray(pos, idx[i + 1]! * 3)
    c.fromArray(pos, idx[i + 2]! * 3)
    total += b.sub(a).cross(c.sub(a)).length() / 2
  }
  return total
}

describe('every deformer draws a sheet', () => {
  for (const { name, sheet } of SHEETS) {
    for (const id of listDeformers()) {
      const stack = resolveDeformerStack([{ type: id, options: STRENGTH[id] ?? {} }])
      const flatArea = sheet.width * sheet.height

      it(`${id} on ${name}: every vertex is finite`, () => {
        const { geometry } = build(sheet, stack)
        const pos = geometry.attributes.position!.array as Float32Array
        expect(pos.length).toBeGreaterThan(0)
        expect(pos.every((v) => Number.isFinite(v))).toBe(true)
      })

      it(`${id} on ${name}: moves the sheet`, () => {
        const { geometry, flat } = build(sheet, stack)
        const pos = geometry.attributes.position!.array as Float32Array
        const moved = pos.some((v, i) => Math.abs(v - flat[i]!) > 1e-6)
        expect(moved, `${id} left the sheet exactly flat — it is a no-op here`).toBe(true)
      })

      it(`${id} on ${name}: leaves a surface behind`, () => {
        const { geometry } = build(sheet, stack)
        const area = surfaceArea(geometry)
        // Paper bends without stretching, so a deformed sheet keeps most of
        // its area; what this catches is collapse to nothing, which is what
        // "renders an invisible sheet" would actually look like in geometry.
        expect(area, `${id} collapsed the sheet: ${area} of ${flatArea}`).toBeGreaterThan(flatArea * 0.4)
      })

      it(`${id} on ${name}: has normals to light`, () => {
        const { geometry } = build(sheet, stack)
        const nrm = geometry.attributes.normal!.array as Float32Array
        let unit = 0
        for (let i = 0; i < nrm.length; i += 3) {
          const len = Math.hypot(nrm[i]!, nrm[i + 1]!, nrm[i + 2]!)
          expect(Number.isFinite(len)).toBe(true)
          if (Math.abs(len - 1) < 1e-3) unit++
        }
        // A vertex whose faces cancel is left at zero on purpose (see
        // computeSheetNormals) — a handful is fine, a sheet of them is not.
        const total = nrm.length / 3
        expect(unit / total, `${id}: only ${unit}/${total} vertices have a normal`).toBeGreaterThan(0.95)
      })
    }
  }

  it('covers every registered deformer, so a new one cannot skip this', () => {
    for (const id of listDeformers()) {
      expect(Object.keys(STRENGTH), `${id} has no strength entry in draws.test.ts`).toContain(id)
    }
    expect(getDeformer('drape')).toBeDefined()
  })
})
