import * as THREE from 'three'
import type { MountSurface, SurfaceHit } from './surface'

/**
 * A sticker's footprint on a surface, laid out once and read every frame.
 *
 * A grid over the sticker's own flat coordinates — centred on it, and
 * reaching well past its edges — giving for each point the place on the
 * surface it is stuck to and the surface normal there. Everything after the
 * lay-up is a bilinear read of this, which is what keeps a curved surface
 * as cheap per frame as a flat one.
 */
export interface Wrap {
  /** Nodes per side. */
  res: number
  /** Half the domain's width and height, in the sticker's own units. */
  extent: [number, number]
  /** Host-space position of each node, row-major from (-x, -y). */
  positions: Float32Array
  /** Host-space surface normal of each node. */
  normals: Float32Array
  /** Where the sticker's centre is, and its frame there: x across, y up, n out. */
  origin: THREE.Vector3
  axisX: THREE.Vector3
  axisY: THREE.Vector3
  normal: THREE.Vector3
}

export interface WrapPlacement {
  /** Degrees around the object's vertical, 0 facing +Z. */
  azimuth: number
  /** Degrees above its equator. */
  elevation: number
  /** Degrees the sticker is turned about its own normal. */
  roll: number
}

/** The unit direction an azimuth and elevation name, in host space. */
export function placementDirection(p: Pick<WrapPlacement, 'azimuth' | 'elevation'>): THREE.Vector3 {
  const az = (p.azimuth * Math.PI) / 180
  const el = (p.elevation * Math.PI) / 180
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
}

/**
 * Lay a sticker onto a surface.
 *
 * How the flat sheet maps onto a curved one is the whole question, and a
 * doubly-curved surface has no perfect answer: paper cannot cover a sphere
 * without stretching or wrinkling. The answer here is the one hands use. Put
 * the middle down, smooth a line up through it, then smooth outward from
 * that line to both edges. In geometry that is a geodesic SPINE through the
 * centre along the sticker's y, and from every point on it a geodesic RIB
 * along x, each walked on the surface and carrying its direction with it
 * (parallel transport by projection). Lengths along the spine and along every
 * rib are exact; what little distortion there is goes into the angle between
 * them, where on a lemon-sized curve it is invisible.
 *
 * It is also cheap: one walk per row instead of one per node, so a 49×49
 * lay-up is a few thousand closest-point queries, done once.
 */
export function buildWrap(
  surface: MountSurface,
  placement: WrapPlacement,
  halfWidth: number,
  halfHeight: number,
  resolution = 49,
  /**
   * Half the sticker's own width and height, when the lay-up reaches past it
   * (so a lifted flap still has surface under it). Only this part of the
   * lay-up has to hold together; see `coherent`.
   */
  core: [number, number] = [halfWidth, halfHeight],
): Wrap {
  // A wrap is a pure function of these and is only ever read, so one laid up
  // already is handed out again: a remount, a preset switched away and back,
  // or a config edit that did not move the sticker costs nothing.
  const key = `${placement.azimuth}|${placement.elevation}|${placement.roll}|${halfWidth}|${halfHeight}|${resolution}|${core[0]}|${core[1]}`
  let cache = wrapCache.get(surface)
  if (!cache) {
    cache = new Map()
    wrapCache.set(surface, cache)
  }
  const hit = cache.get(key)
  if (hit) return hit
  const walked = layWrap(surface, placement, halfWidth, halfHeight, resolution)
  const wrap = coherent(walked, core) ? walked : projectWrap(surface, walked, core)
  if (cache.size >= WRAP_CACHE_SIZE) cache.delete(cache.keys().next().value!)
  cache.set(key, wrap)
  return wrap
}

/** Laid-up wraps per surface, dropped with it. Bounded, because a placement slider makes a new one per step. */
const wrapCache = new WeakMap<MountSurface, Map<string, Wrap>>()
const WRAP_CACHE_SIZE = 48

