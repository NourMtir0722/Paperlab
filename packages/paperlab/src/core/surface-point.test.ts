import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ClothSim } from '../physics/cloth'
import { surfacePointAt } from './sheet'

/**
 * `surfacePointAt` — a UV on the sheet to a point on its drawn surface.
 *
 * This is where fire's emitters find the paper: ash leaves the cell whose
 * presence reached zero, and that cell is named by the damage grid's UV. Two
 * grids meet here with their rows running opposite ways — the mesh (and the
 * cloth laid out on it) top row first, the damage grid from `v = 0` at the
 * bottom — so a flip in the wrong place puts every ember on the mirror image
 * of the burn. The first two tests exist for that and nothing else.
 */

const out = new THREE.Vector3()

function sample(geometry: THREE.PlaneGeometry, u: number, v: number): THREE.Vector3 {
  const { widthSegments, heightSegments } = geometry.parameters
  return surfacePointAt(
    geometry.attributes.position!.array,
    widthSegments + 1,
    heightSegments + 1,
    u,
    v,
    new THREE.Vector3(),
  )
}

/**
 * The reference answer, from the geometry's OWN index and uv buffers: find
 * the triangle three draws that contains `(u, v)` and interpolate across it.
 * Independent of the function under test's idea of the cell layout.
 */
function drawn(geometry: THREE.BufferGeometry, u: number, v: number): THREE.Vector3 {
  const index = geometry.index!.array
  const uv = geometry.attributes.uv!
  const pos = geometry.attributes.position!
  for (let t = 0; t < index.length; t += 3) {
    const [i0, i1, i2] = [index[t]!, index[t + 1]!, index[t + 2]!]
    const x0 = uv.getX(i0)
    const y0 = uv.getY(i0)
    const x1 = uv.getX(i1)
    const y1 = uv.getY(i1)
    const x2 = uv.getX(i2)
    const y2 = uv.getY(i2)
    const det = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
    const w0 = ((y1 - y2) * (u - x2) + (x2 - x1) * (v - y2)) / det
    const w1 = ((y2 - y0) * (u - x2) + (x0 - x2) * (v - y2)) / det
    const w2 = 1 - w0 - w1
    if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue
    return new THREE.Vector3(
      pos.getX(i0) * w0 + pos.getX(i1) * w1 + pos.getX(i2) * w2,
      pos.getY(i0) * w0 + pos.getY(i1) * w1 + pos.getY(i2) * w2,
      pos.getZ(i0) * w0 + pos.getZ(i1) * w1 + pos.getZ(i2) * w2,
    )
  }
  throw new Error(`no triangle contains (${u}, ${v})`)
}

/** Deterministic, so a failure reproduces. */
function jitter(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32
    return s / 2 ** 32 - 0.5
  }
}

describe('surfacePointAt', () => {
  it('puts v = 0 on the BOTTOM edge — row 0 of the damage grid', () => {
    const sheet = new THREE.PlaneGeometry(2, 1, 4, 4)
    const bottom = sample(sheet, 0.25, 0)
    expect(bottom.x).toBeCloseTo(-0.5)
    expect(bottom.y).toBeCloseTo(-0.5)
    const top = sample(sheet, 0.25, 1)
    expect(top.y).toBeCloseTo(0.5)
    // And a damage texel (x, y) of a 64² grid names u = x/63, v = y/63.
    const texel = sample(sheet, 10 / 63, 3 / 63)
    expect(texel.x).toBeCloseTo((10 / 63 - 0.5) * 2)
    expect(texel.y).toBeCloseTo(3 / 63 - 0.5)
  })

  it('lands every cloth particle on itself at its own UV, top row first', () => {
    // The sim's grid is PlaneGeometry's order — row 0 at the top — and it is
    // the array PaperMesh hands on. Draped and blown, so no coordinate is
    // where a flat layout would put it.
    const cols = 7
    const rows = 9
    const sim = new ClothSim(cols, rows, 1, 1.4, 'top-corners', {
      stiffness: 0.6,
      gravity: 1,
      wind: 1.5,
      floor: -10,
    })
    for (let i = 0; i < 90; i++) sim.step(1 / 60)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        surfacePointAt(sim.positions, cols, rows, c / (cols - 1), 1 - r / (rows - 1), out)
        const i3 = (r * cols + c) * 3
        expect(out.x).toBeCloseTo(sim.positions[i3]!, 5)
        expect(out.y).toBeCloseTo(sim.positions[i3 + 1]!, 5)
        expect(out.z).toBeCloseTo(sim.positions[i3 + 2]!, 5)
      }
    }
  })

  it('agrees with the geometry at every vertex, through its own uv attribute', () => {
    const sheet = new THREE.PlaneGeometry(1, 1.4, 5, 6)
    const uv = sheet.attributes.uv!
    const pos = sheet.attributes.position!
    for (let i = 0; i < pos.count; i++) {
      const p = sample(sheet, uv.getX(i), uv.getY(i))
      expect(p.distanceTo(new THREE.Vector3().fromBufferAttribute(pos, i))).toBeLessThan(1e-6)
    }
  })

  it('follows the triangles three draws across a deformed sheet, not a bilinear patch', () => {
    const sheet = new THREE.PlaneGeometry(1, 1.4, 4, 5)
    const pos = sheet.attributes.position!
    const rand = jitter(7)
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, pos.getX(i) + rand() * 0.1, pos.getY(i) + rand() * 0.1, rand() * 0.6)
    }
    const pick = jitter(11)
    for (let k = 0; k < 200; k++) {
      const u = pick() + 0.5
      const v = pick() + 0.5
      expect(sample(sheet, u, v).distanceTo(drawn(sheet, u, v))).toBeLessThan(1e-6)
    }
    // A cell whose far corner alone is lifted: bilinear would put the centre a
    // quarter of the way up; the drawn triangles split along the other
    // diagonal and leave it flat.
    const flat = new THREE.PlaneGeometry(1, 1, 1, 1)
    flat.attributes.position!.setZ(1, 1) // top-right: ix 1, iy 0
    expect(sample(flat, 0.5, 0.5).z).toBeCloseTo(drawn(flat, 0.5, 0.5).z)
    expect(sample(flat, 0.5, 0.5).z).not.toBeCloseTo(0.25)
  })

  it('clamps a UV off the sheet to its edge', () => {
    const sheet = new THREE.PlaneGeometry(1, 1, 3, 3)
    expect(sample(sheet, -1, 2).toArray()).toEqual(sample(sheet, 0, 1).toArray())
    expect(sample(sheet, 3, -0.5).toArray()).toEqual(sample(sheet, 1, 0).toArray())
  })
})
