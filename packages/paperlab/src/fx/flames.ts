import type { DamageField } from './field'
import { HEAT, PRESENCE } from './field'
import type { SurfaceLocator } from './fire'

/**
 * Where a burn's flames stand, read off the field.
 *
 * Paper does not burn, the gas does. Heat
 * cooks the cellulose into gas, which burns just ABOVE the surface, rooted
 * over the char right behind the ember line — so a flame belongs on the edge
 * of the hole, where it is hot, and nowhere else. Where the heat has gone
 * there is no gas left and no flame, even if the edge still glows.
 *
 * Pure and deterministic, because flames are part of the picture a capture
 * compares: the same burn at the same step stands the same flames in the
 * same places. Anchors are spread along the rim by binning the grid — the
 * hottest edge cell in each bin — rather than taken in scan order, which
 * would put all of them on the first rows of the hole.
 */

/** One flame: where it stands, how big it is, and who it is. */
export interface FlameAnchor {
  /** Root, in world space. */
  x: number
  y: number
  z: number
  /** World units. 10–40 mm at A4, scaled by heat and by which rim it is on. */
  height: number
  width: number
  /** Stable while the cell burns, so a flame keeps its own flicker frame to frame. */
  seed: number
  /** 0..1 — how hot the paper under it is. */
  heat: number
  /** -1 on the lower rim of a hole, +1 on the upper. */
  upper: number
  /**
   * Which way the paper lies from the root, as a world-space unit vector —
   * across the rim, into the sheet. Zero where it could not be found. The
   * simulator lays its gas along the rim with this, rather than in a disc.
   */
  nx: number
  ny: number
  nz: number
}

/** 10 and 40 mm, in world units: a default sheet is one unit (210 mm) across. */
export const FLAME_HEIGHT = [10 / 210, 40 / 210] as const

/** Below this there is no gas to burn, whatever the edge is doing. */
export const FLAME_HEAT = 0.22

/**
 * The least a frame's flames may vary in height, as a coefficient of
 * variation. A ring of equal tongues — a crown — is the regularity that
 * gives a fake fire away, and it is treated as an error: a frame that comes
 * out more even than this is re-drawn with more spread (see the end of
 * `flameAnchors`), and `flames.test.ts` fails if any burn ever produces one.
 */
export const IRREGULAR = 0.4

/** A millimetre of A4, in field cells (one cell is ~3.3 mm). */
const MM = 63 / 210

const scratchA = { x: 0, y: 0, z: 0 }

interface Pick {
  cell: number
  seed: number
  /** How strong the cluster is here, 0..1. */
  cluster: number
  /** How present this flame is right now, 0..1 — flames come and go. */
  life: number
  /** Where along the rim it stands, in mm from its cell. */
  along: number
  /** A side tongue's share of its cluster's height. */
  scale: number
}

/**
 * Fill `out` with up to `max` flames for the field as it stands at `time`.
 * Returns how many. `out` is reused and grown, never shrunk.
 *
 * Not one flame per stretch of rim — that was a crown. A living, uneven
 * ring: a noise field around the rim, drifting in time, decides where the
 * fire gathers. Where it is strong there are clusters of tall tongues with
 * short ones packed beside them; where it is weak, short licks and gaps.
 * Which cells carry a flame is redrawn every fraction of a second, and each
 * flame has its own life that fades it in and out, so clusters break apart
 * and re-form rather than standing still. All of it is a pure function of
 * the field and the time: the same burn stands the same flames.
 */