function layWrap(
  surface: MountSurface,
  placement: WrapPlacement,
  halfWidth: number,
  halfHeight: number,
  resolution: number,
): Wrap {
  // Odd, so there is a node exactly at the centre for the spine to start from.
  const res = resolution | 1
  const hit: SurfaceHit = { point: new THREE.Vector3(), normal: new THREE.Vector3() }
  surface.outermost(placementDirection(placement), hit)
  const origin = hit.point.clone()
  const normal = hit.normal.clone()

  // The sticker's "up" is the object's up as seen on the surface there, then
  // turned by roll. At a pole that projection vanishes, so fall back to +Z.
  const up = new THREE.Vector3(0, 1, 0)
  if (Math.abs(up.dot(normal)) > 0.97) up.set(0, 0, 1)
  const axisY = up.addScaledVector(normal, -up.dot(normal)).normalize()
  axisY.applyAxisAngle(normal, (placement.roll * Math.PI) / 180)
  const axisX = new THREE.Vector3().crossVectors(axisY, normal).normalize()

  const extent: [number, number] = [halfWidth, halfHeight]
  const positions = new Float32Array(res * res * 3)
  const normals = new Float32Array(res * res * 3)
  const mid = (res - 1) / 2
  const dx = (2 * halfWidth) / (res - 1)
  const dy = (2 * halfHeight) / (res - 1)

  const write = (i: number, j: number, p: THREE.Vector3, n: THREE.Vector3) => {
    const k = (j * res + i) * 3
    positions[k] = p.x
    positions[k + 1] = p.y
    positions[k + 2] = p.z
    normals[k] = n.x
    normals[k + 1] = n.y
    normals[k + 2] = n.z
  }

  // The spine, both ways from the centre. Each node keeps the transported
  // x direction too, which is where its rib sets off.
  const spineP: THREE.Vector3[] = new Array(res)
  const spineN: THREE.Vector3[] = new Array(res)
  const spineX: THREE.Vector3[] = new Array(res)
  spineP[mid] = origin.clone()
  spineN[mid] = normal.clone()
  spineX[mid] = axisX.clone()
  for (const sign of [1, -1]) {
    const walker = new Walker(surface, origin, normal, axisY.clone().multiplyScalar(sign), axisX)
    for (let j = mid + sign; j >= 0 && j < res; j += sign) {
      walker.walk(dy)
      spineP[j] = walker.p.clone()
      spineN[j] = walker.n.clone()
      spineX[j] = walker.side.clone()
    }
  }

  for (let j = 0; j < res; j++) {
    write(mid, j, spineP[j]!, spineN[j]!)
    for (const sign of [1, -1]) {
      const heading = spineX[j]!.clone().multiplyScalar(sign)
      const walker = new Walker(surface, spineP[j]!, spineN[j]!, heading, heading)
      for (let i = mid + sign; i >= 0 && i < res; i += sign) {
        walker.walk(dx)
        write(i, j, walker.p, walker.n)
      }
    }
  }

  return { res, extent, positions, normals, origin, axisX, axisY, normal }
}

/**
 * Whether a walked lay-up holds together over the sticker itself.
 *
 * On a smooth object it always does. On a model it may not: where a sticker
 * straddles a joint (a wing meeting a body, an arm meeting a torso) one rib
 * walks up the wing and the next stays on the body, and two neighbouring
 * rows of the sticker end up a hand's width apart. Drawn, that is a sticker
 * shredded into a fan. So: every pair of neighbouring nodes over the sticker
 * has to be about a step apart, and no normal on it may face away from the
 * one at its centre.
 */
function coherent(wrap: Wrap, core: [number, number]): boolean {
  const { res, extent, positions: P, normals: N, normal } = wrap
  const sx = (2 * extent[0]) / (res - 1)
  const sy = (2 * extent[1]) / (res - 1)
  const reachX = Math.ceil(core[0] / sx)
  const reachY = Math.ceil(core[1] / sy)
  const mid = (res - 1) / 2
  const i0 = Math.max(0, mid - reachX)
  const i1 = Math.min(res - 1, mid + reachX)
  const j0 = Math.max(0, mid - reachY)
  const j1 = Math.min(res - 1, mid + reachY)
  const ok = (k: number, l: number, step: number) => {
    const d = Math.hypot(P[k]! - P[l]!, P[k + 1]! - P[l + 1]!, P[k + 2]! - P[l + 2]!) / step
    return d > 0.6 && d < 1.6
  }
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const k = (j * res + i) * 3
      if (N[k]! * normal.x + N[k + 1]! * normal.y + N[k + 2]! * normal.z < 0) return false
      if (i > i0 && !ok(k, k - 3, sx)) return false
      if (j > j0 && !ok(k, k - res * 3, sy)) return false
    }
  }
  return true
}

