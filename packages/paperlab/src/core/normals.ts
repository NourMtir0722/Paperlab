import type * as THREE from 'three'

/**
 * Recompute vertex normals for a sheet, straight over the typed arrays.
 *
 * Identical arithmetic to `BufferGeometry.computeVertexNormals()` — same
 * `cross(C − B, A − B)` per face, same accumulate-then-normalize — and it
 * agrees with it bit for bit (`core/normals.test.ts` asserts exact equality,
 * not a tolerance). What it does not do is go through `Vector3` and the
 * `BufferAttribute` accessors, which is three's cost and not the maths'.
 *
 * Worth having its own file because of where it sits: this runs once per
 * animated sheet per frame in hero mode, over a grid that `segments: 'auto'`
 * is allowed to take to 128 (16.6k vertices, 32.8k faces). Measured on a
 * `drape + wave` sheet at that ceiling it is 1.37 ms through three and
 * 0.18 ms here — normals were three quarters of the cost of a `roll`'s
 * frame and are now a tenth of it.
 *
 * Falls back to three for anything that is not an indexed mesh carrying a
 * normal attribute, which is the only shape this fast path knows.
 */
export function computeSheetNormals(geometry: THREE.BufferGeometry): void {
  const index = geometry.index
  const normalAttr = geometry.attributes.normal as THREE.BufferAttribute | undefined
  const positionAttr = geometry.attributes.position as THREE.BufferAttribute | undefined
  if (!index || !normalAttr || !positionAttr) {
    geometry.computeVertexNormals()
    return
  }
  const pos = positionAttr.array as Float32Array
  const nrm = normalAttr.array as Float32Array
  const idx = index.array as Uint16Array | Uint32Array

  nrm.fill(0)
  for (let i = 0, l = idx.length; i < l; i += 3) {
    const a = idx[i]! * 3
    const b = idx[i + 1]! * 3
    const c = idx[i + 2]! * 3
    const bx = pos[b]!
    const by = pos[b + 1]!
    const bz = pos[b + 2]!
    const cbx = pos[c]! - bx
    const cby = pos[c + 1]! - by
    const cbz = pos[c + 2]! - bz
    const abx = pos[a]! - bx
    const aby = pos[a + 1]! - by
    const abz = pos[a + 2]! - bz
    // The face normal, unnormalized — its length is twice the triangle's
    // area, which is the area weighting three's version also relies on.
    const nx = cby * abz - cbz * aby
    const ny = cbz * abx - cbx * abz
    const nz = cbx * aby - cby * abx
    nrm[a] = nrm[a]! + nx
    nrm[a + 1] = nrm[a + 1]! + ny
    nrm[a + 2] = nrm[a + 2]! + nz
    nrm[b] = nrm[b]! + nx
    nrm[b + 1] = nrm[b + 1]! + ny
    nrm[b + 2] = nrm[b + 2]! + nz
    nrm[c] = nrm[c]! + nx
    nrm[c + 1] = nrm[c + 1]! + ny
    nrm[c + 2] = nrm[c + 2]! + nz
  }

  for (let i = 0, l = nrm.length; i < l; i += 3) {
    const x = nrm[i]!
    const y = nrm[i + 1]!
    const z = nrm[i + 2]!
    // Divide rather than multiply by a reciprocal: `Vector3.normalize()`
    // divides, and one rounding difference per component is the whole
    // distance between "bit-identical to three" and "close enough", which
    // is not a claim worth weakening to save two multiplies.
    //
    // A vertex whose faces cancelled out has no normal to give. three's
    // `normalize()` divides by `length() || 1` and leaves the zero; so does
    // this, rather than dividing by zero and poisoning the lighting.
    const len = Math.sqrt(x * x + y * y + z * z) || 1
    nrm[i] = x / len
    nrm[i + 1] = y / len
    nrm[i + 2] = z / len
  }
  normalAttr.needsUpdate = true
}
