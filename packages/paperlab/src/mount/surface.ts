import * as THREE from 'three'

/** Where a query landed: the point, and the surface's smooth normal there. */
export interface SurfaceHit {
  point: THREE.Vector3
  normal: THREE.Vector3
}

/**
 * Closest-point queries against an arbitrary triangle mesh — the one thing a
 * sticker needs to know about what it is stuck to.
 *
 * Built once per object, never per frame: the sticker is laid onto the
 * surface when the object or the sticker's placement changes, and after that
 * the frame loop only reads the wrap that came out of it (see `wrap.ts`).
 *
 * A uniform grid of triangle buckets rather than a BVH, because the queries
 * are all NEAR the surface — a step along it, then back down onto it — so
 * the answer is almost always in the first cell or its neighbours, and a
 * grid finds it without descending anything. A dependency for a BVH would be
 * a library's worth of code for an object that is queried a few thousand
 * times, once.
 *
 * Normals are interpolated from the vertices, so a query on a faceted mesh
 * still reports a smooth surface: a sticker laid on facets would kink at
 * every edge.
 */
export class MountSurface {
  readonly positions: Float32Array
  readonly normals: Float32Array
  readonly index: Uint32Array
  readonly bounds = new THREE.Box3()
  readonly center = new THREE.Vector3()
  private readonly cell: number
  private readonly dims: [number, number, number]
  private readonly starts: Int32Array
  private readonly items: Int32Array
  /** Which query last looked at each triangle — a Set per query, without the Set. */
  private readonly stamps: Uint32Array
  private query = 0