/**
 * The lay-up for a surface that cannot be walked: the sticker PROJECTED onto
 * it from its tangent plane, the way a decal is, and then pulled taut.
 *
 * Every node is dropped straight along the normal at the sticker's centre
 * onto the nearest piece of surface under it, so neighbours cannot wander
 * apart whatever the model is made of. Then it is smoothed, never below the
 * surface: where the model dips (the crease between a wing and a body) the
 * sticker bridges the gap as vinyl does, and where the model runs out
 * entirely it carries on at the height of its neighbours, an overhang.
 *
 * What it gives up is exact lengths: on a steep slope a projection is
 * squeezed. That is why it is only the answer when walking has failed.
 */
function projectWrap(surface: MountSurface, walked: Wrap, core: [number, number]): Wrap {
  const { res, extent, origin, axisX, axisY, normal } = walked
  const count = res * res
  const reach = Math.max(core[0], core[1])
  // How far above and below the plane to look for the surface.
  const above = reach * 0.6
  const below = reach * 1.2
  const found = new Float64Array(count).fill(Number.NaN)
  const q = new THREE.Vector3()
  const down = normal.clone().negate()
  const ts: number[] = []
  const mid = (res - 1) / 2
  const sx = (2 * extent[0]) / (res - 1)
  const sy = (2 * extent[1]) / (res - 1)
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      q.copy(origin)
        .addScaledVector(axisX, (i - mid) * sx)
        .addScaledVector(axisY, (j - mid) * sy)
        .addScaledVector(normal, above)
      surface.crossings(q, down, 0, above + below, ts)
      // The piece of surface nearest the sticker's own plane.
      let best = Number.NaN
      for (const t of ts) {
        const h = above - t
        if (Number.isNaN(best) || Math.abs(h) < Math.abs(best)) best = h
      }
      found[j * res + i] = best
    }
  }

  // Where there is no surface at all, carry on from the neighbours nearer
  // the middle: rings outward from the centre, each filled from the last.
  const height = Float64Array.from(found)
  for (let ring = 1; ring <= mid; ring++) {
    for (let j = mid - ring; j <= mid + ring; j++) {
      for (let i = mid - ring; i <= mid + ring; i++) {
        if (Math.max(Math.abs(i - mid), Math.abs(j - mid)) !== ring) continue
        const k = j * res + i
        if (!Number.isNaN(height[k]!)) continue
        let sum = 0
        let n = 0
        for (const [di, dj] of [
          [Math.sign(mid - i), 0],
          [0, Math.sign(mid - j)],
          [Math.sign(mid - i), Math.sign(mid - j)],
        ] as const) {
          if (di === 0 && dj === 0) continue
          const h = height[(j + dj) * res + (i + di)]!
          if (!Number.isNaN(h)) {
            sum += h
            n++
          }
        }
        height[k] = n ? sum / n : 0
      }
    }
  }
  if (Number.isNaN(height[mid * res + mid]!)) height.fill(0)

  // Pulled taut: smoothed, but never pushed into the surface.
  const next = new Float64Array(count)
  for (let pass = 0; pass < 12; pass++) {
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const k = j * res + i
        const l = height[j * res + Math.max(0, i - 1)]!
        const r = height[j * res + Math.min(res - 1, i + 1)]!
        const d = height[Math.max(0, j - 1) * res + i]!
        const u = height[Math.min(res - 1, j + 1) * res + i]!
        const smooth = (l + r + d + u) / 4
        const floor = found[k]!
        next[k] = Number.isNaN(floor) ? smooth : Math.max(smooth, floor)
      }
    }
    height.set(next)
  }

  const positions = new Float32Array(count * 3)
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      q.copy(origin)
        .addScaledVector(axisX, (i - mid) * sx)
        .addScaledVector(axisY, (j - mid) * sy)
        .addScaledVector(normal, height[j * res + i]!)
      q.toArray(positions, (j * res + i) * 3)
    }
  }
  // Normals from the sheet itself, not the model under it: a bridge has no
  // surface under it to ask.
  const normals = new Float32Array(count * 3)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const n = new THREE.Vector3()
  const at = (i: number, j: number, out: THREE.Vector3) =>
    out.fromArray(
      positions,
      (Math.min(res - 1, Math.max(0, j)) * res + Math.min(res - 1, Math.max(0, i))) * 3,
    )
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      at(i + 1, j, a).sub(at(i - 1, j, n))
      at(i, j + 1, b).sub(at(i, j - 1, n))
      n.crossVectors(a, b).normalize()
      if (n.dot(normal) < 0) n.negate()
      n.toArray(normals, (j * res + i) * 3)
    }
  }
  return { res, extent, positions, normals, origin, axisX, axisY, normal }
}

