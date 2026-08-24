import type { WashConfig } from '../config/schema'

/**
 * Painting a watercolour wash.
 *
 * Five things separate watercolour from a soft gradient, and this paints
 * four of them deliberately. In the order they matter:
 *
 * 1. **Edge darkening.** Pigment migrates to the boundary of a pool as the
 *    water retreats and dries there in a ring. It is the signature of the
 *    medium — without it any amount of blur reads as an airbrush — and it is
 *    the one effect a radial gradient cannot fake, because the ring follows
 *    the pool's own irregular outline rather than a circle.
 * 2. **An irregular wet edge.** A pool is not a disc. Its outline is a few
 *    low harmonics riding on a radius, which is what makes lobes rather than
 *    the even scallops a single frequency gives.
 * 3. **Glazing.** Two washes over each other are darker than either, and a
 *    different hue from both. `multiply` is not a stylistic choice here; it
 *    is what transparent pigment over transparent pigment does.
 * 4. **Granulation.** Heavy pigment settles into the tooth of the paper and
 *    leaves it speckled. Confined to where there IS pigment — speckling the
 *    whole sheet would be a dirty scan, not a granulating wash.
 *
 * The fifth is the paper, and this file does not paint it: the wash goes on
 * over the stock's own colour, and the surface shader's grain and aging run
 * later over everything. That ordering is the point of washing UNDER the
 * content rather than compositing a picture on top of it.
 */

/**
 * Deterministic PRNG, so a seed paints the same wash forever.
 *
 * A preset that repainted itself differently on every mount would be a
 * different artwork each time the component remounted, and no screenshot,
 * share link or export would agree with any other.
 */