  constructor(geometry: THREE.BufferGeometry) {
    const position = geometry.attributes.position as THREE.BufferAttribute
    this.positions = Float32Array.from(position.array as ArrayLike<number>)
    if (!geometry.attributes.normal) geometry.computeVertexNormals()
    this.normals = Float32Array.from(
      (geometry.attributes.normal as THREE.BufferAttribute).array as ArrayLike<number>,
    )
    if (geometry.index) {
      this.index = Uint32Array.from(geometry.index.array as ArrayLike<number>)
    } else {
      this.index = new Uint32Array(position.count)
      for (let i = 0; i < position.count; i++) this.index[i] = i
    }

    this.bounds.setFromBufferAttribute(position)
    this.bounds.getCenter(this.center)
    const size = this.bounds.getSize(new THREE.Vector3())
    const triangles = this.index.length / 3
    // About eight triangles to a cell over the surface (measured: fewer makes
    // the ring walk dearer than the triangles it saves), which scales as the
    // square of the grid, so the cell is sized off area rather than volume.
    const area = 2 * (size.x * size.y + size.y * size.z + size.x * size.z)
    this.cell = Math.max(1e-4, Math.sqrt((area / Math.max(1, triangles)) * 8))
    this.dims = [
      Math.max(1, Math.ceil(size.x / this.cell)),
      Math.max(1, Math.ceil(size.y / this.cell)),
      Math.max(1, Math.ceil(size.z / this.cell)),
    ]

    // Two passes: count, then fill — a flat CSR layout, no arrays of arrays.
    const cells = this.dims[0] * this.dims[1] * this.dims[2]
    const counts = new Int32Array(cells + 1)
    const visit = (tri: number, fn: (c: number) => void) => {
      const a = this.index[tri * 3]! * 3
      const b = this.index[tri * 3 + 1]! * 3
      const c = this.index[tri * 3 + 2]! * 3
      const p = this.positions
      const lo = [0, 1, 2].map((k) => Math.min(p[a + k]!, p[b + k]!, p[c + k]!))
      const hi = [0, 1, 2].map((k) => Math.max(p[a + k]!, p[b + k]!, p[c + k]!))
      const [x0, y0, z0] = this.cellOf(lo[0]!, lo[1]!, lo[2]!)
      const [x1, y1, z1] = this.cellOf(hi[0]!, hi[1]!, hi[2]!)
      for (let z = z0; z <= z1; z++)
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) fn(this.flat(x, y, z))
    }
    for (let t = 0; t < triangles; t++) visit(t, (c) => counts[c + 1]!++)
    for (let c = 0; c < cells; c++) counts[c + 1] = counts[c + 1]! + counts[c]!
    this.starts = counts
    this.items = new Int32Array(counts[cells]!)
    const cursor = counts.slice(0, cells)
    for (let t = 0; t < triangles; t++) visit(t, (c) => (this.items[cursor[c]!++] = t))
    this.stamps = new Uint32Array(triangles)
  }

  private cellOf(x: number, y: number, z: number): [number, number, number] {
    const min = this.bounds.min
    const clampTo = (v: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor(v)))
    return [
      clampTo((x - min.x) / this.cell, this.dims[0]),
      clampTo((y - min.y) / this.cell, this.dims[1]),
      clampTo((z - min.z) / this.cell, this.dims[2]),
    ]
  }

  private flat(x: number, y: number, z: number): number {
    return (z * this.dims[1] + y) * this.dims[0] + x
  }

  /**
   * The nearest point on the surface to `p`, and the smooth normal there.
   *
   * Searches outward in shells of cells until the best hit is nearer than the
   * next shell could possibly be, so it is exact, not approximate — just fast
   * when the query is already close.
   */
  closest(p: THREE.Vector3, out: SurfaceHit): SurfaceHit {
    const [cx, cy, cz] = this.cellOf(p.x, p.y, p.z)
    let best = Infinity
    let bestTri = -1
    let bu = 0
    let bv = 0
    const maxRing = Math.max(this.dims[0], this.dims[1], this.dims[2])
    // How far outside the grid the query is — rings closer than that are empty.
    const outside = this.bounds.distanceToPoint(p)
    // How far the query is from the nearest wall of its own cell. Anything
    // in ring r is at least (r - 1) cells plus this far away, so a hit in the
    // query's own cell that is nearer than its walls is already the answer.
    // Queries here are nearly all a step off the surface, so that is most of
    // them, and they skip the 26 neighbours a looser bound always searched.
    const min = this.bounds.min
    const fx = (p.x - min.x) / this.cell - cx
    const fy = (p.y - min.y) / this.cell - cy
    const fz = (p.z - min.z) / this.cell - cz
    const wall = Math.max(0, Math.min(fx, 1 - fx, fy, 1 - fy, fz, 1 - fz)) * this.cell
    const stamp = ++this.query
    for (let ring = 0; ring <= maxRing; ring++) {
      const reach = ring === 0 ? 0 : Math.max((ring - 1) * this.cell + wall, outside)
      if (bestTri >= 0 && reach * reach > best) break
      for (let z = cz - ring; z <= cz + ring; z++) {
        if (z < 0 || z >= this.dims[2]) continue
        for (let y = cy - ring; y <= cy + ring; y++) {
          if (y < 0 || y >= this.dims[1]) continue
          for (let x = cx - ring; x <= cx + ring; x++) {
            if (x < 0 || x >= this.dims[0]) continue
            // Only the shell of this ring; the inside was searched already.
            if (Math.abs(x - cx) !== ring && Math.abs(y - cy) !== ring && Math.abs(z - cz) !== ring) continue
            const c = this.flat(x, y, z)
            for (let k = this.starts[c]!; k < this.starts[c + 1]!; k++) {
              const tri = this.items[k]!
              if (this.stamps[tri] === stamp) continue
              this.stamps[tri] = stamp
              const d = this.triangleDistance(tri, p)
              if (d < best) {
                best = d
                bestTri = tri
                bu = scratch.u
                bv = scratch.v
              }
            }
          }
        }
      }
    }
    if (bestTri < 0) {
      out.point.copy(p)
      out.normal.set(0, 0, 1)
      return out
    }
    const ia = this.index[bestTri * 3]! * 3
    const ib = this.index[bestTri * 3 + 1]! * 3
    const ic = this.index[bestTri * 3 + 2]! * 3
    const w = 1 - bu - bv
    const P = this.positions
    const N = this.normals
    out.point.set(
      P[ia]! * w + P[ib]! * bu + P[ic]! * bv,
      P[ia + 1]! * w + P[ib + 1]! * bu + P[ic + 1]! * bv,
      P[ia + 2]! * w + P[ib + 2]! * bu + P[ic + 2]! * bv,
    )
    out.normal.set(
      N[ia]! * w + N[ib]! * bu + N[ic]! * bv,
      N[ia + 1]! * w + N[ib + 1]! * bu + N[ic + 1]! * bv,
      N[ia + 2]! * w + N[ib + 2]! * bu + N[ic + 2]! * bv,
    )
    // Vertex normals that disagree across a triangle (a crease, a mesh that
    // never had normals worth the name) can average to nothing. The face
    // itself always has a direction.
    if (out.normal.lengthSq() < 1e-6) {
      faceA.set(P[ib]! - P[ia]!, P[ib + 1]! - P[ia + 1]!, P[ib + 2]! - P[ia + 2]!)
      faceB.set(P[ic]! - P[ia]!, P[ic + 1]! - P[ia + 1]!, P[ic + 2]! - P[ia + 2]!)
      out.normal.crossVectors(faceA, faceB)
      if (out.normal.lengthSq() < 1e-20) out.normal.set(0, 0, 1)
    }
    out.normal.normalize()
    return out
  }

  /**
   * Every place the line `o + t·d` crosses the surface for `t` in
   * `[t0, t1]`, as values of `t`, into `out` (cleared first, unsorted).
   *
   * Walks the grid along the segment and tests only the triangles in the
   * cells it passes and their neighbours, so a short segment near the
   * surface costs a few dozen triangle tests however big the model is.
   */
  crossings(o: THREE.Vector3, d: THREE.Vector3, t0: number, t1: number, out: number[]): number[] {
    out.length = 0
    const stamp = ++this.query
    const step = this.cell * 0.5
    const steps = Math.max(1, Math.ceil((t1 - t0) / step))
    const P = this.positions
    for (let k = 0; k <= steps; k++) {
      const t = t0 + ((t1 - t0) * k) / steps
      const [cx, cy, cz] = this.cellOf(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t)
      for (let z = cz - 1; z <= cz + 1; z++) {
        if (z < 0 || z >= this.dims[2]) continue
        for (let y = cy - 1; y <= cy + 1; y++) {
          if (y < 0 || y >= this.dims[1]) continue
          for (let x = cx - 1; x <= cx + 1; x++) {
            if (x < 0 || x >= this.dims[0]) continue
            const c = this.flat(x, y, z)
            for (let q = this.starts[c]!; q < this.starts[c + 1]!; q++) {
              const tri = this.items[q]!
              if (this.stamps[tri] === stamp) continue
              this.stamps[tri] = stamp
              const hit = rayTriangle(
                o,
                d,
                P,
                this.index[tri * 3]! * 3,
                this.index[tri * 3 + 1]! * 3,
                this.index[tri * 3 + 2]! * 3,
                -Infinity,
              )
              if (hit >= t0 && hit <= t1) out.push(hit)
            }
          }
        }
      }
    }
    return out
  }

  /**
   * Where a line from the object's centre out along `direction` leaves it —
   * the outermost crossing of the surface that way. What an azimuth and an
   * elevation mean on an object nobody has a coordinate system for.
   *
   * A real ray, not the nearest point to somewhere far off in that
   * direction. On a lemon the two are the same point; on a model they are
   * not, and the nearest point to a far one is whatever sticks out furthest
   * — a wing tip, a fingertip, the rim of a cup — so every sticker ended up
   * on an edge of the model instead of in front of its centre. Run once per
   * sticker placement, so a pass over every triangle costs nothing that
   * matters.
   */
  outermost(direction: THREE.Vector3, out: SurfaceHit): SurfaceHit {
    const d = direction.clone().normalize()
    const o = this.center
    const P = this.positions
    let best = -Infinity
    let bestTri = -1
    for (let t = 0; t < this.index.length / 3; t++) {
      const hit = rayTriangle(
        o,
        d,
        P,
        this.index[t * 3]! * 3,
        this.index[t * 3 + 1]! * 3,
        this.index[t * 3 + 2]! * 3,
      )
      if (hit > best) {
        best = hit
        bestTri = t
      }
    }
    if (bestTri >= 0) {
      // Through the grid for the smooth normal at that point.
      this.closest(o.clone().addScaledVector(d, best), out)
    } else {
      // The line misses the model altogether: its middle is not where its
      // box's middle is (a butterfly's body, a ring). Take the part of it
      // nearest that line, and of those the one furthest out along it —
      // "in front, a little up" still means the front of whatever is there.
      let bestOff = Infinity
      for (let k = 0; k < P.length; k += 3) {
        const along = (P[k]! - o.x) * d.x + (P[k + 1]! - o.y) * d.y + (P[k + 2]! - o.z) * d.z
        if (along <= 0) continue
        const off = Math.hypot(
          P[k]! - o.x - d.x * along,
          P[k + 1]! - o.y - d.y * along,
          P[k + 2]! - o.z - d.z * along,
        )
        bestOff = Math.min(bestOff, off)
      }
      let far = -Infinity
      const at = new THREE.Vector3()
      for (let k = 0; k < P.length; k += 3) {
        const along = (P[k]! - o.x) * d.x + (P[k + 1]! - o.y) * d.y + (P[k + 2]! - o.z) * d.z
        if (along <= 0) continue
        const off = Math.hypot(
          P[k]! - o.x - d.x * along,
          P[k + 1]! - o.y - d.y * along,
          P[k + 2]! - o.z - d.z * along,
        )
        if (off <= bestOff + this.cell && along > far) {
          far = along
          at.set(P[k]!, P[k + 1]!, P[k + 2]!)
        }
      }
      if (far === -Infinity)
        at.copy(o).addScaledVector(d, this.bounds.getBoundingSphere(new THREE.Sphere()).radius * 3)
      this.closest(at, out)
    }
    // A concave object can report a normal facing inward; the sticker goes
    // on the outside.
    if (out.normal.dot(d) < 0) out.normal.negate()
    return out
  }

  /** Squared distance from p to one triangle; writes the barycentrics to `scratch`. */
  private triangleDistance(tri: number, p: THREE.Vector3): number {
    const P = this.positions
    const ia = this.index[tri * 3]! * 3
    const ib = this.index[tri * 3 + 1]! * 3
    const ic = this.index[tri * 3 + 2]! * 3
    closestOnTriangle(
      p.x,
      p.y,
      p.z,
      P[ia]!,
      P[ia + 1]!,
      P[ia + 2]!,
      P[ib]!,
      P[ib + 1]!,
      P[ib + 2]!,
      P[ic]!,
      P[ic + 1]!,
      P[ic + 2]!,
    )
    const dx = scratch.x - p.x
    const dy = scratch.y - p.y
    const dz = scratch.z - p.z
    return dx * dx + dy * dy + dz * dz
  }
}

