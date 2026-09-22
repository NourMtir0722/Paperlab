import { z } from 'zod'
import type { Deformer } from './types'
import { segmentsForArc } from '../core/tessellation'

export const liftOptionsSchema = z.object({
  /**
   * The direction the peel front TRAVELS across the sheet, degrees — the
   * same convention `angle` uses everywhere else (0 across x, 90 up y). The
   * paper behind the front, on the side it came from, is off the surface.
   */
  angle: z.number().min(-360).max(360).default(135),
  /**
   * How far the front has crossed the sheet: 0 is untouched, 1 is the last
   * of it letting go. Measured across the sheet's own extent along `angle`,
   * so 1 means the same thing on a square and on a strip.
   */
  front: z.number().min(0).max(1).default(0.4),
  /** Bend radius at the front — how tightly the lifted part rolls back. */
  radius: z.number().min(0.01).max(0.5).default(0.05),
  /**
   * Where the rolled-back flap ends up pointing, degrees off the surface.
   * 180 lays it back flat over the part still stuck down, like a page curl;
   * less than that holds it up off the sheet, the way fingers pull.
   */
  flap: z.number().min(60).max(180).default(165),
  /**
   * How hard the adhesive is holding at the front, 0..1. It lifts the stuck
   * paper just ahead of the front into a fillet and tightens the bend — the
   * visible half of the resistance before the glue lets go.
   */
  tension: z.number().min(0).max(1).default(0),
  /**
   * Once it has let go, how far it has sprung away, 0..1. Lifts the whole
   * sheet off the surface and on in the direction it was being pulled.
   */
  release: z.number().min(0).max(1).default(0),
})

export type LiftOptions = z.infer<typeof liftOptionsSchema>

const DEG = Math.PI / 180

/** The sheet's extent along `(dx, dy)`, half of it — the corners project to ±this. */
function halfExtent(dx: number, dy: number, width: number, height: number): number {
  return (Math.abs(dx) * width + Math.abs(dy) * height) / 2
}

/**
 * The sticker peel: a straight front crossing the sheet, a tight bend where
 * the paper leaves the surface, and a flap beyond it.
 *
 * `curl` wraps its corner around a cylinder forever, which is right for a
 * page and wrong for a sticker: nobody rolls a sticker into a tube, they pull
 * it back and the flap goes STRAIGHT once it has turned the bend. So this is
 * arc-then-tangent — a cylinder of `radius` up to `flap` degrees, then a
 * straight run in the direction the arc left it pointing. The front also
 * travels the full width of the sheet rather than to its middle, because a
 * sticker comes all the way off.
 *
 * The whole sheet is flat in its own space, which is what makes this
 * composable with a curved surface: `mount` maps the result onto the object,
 * and a bend that is correct above a plane is correct above a lemon.
 */
export const lift: Deformer<LiftOptions> = {
  id: 'lift',
  label: 'Lift',
  defaults: liftOptionsSchema.parse({}),
  optionsSchema: liftOptionsSchema,
  geometry: {
    minSegments: 48,
    autoSegments: (o, sheet) => segmentsForArc(Math.hypot(sheet.width, sheet.height), o.radius),
    axis: (o) => o.angle,
  },
  displace(out, _uv, o, ctx) {
    const { width, height } = ctx.sheet
    const a = o.angle * DEG
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    const half = halfExtent(dx, dy, width, height)
    const release = o.release

    // The front, and how far past it (back toward where the peel started)
    // this point is. Positive is lifted.
    const f = -half + o.front * 2 * half
    const e = out.x * dx + out.y * dy
    const s = f - e

    if (s <= 0) {
      // Still stuck down. Under tension the glue drags the paper just ahead
      // of the front up with it — a fillet rather than a crisp departure.
      const width0 = o.radius * 1.6
      out.z += o.tension * o.radius * 0.45 * Math.exp(s / width0)
    } else {
      // Tension tightens the bend: the glue is holding the front down while
      // the flap is pulled, so the paper turns the corner harder.
      const r = o.radius * (1 - 0.35 * o.tension)
      const phi = o.flap * DEG
      const z0 = out.z
      const theta = s / r
      let q: number
      let z: number
      if (theta <= phi) {
        q = (r - z0) * Math.sin(theta)
        z = r - (r - z0) * Math.cos(theta)
      } else {
        const run = s - r * phi
        q = (r - z0) * Math.sin(phi) + run * Math.cos(phi)
        z = r - (r - z0) * Math.cos(phi) + run * Math.sin(phi)
      }
      out.x += dx * (s - q)
      out.y += dy * (s - q)
      out.z = z
    }

    if (release > 0) {
      // Free: it springs off the surface, on in the direction of the pull.
      out.z += release * half * 0.3
      out.x += dx * release * half * 0.12
      out.y += dy * release * half * 0.12
    }
  },
  glsl: {
    chunk: /* glsl */ `
void FN(inout vec3 p, vec2 uv, float t) {
  // A field sheet's bias scales how far the front has got (see \`strength\`);
  // the glue and the release are part of the same peel, so they scale with it
  // and a sheet at bias 0 is flat, not flat with a fillet along one edge.
  float tension = U_tension * plBias;
  float release = U_release * plBias;
  vec2 d = U_dir;
  float half_ = (abs(d.x) * uSheet.x + abs(d.y) * uSheet.y) * 0.5;
  float f = -half_ + U_front * 2.0 * half_;
  float e = dot(p.xy, d);
  float s = f - e;
  if (s <= 0.0) {
    p.z += tension * U_radius * 0.45 * exp(s / (U_radius * 1.6));
  } else {
    float r = U_radius * (1.0 - 0.35 * tension);
    float phi = U_flap;
    float z0 = p.z;
    float theta = s / r;
    float q;
    float z;
    if (theta <= phi) {
      q = (r - z0) * sin(theta);
      z = r - (r - z0) * cos(theta);
    } else {
      float run = s - r * phi;
      q = (r - z0) * sin(phi) + run * cos(phi);
      z = r - (r - z0) * cos(phi) + run * sin(phi);
    }
    p.xy += d * (s - q);
    p.z = z;
  }
  if (release > 0.0) {
    p.z += release * half_ * 0.3;
    p.xy += d * release * half_ * 0.12;
  }
}
`,
    strength: 'front',
    uniforms: (o) => ({
      dir: [Math.cos(o.angle * DEG), Math.sin(o.angle * DEG)],
      front: o.front,
      radius: o.radius,
      flap: o.flap * DEG,
      tension: o.tension,
      release: o.release,
    }),
  },
}