function mulberry32(seed: number): () => number {
  let a = seed * 0x6d2b79f5 + 0x9e3779b9
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** `#rrggbb` → `rgba(r, g, b, alpha)`. Anything unparseable paints as grey. */
function rgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const n = m ? Number.parseInt(m[1]!, 16) : 0x808080
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, alpha))})`
}

/**
 * A pool's outline, as three harmonics on a radius.
 *
 * Two would read as an ellipse and one gives a flower; three is where it
 * stops looking generated.
 *
 * Drawn from a shape decided ONCE per pool rather than from the generator,
 * because the fill, the dried edge and the granulation clip are three passes
 * over the SAME pool. Re-rolling the outline for each of them was drawing a
 * rim that belonged to a different shape than the one it was supposed to be
 * the rim of — which is why the first version had thin wandering lines
 * across it that read as pen, not pigment.
 */
interface BloomShape {
  phase: [number, number, number]
  amp: [number, number, number]
}

function bloomShape(rng: () => number): BloomShape {
  return {
    phase: [rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2],
    amp: [0.18 + rng() * 0.1, 0.09 + rng() * 0.06, 0.05 + rng() * 0.04],
  }
}

/**
 * The outline, or an arc of it.
 *
 * `from`/`to` are turns, 0..1. A whole pool is one closed path; its dried
 * edge is drawn as several arcs instead, because pigment does not dry evenly
 * all the way round — a pool that sat against a tilt leaves a heavy rim on
 * one side and almost none on the other, and a rim of uniform weight is the
 * tell that a wash was generated rather than painted.
 */
function bloomPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  shape: BloomShape,
  from = 0,
  to = 1,
): void {
  const { phase, amp } = shape
  const STEPS = Math.max(6, Math.round(72 * (to - from)))
  ctx.beginPath()
  for (let i = 0; i <= STEPS; i++) {
    const t = (from + ((to - from) * i) / STEPS) * Math.PI * 2
    const wobble =
      amp[0]! * Math.sin(2 * t + phase[0]!) +
      amp[1]! * Math.sin(3 * t + phase[1]!) +
      amp[2]! * Math.sin(5 * t + phase[2]!)
    const r = radius * (1 + wobble)
    const x = cx + Math.cos(t) * r
    const y = cy + Math.sin(t) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  if (from === 0 && to === 1) ctx.closePath()
}

/**
 * Whether this canvas can blur.
 *
 * `ctx.filter` is how the wet edge is made, and where it is missing every
 * pool would come out cut with scissors. Detected rather than assumed
 * because the answer differs between a browser and a headless canvas, and a
 * wash is not worth throwing a render away over: without it the fill still
 * lands, just harder-edged.
 */
function canBlur(ctx: CanvasRenderingContext2D): boolean {
  if (!('filter' in ctx)) return false
  const before = ctx.filter
  try {
    ctx.filter = 'blur(2px)'
    const worked = ctx.filter !== 'none' && ctx.filter !== before
    ctx.filter = before
    return worked
  } catch {
    return false
  }
}

export function paintWash(ctx: CanvasRenderingContext2D, w: number, h: number, wash: WashConfig): void {
  const rng = mulberry32(wash.seed + 1)
  const short = Math.min(w, h)
  const blurs = canBlur(ctx)

  ctx.save()
  // Transparent pigment over transparent pigment. Two pools crossing are
  // darker than either and a third hue; on the stock alone a pool tints the
  // paper rather than covering it.
  ctx.globalCompositeOperation = 'multiply'

  for (let i = 0; i < wash.blooms; i++) {
    const pigment = i % 2 === 0 ? wash.color : wash.secondary
    // Pools are allowed off the edge. A wash that stops politely inside the
    // sheet reads as a printed shape; one that runs off it reads as paint.
    const cx = (rng() * 1.5 - 0.25) * w
    const cy = (rng() * 1.5 - 0.25) * h
    const radius = short * wash.spread * (0.28 + rng() * 0.34)
    const alpha = wash.intensity * (0.35 + rng() * 0.4)

    // Decided before any pass draws, so all three describe one pool.
    const shape = bloomShape(rng)

    ctx.save()
    if (blurs) ctx.filter = `blur(${(2 + wash.bleed * 26) * (0.6 + rng() * 0.8)}px)`

    // The body of the pool. The gradient's centre is offset from the shape's,
    // because water pools to one side as it dries rather than evenly.
    const gx = cx + (rng() - 0.5) * radius * 0.5
    const gy = cy + (rng() - 0.5) * radius * 0.5
    const grad = ctx.createRadialGradient(gx, gy, radius * 0.05, gx, gy, radius * 1.15)
    grad.addColorStop(0, rgba(pigment, alpha * 0.55))
    grad.addColorStop(0.62, rgba(pigment, alpha))
    grad.addColorStop(1, rgba(pigment, alpha * 0.75))
    ctx.fillStyle = grad
    bloomPath(ctx, cx, cy, radius, shape)
    ctx.fill()

    // The dried edge, following the pool's OWN outline rather than a circle,
    // and unevenly — heavy on one side, nearly absent on another.
    if (wash.edge > 0) {
      if (blurs) ctx.filter = `blur(${(1.5 + wash.bleed * 9) * (0.6 + rng() * 0.6)}px)`
      ctx.lineWidth = Math.max(1, radius * (0.03 + wash.edge * 0.05))
      const arcs = 5
      // Arcs overlap slightly so the seams between them do not read as gaps.
      const overlap = 0.4 / arcs
      for (let a = 0; a < arcs; a++) {
        ctx.strokeStyle = rgba(pigment, alpha * wash.edge * (0.15 + rng() * 1.05))
        bloomPath(ctx, cx, cy, radius, shape, a / arcs, (a + 1) / arcs + overlap)
        ctx.stroke()
      }
    }
    ctx.restore()

    // Pigment in the tooth of the paper, kept inside the pool it settled out
    // of. Speckling the whole sheet would be a dirty scan, not granulation.
    if (wash.granulation > 0) {
      ctx.save()
      bloomPath(ctx, cx, cy, radius, shape)
      ctx.clip()
      const grains = Math.round(wash.granulation * 900)
      ctx.fillStyle = rgba(pigment, wash.granulation * alpha * 0.5)
      for (let g = 0; g < grains; g++) {
        const a = rng() * Math.PI * 2
        // sqrt keeps the scatter even across the disc instead of crowding
        // the centre, which is where a uniform radius puts everything.
        const d = Math.sqrt(rng()) * radius
        const size = 1 + rng() * (short * 0.004)
        ctx.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, size, size)
      }
      ctx.restore()
    }
  }

  ctx.restore()
}
