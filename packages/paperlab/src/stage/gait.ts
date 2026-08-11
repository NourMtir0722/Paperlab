import { z } from 'zod'
import type { WalkPath } from './path'

/**
 * The figure — a silhouette walking the path. It exists for one reason:
 * SCALE. A banner is just a rectangle until there is a body beside it, and
 * every reference image for this mode is carried by one small dark shape
 * that never competes for attention.
 *
 * Which is also why the model is deliberately crude. At the size the figure
 * reads on screen it is forty pixels of unlit black; fidelity buys nothing,
 * and the CONTACT SHADOW does the work of selling the floor. So: procedural
 * gait, capsule limbs, no rig, no asset, no download. Pure math here (it
 * tests in node); the meshes live in Figure.tsx.
 */

export const figureSchema = z.object({
  /** Standing height in world units — the scale reference the whole stage is read against. */
  height: z.number().min(0.5).max(4).default(1.75),
  /** World units per second along the walk. A relaxed indoor pace is ~1.2. */
  speed: z.number().min(0).max(4).default(1.2),
  /** Stride length as a fraction of height — how far one step carries. */
  stride: z.number().min(0.1).max(1).default(0.42),
  /** Arm swing, 0..1. Drop it toward 0 for hands-in-pockets stillness. */
  swing: z.number().min(0).max(1).default(1),
  /** Silhouette color. Near-black by default: it should read as an absence, not an object. */
  color: z.string().default('#0a0a0c'),
})

export type FigureOptions = z.infer<typeof figureSchema>

/**
 * Segment lengths as fractions of standing height, roughly canonical human
 * proportions. Shared by the gait, the renderer, and anything that needs to
 * know how tall the hips are.
 */
export const PROPORTIONS = {
  hip: 0.53,
  shoulder: 0.82,
  headRadius: 0.045,
  headCenter: 0.935,
  thigh: 0.245,
  shin: 0.235,
  upperArm: 0.185,
  foreArm: 0.165,
  torsoWidth: 0.19,
  hipWidth: 0.095,
  limbRadius: 0.028,
} as const

/** Peak thigh swing, radians (~24°). */
const THIGH_SWING = 0.42
/** Peak arm swing, radians (~29°). */
const ARM_SWING = 0.5
/** Peak knee flex during swing-through, radians (~63°). */
const KNEE_FLEX = 1.1
/** Hip rise and fall, as a fraction of height. */
const BOB = 0.016
/** Forward lean at full speed, radians. */
const LEAN = 0.045

const TAU = Math.PI * 2

/**
 * One instant of the gait. Angles are radians about the figure's X axis;
 * positive swings a limb FORWARD, along the direction of travel.
 */
export interface FigurePose {
  /** Where in the two-step cycle, 0..1. */
  phase: number
  /** Vertical offset of the hips from standing, world units (always ≤ 0). */
  bob: number
  /** Forward lean of the torso. */
  lean: number
  leftThigh: number
  rightThigh: number
  /** Knee flex, relative to the thigh. Always ≤ 0 — a knee folds backward only. */
  leftKnee: number
  rightKnee: number
  leftArm: number
  rightArm: number
}

/** Length of one full two-step cycle, in world units. */
export function cycleLength(o: FigureOptions): number {
  return o.stride * o.height * 2
}

/**
 * The gait at a given distance walked. Driven by DISTANCE, not by time, so
 * the feet cannot skate: however the figure is paced — clock, scroll, or a
 * scrubbed timeline — a step always covers a step's worth of ground.
 */
export function figureGait(distance: number, o: FigureOptions): FigurePose {
  const cycle = cycleLength(o)
  const phase = cycle > 0 ? (((distance / cycle) % 1) + 1) % 1 : 0
  const w = phase * TAU

  const leftThigh = THIGH_SWING * Math.sin(w)
  const rightThigh = THIGH_SWING * Math.sin(w + Math.PI)

  // The knee folds through the swing — the leg is travelling forward and has
  // to clear the floor — and stays straight through the stance, where it is
  // carrying weight. Peak flex sits at mid-swing, three quarters of a cycle
  // after the leg is furthest forward.
  const flex = (at: number) => -KNEE_FLEX * Math.max(0, Math.cos(w - at)) ** 1.5
  const leftKnee = flex((7 * Math.PI) / 4)
  const rightKnee = flex((3 * Math.PI) / 4)

  // Arms oppose legs — the counter-rotation that stops a walk reading as a shamble.
  const leftArm = -ARM_SWING * o.swing * Math.sin(w)
  const rightArm = -ARM_SWING * o.swing * Math.sin(w + Math.PI)

  // Hips rise over each stance leg and drop through double support: twice a cycle.
  const bob = -BOB * o.height * (1 - Math.abs(Math.cos(w)))

  return {
    phase,
    bob,
    lean: LEAN * Math.min(o.speed / 1.2, 1),
    leftThigh,
    rightThigh,
    leftKnee,
    rightKnee,
    leftArm,
    rightArm,
  }
}

/** Where the figure stands, which way it faces, and what its limbs are doing. */
export interface FigurePlacement {
  /** Ground contact point — the renderer lifts the body off it. */
  position: [x: number, y: number, z: number]
  /** Facing, radians about Y. The figure model faces +Z at yaw 0, as sheets do. */
  yaw: number
  pose: FigurePose
  /** Normalized arc length along the walk, after wrapping or clamping. */
  s: number
}

/**
 * Put the figure on the walk at a given distance travelled. An open path
 * clamps at its end (the figure arrives and stands); a closed one wraps
 * forever, which is what a looping shot wants.
 */
export function placeFigure(path: WalkPath, distance: number, o: FigureOptions): FigurePlacement {
  const raw = path.length > 0 ? distance / path.length : 0
  const s = path.closed ? ((raw % 1) + 1) % 1 : Math.min(Math.max(raw, 0), 1)
  const [x, z] = path.pointAt(s)
  const [tx, tz] = path.tangentAt(s)
  // An open path holds the last pose once the walk runs out, rather than
  // marching the figure on through the far wall.
  const travelled = path.closed ? distance : Math.min(distance, path.length)
  return {
    position: [x, 0, z],
    yaw: Math.atan2(tx, tz),
    pose: figureGait(travelled, o),
    s,
  }
}