/**
 * A point walking along a surface in a straight line — the discrete geodesic.
 * Step in the tangent direction, fall back onto the surface, and bend the
 * direction into the new tangent plane so it keeps pointing the same way.
 *
 * Two things a lemon never asks of it and any model someone uploads will.
 *
 * - SIDES. A wing, a leaf, a sheet of cloth is thin, or two faces back to
 *   back, and the nearest face to a step can be the far one, whose normal
 *   points the other way. Taken as it comes, the sticker's "out" flips half
 *   way across it and the paper folds through the model. So the walker only
 *   ever accepts a normal on the side it started on.
 * - EDGES. An open mesh ends. Past its edge the nearest point is on the edge
 *   itself, so every step lands back on it and the rest of the row piles up
 *   there, which crushes the sticker into a crumpled strip. When a step stops
 *   getting anywhere the walker has run off the surface, and from there it
 *   carries on flat in the last tangent plane it had: an overhang, which is
 *   what a sticker put over an edge does.
 */
class Walker {
  readonly p: THREE.Vector3
  readonly n: THREE.Vector3
  /** The heading. */
  private readonly v: THREE.Vector3
  /** A second direction carried along with it — the rib's heading, on the spine. */
  readonly side: THREE.Vector3
  /** Off the edge of the surface: walking flat from here on. */
  private off = false
  private readonly hit: SurfaceHit = { point: new THREE.Vector3(), normal: new THREE.Vector3() }

  constructor(
    private readonly surface: MountSurface,
    p: THREE.Vector3,
    n: THREE.Vector3,
    heading: THREE.Vector3,
    side: THREE.Vector3,
  ) {
    this.p = p.clone()
    this.n = n.clone()
    this.v = heading.clone().normalize()
    this.side = side.clone().normalize()
  }

  /** The nearest surface point to `q`, with its normal turned to this walker's side. */
  private land(q: THREE.Vector3): SurfaceHit {
    this.surface.closest(q, this.hit)
    if (this.hit.normal.dot(this.n) < 0) this.hit.normal.negate()
    return this.hit
  }

  walk(distance: number): void {
    // Substeps: a step much longer than the surface's radius of curvature
    // would cut a chord through the object.
    const steps = Math.max(1, Math.ceil(distance / 0.012))
    const h = distance / steps
    for (let s = 0; s < steps; s++) {
      if (this.off) {
        this.p.addScaledVector(this.v, h)
        continue
      }
      const target = this.p.clone().addScaledVector(this.v, h)
      const hit = this.land(target)
      // Keep the step length honest: projecting onto a convex surface
      // shortens it, so rescale the move to h along the surface.
      const moved = hit.point.clone().sub(this.p)
      const len = moved.length()
      // Barely moved, or jumped much further than a step (across a gap, onto
      // another part of the model): off the edge. A sharp corner is neither:
      // the step lands on the edge, the heading bends over it, and the next
      // one carries on down the far face.
      if (len < 0.3 * h || len > 2.5 * h) {
        this.off = true
        this.p.copy(target)
        continue
      }
      this.p.addScaledVector(moved, h / len)
      this.land(this.p)
      // Re-landing a step away is only honest if it stayed near the step.
      if (hit.point.distanceTo(this.p) > 0.7 * h) {
        this.off = true
        continue
      }
      this.p.copy(hit.point)
      this.n.copy(hit.normal)
      this.v.addScaledVector(this.n, -this.v.dot(this.n)).normalize()
      this.side.addScaledVector(this.n, -this.side.dot(this.n)).normalize()
    }
  }
}

/**
 * Where a point of the sticker's flat space lands on the surface, and the
 * normal there. Bilinear inside the lay-up; outside it, carried on flat
 * along the edge's tangent, which is only ever reached by a sheet flying
 * clear of the object.
 */
