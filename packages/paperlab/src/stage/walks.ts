import type { WalkPathOptions } from './path'

/**
 * Named walks. A path is a list of control points, which is the right thing
 * to serialize and the wrong thing to put in front of someone — nobody wants
 * to type coordinates to find out what a curved colonnade looks like. These
 * are the shapes worth starting from; every one resolves to ordinary points,
 * so editing on from here stays possible.
 */

export const walkNames = ['straight', 'bend', 'ess', 'ring', 'spiral'] as const
export type WalkName = (typeof walkNames)[number]

export const walks: Record<WalkName, WalkPathOptions> = {
  /** Straight down the nave, away from the camera. The reference shot. */
  straight: {
    points: [
      [0, 16],
      [0, -20],
    ],
    closed: false,
  },
  /** One long curve, so the far end of the colonnade stays hidden until you reach it. */
  bend: {
    points: [
      [-2, 16],
      [0, 6],
      [5, -3],
      [12, -10],
    ],
    closed: false,
  },
  /** Two opposed curves — the walk turns twice and the banners turn with it. */
  ess: {
    points: [
      [6, 17],
      [-3, 7],
      [3, -5],
      [-6, -17],
    ],
    closed: false,
  },
  /** A closed loop: the only walk `phase` can slide, and the only endless one. */
  ring: {
    points: [
      [11, 0],
      [0, 11],
      [-11, 0],
      [0, -11],
    ],
    closed: true,
  },
  /** Inward and tightening — the space closes as the figure goes deeper. */
  spiral: {
    points: [
      [14, 2],
      [2, 13],
      [-11, 1],
      [-1, -9],
      [7, -2],
      [1, 4],
    ],
    closed: false,
  },
}

export function getWalk(name: WalkName): WalkPathOptions {
  return walks[name]
}
