import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** Long axis, host units, before `mount.size` scales it. The fruit lies along +Y, stem up. */
export const LEMON_LENGTH = 1

/** Deterministic hash noise, so the same seed grows the same fruit on every machine. */
function hash(x: number, y: number, z: number, seed: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 19.19) * 43758.5453
  return s - Math.floor(s)
}

function valueNoise(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const iz = Math.floor(z)
  const fx = x - ix
  const fy = y - iy
  const fz = z - iz
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const sz = fz * fz * (3 - 2 * fz)
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  const c = (dx: number, dy: number, dz: number) => hash(ix + dx, iy + dy, iz + dz, seed)
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), sx), lerp(c(0, 1, 0), c(1, 1, 0), sx), sy),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), sx), lerp(c(0, 1, 1), c(1, 1, 1), sx), sy),
    sz,
  )
}

export interface LemonShape {
  /** Waist against length. A Eureka is about 0.7; a Meyer is rounder. */
  girth: number
  /** How far the blossom end draws out into its nipple, 0..1. */
  nipple: number
  /** Irregularity of the body — no fruit is a solid of revolution. */
  lumps: number
  seed: number
}

/**
 * A lemon, built rather than scanned.
 *
 * The silhouette is what makes a lemon a lemon and not an egg: a prolate body
 * that pinches at BOTH ends, a pointed nipple at the blossom end and a
 * smaller button where the stem was, and neither end on the axis the other
 * one is on. The profile is a superellipse for the body with a Gaussian
 * drawn out of each pole; the lumps are low-frequency noise pushed along the
 * normal, which is what stops the highlight sliding round it like a
 * billiard ball.
 *
 * The skin's pores are NOT in this geometry. They are a thousandth of the
 * fruit's size, which is a normal's job and not a vertex's — see `skin.ts`.
 */
export function createLemonGeometry(shape: LemonShape, detail = 1): THREE.BufferGeometry {
  const widthSegments = Math.round(160 * detail)
  const heightSegments = Math.round(128 * detail)
  const sphere = new THREE.SphereGeometry(1, widthSegments, heightSegments)
  sphere.deleteAttribute('uv')
  sphere.deleteAttribute('normal')
  const geometry = mergeVertices(sphere)
  sphere.dispose()

  const half = LEMON_LENGTH / 2
  const girth = half * shape.girth
  const pos = geometry.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const t = THREE.MathUtils.clamp(v.y, -1, 1)
    const ring = Math.hypot(v.x, v.z)
    const cx = ring > 1e-9 ? v.x / ring : 0
    const cz = ring > 1e-9 ? v.z / ring : 0

    const at = Math.abs(t)
    // Body: an ellipse drawn in toward both ends — the exponent over 0.5 is
    // what tapers a lemon where an egg stays round — with a slightly fuller
    // shoulder toward the stem.
    let radius = girth * (1 - at * at) ** 0.68 * (1 + 0.04 * t)
    // Both poles draw out. The blossom end (t < 0) into a real nipple, the
    // stem end into a low button — the asymmetry is most of the likeness.
    // Only the last few rings move, so the nipple is narrow and the body
    // runs into it with a waist rather than a cone.
    const pole = t < 0 ? shape.nipple : shape.nipple * 0.4
    const reach = Math.exp(-(((1 - at) / 0.045) ** 2))
    const y = half * t * (1 + 0.2 * pole * reach)
    radius *= 1 + 0.25 * pole * reach
    // The nipple does not sit on the axis — it leans, as a real one does.
    const lean = t < 0 ? reach * shape.nipple * 0.02 : 0

    const bumps =
      (valueNoise(v.x * 2.2, v.y * 2.2, v.z * 2.2, shape.seed) - 0.5) * 0.7 +
      (valueNoise(v.x * 5.5, v.y * 5.5, v.z * 5.5, shape.seed + 3) - 0.5) * 0.3
    radius *= 1 + bumps * shape.lumps * 0.09

    pos.setXYZ(i, cx * radius + lean, y, cz * radius)
  }
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
  return geometry
}