const scratch = { x: 0, y: 0, z: 0, u: 0, v: 0 }

/**
 * Möller–Trumbore, both faces: how far along the line from `o` in `d` it
 * crosses the triangle at those offsets into `P`, or -Infinity if it does not
 * or if that is not beyond `tMin` (0: a ray, not the whole line).
 */
function rayTriangle(
  o: THREE.Vector3,
  d: THREE.Vector3,
  P: Float32Array,
  a: number,
  b: number,
  c: number,
  tMin = 0,
): number {
  const e1x = P[b]! - P[a]!
  const e1y = P[b + 1]! - P[a + 1]!
  const e1z = P[b + 2]! - P[a + 2]!
  const e2x = P[c]! - P[a]!
  const e2y = P[c + 1]! - P[a + 1]!
  const e2z = P[c + 2]! - P[a + 2]!
  const px = d.y * e2z - d.z * e2y
  const py = d.z * e2x - d.x * e2z
  const pz = d.x * e2y - d.y * e2x
  const det = e1x * px + e1y * py + e1z * pz
  if (Math.abs(det) < 1e-12) return -Infinity
  const inv = 1 / det
  const tx = o.x - P[a]!
  const ty = o.y - P[a + 1]!
  const tz = o.z - P[a + 2]!
  const u = (tx * px + ty * py + tz * pz) * inv
  if (u < 0 || u > 1) return -Infinity
  const qx = ty * e1z - tz * e1y
  const qy = tz * e1x - tx * e1z
  const qz = tx * e1y - ty * e1x
  const v = (d.x * qx + d.y * qy + d.z * qz) * inv
  if (v < 0 || u + v > 1) return -Infinity
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv
  return t > tMin ? t : -Infinity
}
const faceA = new THREE.Vector3()
const faceB = new THREE.Vector3()