export function sampleWrap(wrap: Wrap, x: number, y: number, outP: THREE.Vector3, outN: THREE.Vector3): void {
  const { res, extent, positions: P, normals: N } = wrap
  const fx = ((x + extent[0]) / (2 * extent[0])) * (res - 1)
  const fy = ((y + extent[1]) / (2 * extent[1])) * (res - 1)
  const cx = Math.min(res - 1, Math.max(0, fx))
  const cy = Math.min(res - 1, Math.max(0, fy))
  const i0 = Math.min(res - 2, Math.floor(cx))
  const j0 = Math.min(res - 2, Math.floor(cy))
  const tx = cx - i0
  const ty = cy - j0
  const k00 = (j0 * res + i0) * 3
  const k10 = k00 + 3
  const k01 = k00 + res * 3
  const k11 = k01 + 3
  const w00 = (1 - tx) * (1 - ty)
  const w10 = tx * (1 - ty)
  const w01 = (1 - tx) * ty
  const w11 = tx * ty
  outP.set(
    P[k00]! * w00 + P[k10]! * w10 + P[k01]! * w01 + P[k11]! * w11,
    P[k00 + 1]! * w00 + P[k10 + 1]! * w10 + P[k01 + 1]! * w01 + P[k11 + 1]! * w11,
    P[k00 + 2]! * w00 + P[k10 + 2]! * w10 + P[k01 + 2]! * w01 + P[k11 + 2]! * w11,
  )
  outN
    .set(
      N[k00]! * w00 + N[k10]! * w10 + N[k01]! * w01 + N[k11]! * w11,
      N[k00 + 1]! * w00 + N[k10 + 1]! * w10 + N[k01 + 1]! * w01 + N[k11 + 1]! * w11,
      N[k00 + 2]! * w00 + N[k10 + 2]! * w10 + N[k01 + 2]! * w01 + N[k11 + 2]! * w11,
    )
    .normalize()
  const ox = (fx - cx) * ((2 * extent[0]) / (res - 1))
  const oy = (fy - cy) * ((2 * extent[1]) / (res - 1))
  if (ox !== 0 || oy !== 0) {
    // Off the edge: continue along the local tangents of the edge cell.
    const ax = (P[k10]! - P[k00]!) / ((2 * extent[0]) / (res - 1))
    const ay = (P[k10 + 1]! - P[k00 + 1]!) / ((2 * extent[0]) / (res - 1))
    const az = (P[k10 + 2]! - P[k00 + 2]!) / ((2 * extent[0]) / (res - 1))
    const bx = (P[k01]! - P[k00]!) / ((2 * extent[1]) / (res - 1))
    const by = (P[k01 + 1]! - P[k00 + 1]!) / ((2 * extent[1]) / (res - 1))
    const bz = (P[k01 + 2]! - P[k00 + 2]!) / ((2 * extent[1]) / (res - 1))
    outP.x += ax * ox + bx * oy
    outP.y += ay * ox + by * oy
    outP.z += az * ox + bz * oy
  }
}

const shellP = new THREE.Vector3()
const shellN = new THREE.Vector3()

/**
 * Carry a sheet's flat-space positions onto the surface, in place.
 *
 * A point at (x, y) and height z above the flat sheet goes to the surface
 * point that (x, y) was laid on, z along the normal there — a SHELL map. It
 * is what makes every deformer work on a curved object without knowing one
 * exists: a peel worked out above a plane is the same peel above a lemon,
 * with its flap riding the curvature of the skin it came off. `gap` lifts the
 * whole sheet a hair off the surface so the two never fight for a pixel.
 */
export function shellMap(wrap: Wrap, positions: Float32Array, count: number, gap: number): void {
  for (let v = 0; v < count; v++) {
    const i3 = v * 3
    const z = positions[i3 + 2]! + gap
    sampleWrap(wrap, positions[i3]!, positions[i3 + 1]!, shellP, shellN)
    positions[i3] = shellP.x + shellN.x * z
    positions[i3 + 1] = shellP.y + shellN.y * z
    positions[i3 + 2] = shellP.z + shellN.z * z
  }
}

/** One point through the shell map — handles, strands, anything that is not the mesh. */
export function shellPoint(wrap: Wrap, point: THREE.Vector3, gap: number): THREE.Vector3 {
  const z = point.z + gap
  sampleWrap(wrap, point.x, point.y, shellP, shellN)
  return point.copy(shellP).addScaledVector(shellN, z)
}