export function flameAnchors(
  field: DamageField,
  locate: SurfaceLocator,
  max: number,
  out: FlameAnchor[],
  time = field.time,
): number {
  if (max <= 0 || field.frontCount === 0) return 0
  const size = field.size
  const last = size - 1
  const data = field.data

  // The rim: hot paper with a cut beside it.
  const rim: number[] = []
  let cx = 0
  let cy = 0
  for (let y = 1; y < last; y++) {
    for (let x = 1; x < last; x++) {
      const cell = y * size + x
      if (data[cell * 4 + HEAT]! < FLAME_HEAT || data[cell * 4 + PRESENCE]! < 0.5) continue
      if (
        data[(cell - 1) * 4 + PRESENCE]! >= 0.5 &&
        data[(cell + 1) * 4 + PRESENCE]! >= 0.5 &&
        data[(cell - size) * 4 + PRESENCE]! >= 0.5 &&
        data[(cell + size) * 4 + PRESENCE]! >= 0.5
      ) {
        continue
      }
      rim.push(cell)
      cx += x
      cy += y
    }
  }
  if (rim.length === 0) return 0
  cx /= rim.length
  cy /= rim.length

  // Around the rim, in order, so "along the rim" means something.
  const angle = (cell: number) => Math.atan2(((cell / size) | 0) - cy, (cell % size) - cx)
  rim.sort((a, b) => angle(a) - angle(b) || a - b)

  const picks: Pick[] = []
  for (const cell of rim) {
    const seed = hash2(cell, 1)
    const a = angle(cell)
    // The cluster field: periodic around the rim (so there is no seam where
    // the angle wraps), two octaves, drifting at two speeds.
    const cluster = clamp01(
      0.62 * noise2(Math.cos(a) * 1.6 + time * 0.42, Math.sin(a) * 1.6 - time * 0.17) +
        0.38 * noise2(Math.cos(a) * 4.1 - time * 0.73 + 7.3, Math.sin(a) * 4.1 + time * 0.31) -
        0.12,
    )
    // Which cells carry a flame is redrawn every ~0.7 s, each on its own
    // beat, so the ring is never the same two moments running.
    const epoch = Math.floor(time * 1.4 + seed * 10)
    // Most of the rim carries something: short licks where the cluster is
    // weak, but only a few cells are left bare at any moment.
    if (hash2(cell, epoch + 7) > 0.38 + 0.55 * cluster) continue
    // Each flame breathes of its own accord — most shrink and swell, and only
    // some go out entirely before coming back.
    const breath = noise1(time * 0.9 + seed * 31)
    if (breath < 0.16) continue
    const life = 0.3 + 0.7 * smoothstep(0.16, 0.5, breath)
    picks.push({ cell, seed, cluster, life, along: (hash2(cell, 5) - 0.5) * 3, scale: 1 })
    // A strong cluster packs side tongues in beside the main one.
    if (cluster > 0.5) {
      const extra = cluster > 0.72 ? 2 : 1
      for (let k = 0; k < extra; k++) {
        const side = hash2(cell, 11 + k)
        picks.push({
          cell,
          seed: hash2(cell, 21 + k),
          cluster,
          life: life * (0.6 + 0.4 * side),
          along: (side < 0.5 ? -1 : 1) * (1.5 + 3 * hash2(cell, 31 + k)),
          scale: 0.4 + 0.45 * hash2(cell, 41 + k),
        })
      }
    }
  }

  // Keep the strongest if the tier cannot afford them all — by cluster and
  // chance, never by anything that depends on how the sheet is turned.
  picks.sort((p, q) => q.cluster * 0.7 + q.seed * 0.3 - (p.cluster * 0.7 + p.seed * 0.3) || p.cell - q.cell)
  const count = Math.min(max, picks.length)

  let n = 0
  for (let i = 0; i < count; i++) {
    const pick = picks[i]!
    const cell = pick.cell
    const x = cell % size
    const y = (cell / size) | 0
    // Which way the paper lies from here, and the rim's tangent across it.
    const gx = data[(cell + 1) * 4 + PRESENCE]! - data[(cell - 1) * 4 + PRESENCE]!
    const gy = data[(cell + size) * 4 + PRESENCE]! - data[(cell - size) * 4 + PRESENCE]!
    const gl = Math.hypot(gx, gy) || 1
    const shift = (pick.along * MM) / last
    const u = x / last + (-gy / gl) * shift
    const v = y / last + (gx / gl) * shift
    const at = locate(u, v)
    if (!at) continue
    const rx = at.x
    const ry = at.y
    const rz = at.z
    const toward = locate(u + gx / gl / last, v + gy / gl / last)
    let upper = 0
    scratchA.x = 0
    scratchA.y = 0
    scratchA.z = 0
    if (toward) {
      const l = Math.hypot(toward.x - rx, toward.y - ry, toward.z - rz) || 1
      scratchA.x = (toward.x - rx) / l
      scratchA.y = (toward.y - ry) / l
      scratchA.z = (toward.z - rz) / l
      upper = scratchA.y
    }
    const heat = data[cell * 4 + HEAT]!
    // Square root: the edge of a hole is rarely at full heat.
    const hot = Math.sqrt(Math.min(1, (heat - FLAME_HEAT) / 0.35))
    // Tall on the upper rim, where the gas rises over paper it is preheating;
    // short on the lower one, where it rises across the hole.
    const rim = 0.35 + 0.65 * (0.5 + 0.5 * upper)
    const base = (FLAME_HEIGHT[0] + (FLAME_HEIGHT[1] - FLAME_HEIGHT[0]) * hot) * rim
    // Tall tongues where the cluster is strong, short licks where it is weak.
    const height = base * (0.2 + 1.3 * pick.cluster ** 1.4) * (0.6 + 0.8 * pick.seed) * pick.life * pick.scale
    let anchor = out[n]
    if (!anchor) {
      anchor = { x: 0, y: 0, z: 0, height: 0, width: 0, seed: 0, heat: 0, upper: 0, nx: 0, ny: 0, nz: 0 }
      out[n] = anchor
    }
    anchor.nx = scratchA.x
    anchor.ny = scratchA.y
    anchor.nz = scratchA.z
    anchor.x = rx
    anchor.y = ry
    anchor.z = rz
    anchor.height = Math.min(FLAME_HEIGHT[1], height)
    anchor.width = anchor.height * (0.32 + 0.3 * hash2(cell, 3))
    anchor.seed = pick.seed
    anchor.heat = hot
    anchor.upper = upper
    n++
  }

  // A crown is an error: too even a ring is re-drawn with more spread.
  if (n >= 3 && variation(out, n) < IRREGULAR) {
    for (let i = 0; i < n; i++) {
      const a = out[i]!
      a.height = Math.min(FLAME_HEIGHT[1], a.height * (0.3 + 1.4 * hash2(Math.floor(a.seed * 1e6), 9)))
      a.width = a.height * (0.32 + 0.3 * hash2(Math.floor(a.seed * 1e6), 3))
    }
  }
  return n
}