/**
 * Smooth normals for a model made of many meshes, welded across its seams.
 *
 * A glTF splits its vertices wherever the UVs or the materials do, and
 * `computeVertexNormals` on that averages only the faces on one side of each
 * split, so the "smooth" normal kinks along every UV seam and a sticker laid
 * across one creases there. So the faces are summed at every POSITION, not
 * every vertex (area-weighted, the way three does it).
 *
 * Except where that sum cancels. A wing, a leaf or a flag is often modelled
 * as two faces back to back on the same positions, and welded, the front's
 * normal and the back's add up to nothing. Where the welded sum has lost most
 * of its length, the vertex keeps the normal of its own faces instead.
 *
 * `size` is the model's length, which sets how close two positions have to
 * be to count as one.
 */
export function weldedNormals(positions: Float32Array, index: Uint32Array, size: number): Float32Array {
  const count = positions.length / 3
  const quantum = Math.max(1e-9, size * 1e-5)
  const ids = new Int32Array(count)
  const seen = new Map<string, number>()
  for (let v = 0; v < count; v++) {
    const key = `${Math.round(positions[v * 3]! / quantum)},${Math.round(positions[v * 3 + 1]! / quantum)},${Math.round(positions[v * 3 + 2]! / quantum)}`
    let id = seen.get(key)
    if (id === undefined) {
      id = seen.size
      seen.set(key, id)
    }
    ids[v] = id
  }
  const welded = new Float64Array(seen.size * 3)
  const weight = new Float64Array(seen.size)
  const own = new Float64Array(count * 3)
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t]! * 3
    const b = index[t + 1]! * 3
    const c = index[t + 2]! * 3
    const ux = positions[b]! - positions[a]!
    const uy = positions[b + 1]! - positions[a + 1]!
    const uz = positions[b + 2]! - positions[a + 2]!
    const wx = positions[c]! - positions[a]!
    const wy = positions[c + 1]! - positions[a + 1]!
    const wz = positions[c + 2]! - positions[a + 2]!
    const nx = uy * wz - uz * wy
    const ny = uz * wx - ux * wz
    const nz = ux * wy - uy * wx
    const len = Math.hypot(nx, ny, nz)
    for (const k of [a, b, c]) {
      const w = ids[k / 3]!
      const id = w * 3
      welded[id] = welded[id]! + nx
      welded[id + 1] = welded[id + 1]! + ny
      welded[id + 2] = welded[id + 2]! + nz
      weight[w] = weight[w]! + len
      own[k] = own[k]! + nx
      own[k + 1] = own[k + 1]! + ny
      own[k + 2] = own[k + 2]! + nz
    }
  }
  const out = new Float32Array(count * 3)
  for (let v = 0; v < count; v++) {
    const id = ids[v]!
    const k = id * 3
    const len = Math.hypot(welded[k]!, welded[k + 1]!, welded[k + 2]!)
    const from = len > 0.35 * weight[id]! ? welded : own
    const at = from === welded ? k : v * 3
    const l = Math.hypot(from[at]!, from[at + 1]!, from[at + 2]!) || 1
    out[v * 3] = from[at]! / l
    out[v * 3 + 1] = from[at + 1]! / l
    out[v * 3 + 2] = from[at + 2]! / l
  }
  return out
}

