import type { DeformerInstance } from '../deformers/types'

export const idleNames = ['float', 'tumble', 'dangle', 'taped', 'breeze'] as const
export type IdleName = (typeof idleNames)[number]

export interface IdlePose {
  /** Offsets added to the paper's base transform each frame. */
  position: [number, number, number]
  rotation: [number, number, number]
}

/**
 * Curated fake physics: hand-tuned motion presets, no simulation. Cheap
 * enough for both hero and field modes, and — for things like the
 * falling-leaf tumble — they read *more* real than a true sim.
 */
export interface IdlePreset {
  id: IdleName
  label: string
  /** Whole-sheet motion, written into `pose` (allocation-free). */
  transform?(t: number, pose: IdlePose): void
  /** Extra deformers appended after the behavior's stack. */
  stack?(): DeformerInstance[]
}

export const idlePresets: Record<IdleName, IdlePreset> = {
  float: {
    id: 'float',
    label: 'Float',
    transform(t, pose) {
      pose.position[1] = Math.sin(t * 0.9) * 0.05
      pose.rotation[1] = Math.sin(t * 0.31) * 0.16
      pose.rotation[2] = Math.sin(t * 0.23 + 1.2) * 0.05
    },
  },
  tumble: {
    id: 'tumble',
    label: 'Tumble',
    transform(t, pose) {
      // Falling-leaf: velocity-linked lift bob + curated wobble.
      pose.rotation[0] = Math.sin(t * 0.5 + 1) * 0.6
      pose.rotation[2] = Math.sin(t * 0.7) * 0.5
      pose.position[1] = Math.sin(t * 1.4) * 0.07
      pose.position[0] = Math.sin(t * 0.35) * 0.14
    },
    stack: () => [
      {
        type: 'wave',
        options: { amplitude: 0.02, wavelength: 0.9, speed: 0.9, angle: 25, pinnedEdge: 'none' },
      },
    ],
  },
  dangle: {
    id: 'dangle',
    label: 'Dangle',
    transform(t, pose) {
      // A hung tail's pendulum sway.
      pose.rotation[2] = Math.sin(t * 1.5) * 0.06
      pose.rotation[0] = Math.sin(t * 1.1 + 0.7) * 0.03
    },
  },
  taped: {
    id: 'taped',
    label: 'Taped',
    // Taped at the top of a wall: the free bottom edge breathes.
    stack: () => [
      {
        type: 'wave',
        options: { amplitude: 0.025, wavelength: 1.2, speed: 0.45, angle: 90, pinnedEdge: 'top' },
      },
    ],
  },
  breeze: {
    id: 'breeze',
    label: 'Breeze',
    stack: () => [
      {
        type: 'wave',
        options: { amplitude: 0.035, wavelength: 0.5, speed: 1.0, angle: 20, pinnedEdge: 'none' },
      },
    ],
  },
}

export function getIdlePreset(name: IdleName): IdlePreset {
  return idlePresets[name]
}