/** Coefficient of variation of the first `n` heights. */
export function variation(anchors: readonly FlameAnchor[], n: number): number {
  let sum = 0
  for (let i = 0; i < n; i++) sum += anchors[i]!.height
  const mean = sum / n
  if (!(mean > 0)) return 0
  let sq = 0
  for (let i = 0; i < n; i++) sq += (anchors[i]!.height - mean) ** 2
  return Math.sqrt(sq / n) / mean
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** A seeded hash of two integers, 0..1. */
function hash2(a: number, b: number): number {
  let h = Math.imul(a ^ Math.imul(b, 0x27d4eb2d), 2654435761) >>> 0
  h ^= h >>> 15
  h = Math.imul(h, 2246822519) >>> 0
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}

/** Value noise in two dimensions. */
function noise2(x: number, y: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  let fx = x - ix
  let fy = y - iy
  fx = fx * fx * (3 - 2 * fx)
  fy = fy * fy * (3 - 2 * fy)
  const h = (i: number, j: number) => hash2(i * 73856093, j * 19349663 + 7)
  const a = h(ix, iy) + (h(ix + 1, iy) - h(ix, iy)) * fx
  const b = h(ix, iy + 1) + (h(ix + 1, iy + 1) - h(ix, iy + 1)) * fx
  return a + (b - a) * fy
}

/**
 * How much a flame has puffed up at a moment — the same function the flame
 * shader runs, so the fire light flickers WITH the flames rather than beside
 * them. Value noise, 10–15 Hz, seeded per flame: neighbours never move
 * in step, and nothing is a sine.
 */
export function flamePuff(seed: number, time: number): number {
  return 0.72 + 0.28 * noise1(time * 12.5 + seed * 37) + 0.12 * (noise1(time * 23 + seed * 11) - 0.5)
}

function hash1(n: number): number {
  const s = Math.sin(n) * 43758.5453
  return s - Math.floor(s)
}

function noise1(x: number): number {
  const i = Math.floor(x)
  let f = x - i
  f = f * f * (3 - 2 * f)
  return hash1(i) + (hash1(i + 1) - hash1(i)) * f
}
