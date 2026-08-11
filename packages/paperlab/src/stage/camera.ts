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
  /**
   * How far the camera stands off the figure ALONG the walk, world units.
   * `wide` reads it as how far back it stands; how far it steps aside is
   * derived from the paper, since that is what it has to clear.
   */
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

/**
 * What each shot is FOR. A stage has two subjects at very different scales —
 * a body about 1.75 units tall and paper five times that — and a camera that
 * only knows about the body frames the body, which is how a colonnade of
 * printed banners ends up showing its bottom third and the tops of some
 * letterforms. Camera height stays a body measurement (eye level is eye
 * level); where it AIMS is a blend, and the paper carries most of it.
 */
export interface StageScale {
  /** Standing height of the figure. */
  figure: number
  /** Height of the tallest paper on the stage. */
  paper: number
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

/** Where each shot aims: a blend of the figure's height and the paper's. */
const AIM: Record<ShotName, StageScale> = {
  // Chest height on the figure, a third of the way up the paper — enough
  // tilt that a printed banner reads, not so much that the floor is lost.
  follow: { figure: 0.62, paper: 0.3 },
  // Framing the figure itself, so the paper only lifts the aim a little.
  lead: { figure: 0.62, paper: 0.1 },
  // Up the banners. The figure is incidental to this shot.
  low: { figure: 0, paper: 0.62 },
  wide: { figure: 0.62, paper: 0.2 },
}

/**
 * A point measured in DISTANCE along the walk rather than normalized `s`,
 * extrapolating straight past either end of an open path. Without that, a
 * following camera at the start of a walk would clamp onto the figure's own
 * feet instead of standing back off it.
 */
/** How far `wide` stands off the walk line, as a multiple of the paper's height. */
const WIDE_STANDOFF = 1.5

/** A tall banner runs about five times the height of the person beside it. */
export const DEFAULT_PAPER_RATIO = 4.9

function resolveScale(scale: StageScale | number): StageScale {
  if (typeof scale === 'number') return { figure: scale, paper: scale * DEFAULT_PAPER_RATIO }
  return scale
}

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
 * path. Every height is expressed as a multiple of something in the frame —
 * the body, or the paper — so a shot holds its composition when the stage is
 * rescaled rather than needing to be re-tuned.
 *
 * `scale` accepts a bare number for the figure's height, in which case the
 * paper is assumed to be the banner-ish proportion of it.
 */
export function stageCamera(
  path: WalkPath,
  walked: number,
  scale: StageScale | number,
  options: ShotOptions,
): StageShot {
  const { figure, paper } = resolveScale(scale)
  const eye = figure * EYE[options.shot] * options.height
  const aim = figure * AIM[options.shot].figure + paper * AIM[options.shot].paper

  // Where the camera stands along the walk, and where it points.
  let station: number
  let mark: number
  if (options.shot === 'lead') {
    // Ahead of the figure, walking backward in front of it.
    station = walked + options.distance
    mark = walked
  } else if (options.shot === 'wide') {
    // An establishing shot: back along the walk AND out to one side.
    station = walked - options.distance
    mark = walked
  } else {
    station = walked - options.distance
    mark = walked + options.lookAhead
  }

  const [sx, sz] = walkPoint(path, station)
  const [mx, mz] = walkPoint(path, mark)
  const [nx, nz] = walkNormal(path, station)
  // How far `wide` steps aside cannot come from `distance`: an aisle is only
  // a few units across, so any sane walk-distance drops the camera inside
  // the colonnade looking at the back of one banner. It has to clear the
  // paper, so it is the paper that sets it.
  const step = options.offset + (options.shot === 'wide' ? paper * WIDE_STANDOFF : 0)

  return {
    position: [sx + nx * step, eye, sz + nz * step],
    target: [mx, aim, mz],
  }
}
