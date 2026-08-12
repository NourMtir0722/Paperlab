import { z } from 'zod'
import type { Deformer } from './types'

export const crumpleOptionsSchema = z.object({
  /** How crushed, 0..1. Peak-to-peak height, and it drives the pull too. */
  amount: z.number().min(0).max(1).default(0.35),
  /** Facets per world unit. Higher is finer, and needs more segments to resolve. */
  scale: z.number().min(0.5).max(8).default(3),
  /**
   * How much the sheet draws in on itself. Crumpled paper occupies a smaller
   * footprint than flat paper; without this it reads as an embossed sheet
   * rather than a crushed one.
   */
  pull: z.number().min(0).max(1).default(0.4),
  /** A different crush of the same paper. */
  seed: z.number().int().min(0).max(7).default(0),
})

export type CrumpleOptions = z.infer<typeof crumpleOptionsSchema>

/**
 * GLSL's `mod`, which is not JS's `%`.
 *
 * `%` keeps the sign of the dividend, so a cell at a negative coordinate
 * hashes to a different bucket on the two paths — and the sheet is centred on
 * the origin, so HALF of every sheet is at a negative coordinate. Mirroring
 * `x - y·floor(x/y)` is the whole reason the two halves agree.
 */
function mod(x: number, y: number): number {
  return x - y * Math.floor(x / y)
}

/**
 * Where the feature point of a cell sits, 0..1 within it.
 *
 * Deliberately integer arithmetic on small numbers rather than the usual
 * `fract(sin(dot(…)) * 43758.5)` hash: that one takes the sine of a large
 * argument and multiplies the result by forty thousand, which turns a
 * last-bit difference between a CPU and a GPU into a completely different
 * number. Every product here stays under 2^13, which is exact in float32 and
 * in a double alike, so the two implementations land on the same point rather
 * than on nearby ones. The pattern repeats every 64 cells — far outside any
 * sheet you would put on screen.
 */
function jitter(cx: number, cy: number, seed: number): [number, number] {
  const hx = mod(cx * 37 + cy * 17 + seed * 5, 64)
  const hy = mod(cx * 23 + cy * 41 + seed * 11, 64)
  return [0.2 + (0.6 * mod(hx * 13, 7)) / 6, 0.2 + (0.6 * mod(hy * 29, 11)) / 10]
}

/**
 * `F2 − F1` tops out at 0.9315 of a cell on this jitter (measured across
 * every seed and the whole `scale` range), so this brings the field back to
 * ±amount/2 — `amount` is then a peak-to-peak height you can reason about
 * rather than an arbitrary knob. `crumple.test.ts` holds the bound.
 */
const NORM = 0.5366

/** Which way a cell's facet is pushed — half up, half down. */
function cellSign(cx: number, cy: number, seed: number): number {
  return 1 - 2 * mod(cx * 11 + cy * 7 + seed * 3, 2)
}

/**
 * Paper that has been handled.
 *
 * Six deformers and not one of them crushed a sheet — `wave` and `fold` were
 * the nearest and neither reads as crumpled. This is the missing primitive.
 *
 * The field is a jittered grid of cells, each pushed up or down, with the
 * height going to zero exactly on the boundary between them: `F2 − F1`, the
 * gap between the two nearest cell points, signed per cell. That vanishes on
 * every boundary, so the sheet stays continuous, and its gradient flips
 * across one — which is a crease. The result is an irregular polygonal
 * network of facets alternating toward and away from you, which is what a
 * sheet crushed in a fist actually is.
 *
 * **The normals matter more than the displacement here**, and getting there
 * took three tries worth recording. Three summed triangle waves: periodic,
 * an egg-crate. Plain distance-to-nearest (`F1`): irregular but smooth cone
 * tips, so it read as hammered metal. Only creases with a sign change across
 * them shade like paper.
 *
 * Both normal paths agree with that: the hero path averages vertex normals
 * over a dense grid, the field path probes two tangents a hundredth of a
 * sheet apart. Both need facets several segments wide, which is why this asks
 * for more geometry than anything else in the set.
 */
export const crumple: Deformer<CrumpleOptions> = {
  id: 'crumple',
  label: 'Crumple',
  defaults: crumpleOptionsSchema.parse({}),
  optionsSchema: crumpleOptionsSchema,
  // The most expensive deformer here, and unavoidably so: a crease the grid
  // cannot resolve is a smooth bump, and a sheet of smooth bumps is not a
  // crumple. Below roughly this, `scale` stops meaning anything.
  geometry: { minSegments: 72 },
  displace(out, _uv, o) {
    if (o.amount === 0) return
    const qx = out.x * o.scale
    const qy = out.y * o.scale
    const gx = Math.floor(qx)
    const gy = Math.floor(qy)

    // Nearest and second-nearest cell point, and which cell won.
    let f1 = 1e9
    let f2 = 1e9
    let winX = gx
    let winY = gy
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = gx + dx
        const cy = gy + dy
        const [jx, jy] = jitter(cx, cy, o.seed)
        const ex = cx + jx - qx
        const ey = cy + jy - qy
        const dist = Math.sqrt(ex * ex + ey * ey)
        if (dist < f1) {
          f2 = f1
          f1 = dist
          winX = cx
          winY = cy
        } else if (dist < f2) {
          f2 = dist
        }
      }
    }

    // Zero on every cell boundary, so the sheet never tears; the sign flips
    // as you cross one, which is what makes the boundary a crease.
    out.z += cellSign(winX, winY, o.seed) * (f2 - f1) * o.amount * NORM
    // Drawing in happens after the cell lookup reads the flat position, so
    // both implementations hash the same cell.
    const pull = 1 - o.amount * o.pull * 0.35
    out.x *= pull
    out.y *= pull
  },
  glsl: {
    chunk: /* glsl */ `
vec2 FN_jitter(float cx, float cy, float seed) {
  float hx = mod(cx * 37.0 + cy * 17.0 + seed * 5.0, 64.0);
  float hy = mod(cx * 23.0 + cy * 41.0 + seed * 11.0, 64.0);
  return vec2(0.2 + 0.6 * mod(hx * 13.0, 7.0) / 6.0, 0.2 + 0.6 * mod(hy * 29.0, 11.0) / 10.0);
}

float FN_sign(float cx, float cy, float seed) {
  return 1.0 - 2.0 * mod(cx * 11.0 + cy * 7.0 + seed * 3.0, 2.0);
}

void FN(inout vec3 p, vec2 uv, float t) {
  if (U_amount == 0.0) return;
  vec2 flat2 = p.xy;
  vec2 q = flat2 * U_scale;
  vec2 g = floor(q);

  float f1 = 1e9;
  float f2 = 1e9;
  vec2 win = g;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 c = g + vec2(float(dx), float(dy));
      float dist = length(c + FN_jitter(c.x, c.y, U_seed) - q);
      if (dist < f1) { f2 = f1; f1 = dist; win = c; }
      else if (dist < f2) { f2 = dist; }
    }
  }

  p.z += FN_sign(win.x, win.y, U_seed) * (f2 - f1) * U_amount * ${NORM};
  float pull = 1.0 - U_amount * U_pull * 0.35;
  p.xy = flat2 * pull;
}
`,
    // `amount` drives both the height and the pull, so a field instance's
    // bias scales the whole crush rather than half of it.
    strength: 'amount',
    uniforms: (o) => ({ amount: o.amount, scale: o.scale, pull: o.pull, seed: o.seed }),
  },
}
