import { z } from 'zod'
import type { Ground, WalkPath } from './path'

/**
 * Where to put the camera on a walk.
 *
 * `fitCamera` in field/framing.ts solves a different problem — get every
 * sheet inside the frustum — and solving it here would produce the neutral
 * three-quarter product shot that stage mode exists to avoid. These are
 * SHOTS: a camera stationed relative to the walking figure, framing the
 * space rather than the objects, with the vanishing point doing the work.
 */

export const shotNames = ['follow', 'lead', 'low', 'wide'] as const
export type ShotName = (typeof shotNames)[number]

export const shotSchema = z.object({
  shot: z.enum(shotNames).default('follow'),
  /** How far the camera stands off the figure along the walk, world units. */
  distance: z.number().min(0.2).max(40).default(4.5),
  /** Multiplier on the shot's natural camera height. 1 is as designed. */
  height: z.number().min(0).max(6).default(1),
  /** How far up the walk the camera looks past the figure, world units. */
  lookAhead: z.number().min(0).max(40).default(7),
  /** Sideways step off the walk line, world units. Positive is the walker's left. */
  offset: z.number().min(-20).max(20).default(0),
})

export type ShotOptions = z.infer<typeof shotSchema>

export interface StageShot {
  position: [x: number, y: number, z: number]
  target: [x: number, y: number, z: number]
}

/** Camera height per shot, as a multiple of the figure's own height. */
const EYE: Record<ShotName, number> = {
  follow: 0.95,
  lead: 0.95,
  // Down near the floor, where the banners tower — the worm's-eye of the
  // reference frames, and the cheapest way to make paper read as architecture.
  low: 0.12,
  wide: 1.1,
}

/** Where each shot aims, as a multiple of the figure's height. */
const AIM: Record<ShotName, number> = {
  follow: 0.62,
  lead: 0.62,
  low: 2.4,
  wide: 0.62,
}

/**
 * A point measured in DISTANCE along the walk rather than normalized `s`,
 * extrapolating straight past either end of an open path. Without that, a
 * following camera at the start of a walk would clamp onto the figure's own
 * feet instead of standing back off it.
 */
export function walkPoint(path: WalkPath, distance: number): Ground {
  if (path.length === 0) return path.pointAt(0)
  if (path.closed) return path.pointAt(distance / path.length)
  if (distance < 0) {
    const [x, z] = path.pointAt(0)
    const [tx, tz] = path.tangentAt(0)
    return [x + tx * distance, z + tz * distance]
  }
  if (distance > path.length) {
    const over = distance - path.length
    const [x, z] = path.pointAt(1)
    const [tx, tz] = path.tangentAt(1)
    return [x + tx * over, z + tz * over]
  }
  return path.pointAt(distance / path.length)
}

/** Normal at a distance along the walk, extrapolation included. */
function walkNormal(path: WalkPath, distance: number): Ground {
  if (path.length === 0) return path.normalAt(0)
  if (path.closed) return path.normalAt(distance / path.length)
  return path.normalAt(Math.min(Math.max(distance, 0), path.length) / path.length)
}

/**
 * Station the camera for a figure that has walked `walked` units along the
 * path. `figureHeight` is the scale reference — every height here is a
 * multiple of the body in frame, so the shot holds when the figure changes
 * size and the banners change with it.
 */
export function stageCamera(
  path: WalkPath,
  walked: number,
  figureHeight: number,
  options: ShotOptions,
): StageShot {
  const eye = figureHeight * EYE[options.shot] * options.height
  const aim = figureHeight * AIM[options.shot]

  // Where the camera stands along the walk, and where it points.
  let station: number
  let mark: number
  if (options.shot === 'lead') {
    // Ahead of the figure, walking backward in front of it.
    station = walked + options.distance
    mark = walked
  } else if (options.shot === 'wide') {
    // An establishing shot: stand off to one side, level with the figure.
    station = walked
    mark = walked
  } else {
    station = walked - options.distance
    mark = walked + options.lookAhead
  }

  const [sx, sz] = walkPoint(path, station)
  const [mx, mz] = walkPoint(path, mark)
  const [nx, nz] = walkNormal(path, station)
  // `wide` steps off the walk by its whole distance; the others only take
  // whatever sideways offset was asked for.
  const step = options.offset + (options.shot === 'wide' ? options.distance : 0)

  return {
    position: [sx + nx * step, eye, sz + nz * step],
    target: [mx, aim, mz],
  }
}