/**
 * Ericson's closest point on a triangle (Real-Time Collision Detection
 * §5.1.5), unrolled onto scalars. Writes the point and its barycentrics
 * (weights of b and c) into `scratch`.
 */
function closestOnTriangle(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
): void {
  const abx = bx - ax,
    aby = by - ay,
    abz = bz - az
  const acx = cx - ax,
    acy = cy - ay,
    acz = cz - az
  const apx = px - ax,
    apy = py - ay,
    apz = pz - az
  const d1 = abx * apx + aby * apy + abz * apz
  const d2 = acx * apx + acy * apy + acz * apz
  const set = (u: number, v: number) => {
    scratch.u = u
    scratch.v = v
    scratch.x = ax + abx * u + acx * v
    scratch.y = ay + aby * u + acy * v
    scratch.z = az + abz * u + acz * v
  }
  if (d1 <= 0 && d2 <= 0) return void set(0, 0)
  const bpx = px - bx,
    bpy = py - by,
    bpz = pz - bz
  const d3 = abx * bpx + aby * bpy + abz * bpz
  const d4 = acx * bpx + acy * bpy + acz * bpz
  if (d3 >= 0 && d4 <= d3) return void set(1, 0)
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return void set(d1 / (d1 - d3), 0)
  const cpx = px - cx,
    cpy = py - cy,
    cpz = pz - cz
  const d5 = abx * cpx + aby * cpy + abz * cpz
  const d6 = acx * cpx + acy * cpy + acz * cpz
  if (d6 >= 0 && d5 <= d6) return void set(0, 1)
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return void set(0, d2 / (d2 - d6))
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
    return void set(1 - w, w)
  }
  const denom = 1 / (va + vb + vc)
  return void set(vb * denom, vc * denom)
}
