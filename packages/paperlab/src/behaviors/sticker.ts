import { z } from 'zod'
import type { Behavior } from './types'
import { cornerNames } from '../deformers/curl'
import type { SheetDims } from '../deformers/types'

export const stickerOptionsSchema = z.object({
  /** 0 is stuck flat, 1 is off and gone on the air. Past 0.7 it lets go, past 0.8 it flies away. */
  progress: z.number().min(0).max(1).default(0.4),
  /** Which corner the fingernail gets under. */
  corner: z.enum(cornerNames).default('bottom-right'),
  /** Degrees the pull is turned off the corner's diagonal. The drag steers it. */
  skew: z.number().min(-40).max(40).default(0),
  /**
   * How much the glue fights, 0..1. The front holds while the pull builds,
   * then gives in a jump — stick, slip, stick — and the last edge clings
   * longest before the whole thing snaps free. 0 peels like a label that was
   * never really stuck.
   */
  tack: z.number().min(0).max(1).default(0.55),
  /** How tightly the lifted part rolls back — small is a tight curl. */
  radius: z.number().min(0.015).max(0.3).default(0.045),
  /** Degrees off the surface the flap is pulled back to. 180 lays it flat. */
  flap: z.number().min(90).max(180).default(150),
})

export type StickerOptions = z.infer<typeof stickerOptionsSchema>

/** Progress at which the last edge lets go; after it, the spring away. */
export const STICKER_RELEASE_AT = 0.7
/**
 * Progress at which the freed sticker takes off; after it, the flight out of
 * the shot. Only something stuck to an object flies — see `mount` — so on a
 * flat sheet this last stretch is the sticker held still.
 */
export const STICKER_FLY_AT = 0.8

/** How many times the glue catches on the way across. */
const TEETH = 4
/** Fraction of each catch spent slipping — short, so it reads as a jump. */
const SLIP = 0.14

const CORNER_SIGNS: Record<(typeof cornerNames)[number], [number, number]> = {
  'top-left': [-1, 1],
  'top-right': [1, 1],
  'bottom-left': [-1, -1],
  'bottom-right': [1, -1],
}

const smooth = (t: number) => t * t * (3 - 2 * t)
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))

/**
 * Where the peel front actually is for a given pull, and how hard the glue is
 * holding it there.
 *
 * Pure, on purpose. The resistance could have been a spring integrated in the
 * frame loop, but then a scrubbed timeline, a shared link and a yoyo loop
 * would each show a different peel. As a function of progress the stick-slip
 * is the same every time the same pull is asked for, it runs backwards when
 * the loop does, and a drag feels it exactly as autoplay shows it: pull
 * steadily and the front lags, lags, then jumps.
 *
 * The front never goes backwards — each catch only slows it — and it never
 * gets ahead of the pull.
 */
export function stickerFront(
  progress: number,
  tack: number,
): { front: number; tension: number; release: number; fly: number } {
  const p = clamp01(progress)
  if (p >= STICKER_FLY_AT) {
    return { front: 1, tension: 0, release: 1, fly: (p - STICKER_FLY_AT) / (1 - STICKER_FLY_AT) }
  }
  if (p >= STICKER_RELEASE_AT) {
    const t = (p - STICKER_RELEASE_AT) / (STICKER_FLY_AT - STICKER_RELEASE_AT)
    // The snap: out fast, a touch past, and settle — easeOutBack.
    const c = 1.2
    const k = t - 1
    return { front: 1, tension: 0, release: clamp01(1 + (c + 1) * k * k * k + c * k * k), fly: 0 }
  }
  const u = p / STICKER_RELEASE_AT
  const amplitude = (tack * 0.6) / TEETH
  const phase = (u * TEETH) % 1
  const catchHold = phase < 1 - SLIP ? phase / (1 - SLIP) : 1 - smooth((phase - (1 - SLIP)) / SLIP)
  let front = u - amplitude * catchHold
  let tension = tack * catchHold
  // The last edge clings: the front stops short of the end and the pull
  // builds against it until the release takes it all at once.
  const cling = 0.04 * tack
  const tail = smooth(clamp01((u - 0.8) / 0.2))
  front = Math.min(front, 1 - cling)
  tension = Math.max(tension, tack * tail)
  return { front: clamp01(front), tension: clamp01(tension), release: 0, fly: 0 }
}

/** The direction the front travels — inward from the corner, plus skew. */
export function stickerAngle(o: Pick<StickerOptions, 'corner' | 'skew'>, sheet: SheetDims): number {
  const [sx, sy] = CORNER_SIGNS[o.corner]
  return (Math.atan2(-sy * sheet.height, -sx * sheet.width) * 180) / Math.PI + o.skew
}

/**
 * A sticker coming off: the corner lifts, the glue fights, and it lets go.
 *
 * On a flat sheet it is a sticker on a table. On a `mount` it is a sticker on
 * a lemon, and nothing here changes: the lift is worked out flat, and the
 * mount wraps the answer round the object.
 */
export const sticker: Behavior<StickerOptions> = {
  id: 'sticker',
  label: 'Sticker peel',
  defaults: stickerOptionsSchema.parse({}),
  optionsSchema: stickerOptionsSchema,
  signature: ['progress', 'tack', 'corner'],
  progressParam: 'progress',
  duration: 4.6,
  loopMode: 'yoyo',
  stack(o, sheet) {
    // `fly` is not a deformer's business: it happens in the WORLD, on the
    // air, and a mount applies it (see `MountRig.fly`).
    const { front, tension, release } = stickerFront(o.progress, o.tack)
    return [
      {
        type: 'lift',
        options: {
          angle: stickerAngle(o, sheet),
          front,
          radius: o.radius,
          flap: o.flap,
          tension,
          release,
        },
      },
    ]
  },
  // The snap is not something a hand can scrub. Once the pull carries the
  // last edge off, the sticker springs away on its own clock.
  fly: (o) => stickerFront(o.progress, o.tack).fly,
  // The flight away plays out on the same clock.
  commit: { from: STICKER_RELEASE_AT * 0.985, to: 1, duration: 3 },
  handles: [
    {
      id: 'corner',
      anchor: (o) => {
        const [sx, sy] = CORNER_SIGNS[o.corner]
        return [(sx + 1) / 2, (sy + 1) / 2]
      },
      drag(local, o, sheet) {
        // The corner is in your fingers. How far it has travelled across the
        // sheet is the pull; which way it went steers the peel.
        const [sx, sy] = CORNER_SIGNS[o.corner]
        const cx = (sx * sheet.width) / 2
        const cy = (sy * sheet.height) / 2
        const base = Math.atan2(-cy, -cx)
        const half = (Math.abs(Math.cos(base)) * sheet.width + Math.abs(Math.sin(base)) * sheet.height) / 2
        const vx = local.x - cx
        const vy = local.y - cy
        const along = vx * Math.cos(base) + vy * Math.sin(base)
        // The tip of a sheet peeled back flat travels twice as fast as the
        // front does, so the corner has to cross the sheet twice over for the
        // last edge to let go. Past that the release plays on its own — see
        // `commit`.
        const progress = clamp01((along / (4 * half)) * STICKER_RELEASE_AT)
        let skew = o.skew
        if (Math.hypot(vx, vy) > 0.05 * half) {
          const turn = (Math.atan2(vy, vx) - base) * (180 / Math.PI)
          const wrapped = ((((turn + 180) % 360) + 360) % 360) - 180
          skew = Math.max(-40, Math.min(40, wrapped))
        }
        return { progress, skew }
      },
    },
  ],
}
