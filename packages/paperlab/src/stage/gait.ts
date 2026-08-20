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
  /**
   * Walk or run. `'auto'` decides from `speed` and leg length, at the point
   * people actually break into a run — see `isRunning`.
   */
  gait: z.enum(['auto', 'walk', 'run']).default('auto'),
  /**
   * URL of a rigged glTF/GLB to use instead of the capsules. Serializes as a
   * string, so a `.paper` carrying one stays a `.paper` — but the asset is
   * NOT part of the library and never ships in the npm tarball; the app hosts
   * it. Anything that fails to load falls back to the capsule figure rather
   * than emptying the stage.
   */
  model: z.string().optional(),
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

/**
 * Every amplitude below is a walk/run pair, because a run is not a fast walk
 * — it is a different gait with a flight phase, and half of these roughly
 * double across the transition.
 */
interface Amplitudes {
  thigh: number
  arm: number
  knee: number
  elbow: number
  /** Pelvis rotation about the vertical, carrying the swing hip forward. */
  pelvis: number
  /** Trunk rotation about the vertical, against the pelvis. */
  chest: number
  /** Lateral trunk lean toward the stance foot. */
  sway: number
  /** Pelvic obliquity — the swing-side hip drops. */
  hipDrop: number
  lean: number
}

/** Walking: ~24° thigh, ~29° arm, ~63° knee, 4°/8° pelvis/chest, ~3° sway. */
const WALK: Amplitudes = {
  thigh: 0.42,
  arm: 0.5,
  knee: 1.1,
  elbow: 0.38,
  pelvis: 0.07,
  chest: 0.14,
  sway: 0.05,
  hipDrop: 0.07,
  lean: 0.045,
}

/** Running: longer swing, a heel that folds toward the seat, elbows at ~85°. */
const RUN: Amplitudes = {
  thigh: 0.7,
  arm: 0.95,
  knee: 1.9,
  elbow: 1.5,
  pelvis: 0.14,
  chest: 0.26,
  sway: 0.08,
  hipDrop: 0.1,
  lean: 0.16,
}

/** Walking hip drop through double support, as a fraction of height. */
const BOB = 0.016
/** Running: how far the stance leg compresses under the body at midstance. */
const RUN_COMPRESS = 0.035
/** Running: how far the flight phase lifts it above standing. */
const RUN_LIFT = 0.03
/** A running step covers this much more ground than the authored stride. */
const RUN_STRIDE = 1.7
/** The speed a walk's lean reaches full, world units per second. */
const LEAN_FULL_SPEED = 1.2

const GRAVITY = 9.81
/**
 * Froude number at which people stop walking and start running. A walk vaults
 * over a straight stance leg, so it is capped by the point where the body
 * would need more centripetal force than gravity can supply — `v²/gL ≈ 0.5`,
 * which for a 1.75 m figure lands at about 2.1 units/second. This is why the
 * transition is derived rather than a magic number, and why it moves with
 * height: a child breaks into a run at a slower speed than an adult does.
 */
const FROUDE_RUN = 0.5

const TAU = Math.PI * 2

/**
 * One instant of the gait. Angles are radians about the figure's X axis;
 * positive swings a limb FORWARD, along the direction of travel.
 */
export interface FigurePose {
  /** Where in the two-step cycle, 0..1. */
  phase: number
  /** Whether this is a run — a gait with a flight phase — rather than a walk. */
  running: boolean
  /**
   * Vertical offset of the hips from standing, world units. A walk only ever
   * drops (≤ 0): it vaults over a straight stance leg, so standing height is
   * the ceiling. A run goes BOTH ways — the stance leg compresses under the
   * body at midstance and the flight phase lifts it clear of the ground.
   */
  bob: number
  /** Forward lean of the torso. */
  lean: number

  // ── the trunk ──────────────────────────────────────────────────────────
  // Rotations about the vertical, given relative to the direction of travel
  // rather than to each other. A nested rig applies the difference; the
  // absolute form is what makes "these two oppose" legible and testable.
  /** Pelvis about the vertical. Positive carries the LEFT hip forward. */
  pelvis: number
  /** Upper trunk about the vertical, always opposing `pelvis`. */
  chest: number
  /**
   * Lateral trunk lean, radians about the travel axis. Positive tips the
   * trunk toward the figure's left (−X). It leans toward whichever foot is
   * carrying the weight, so it cycles twice per stride, not once.
   */
  sway: number
  /** Pelvic obliquity. Positive drops the LEFT hip, which happens as it swings. */
  hipDrop: number

  // ── the limbs ──────────────────────────────────────────────────────────
  leftThigh: number
  rightThigh: number
  /** Knee flex, relative to the thigh. Always ≤ 0 — a knee folds backward only. */
  leftKnee: number
  rightKnee: number
  leftArm: number
  rightArm: number
  /** Elbow flex, relative to the upper arm. Always ≥ 0 — an elbow folds forward only. */
  leftElbow: number
  rightElbow: number
}

/**
 * Whether these options describe a run.
 *
 * `'auto'` uses the Froude number, `v²/gL` against the leg length, so the
 * transition sits where a real one does and moves with the figure's size
 * instead of being a constant somebody picked.
 */
export function isRunning(o: FigureOptions): boolean {
  if (o.gait !== 'auto') return o.gait === 'run'
  const legLength = PROPORTIONS.hip * o.height
  if (legLength <= 0) return false
  return (o.speed * o.speed) / (GRAVITY * legLength) > FROUDE_RUN
}

/**
 * Length of one full two-step cycle, in world units.
 *
 * A run covers more ground per step than the authored stride — that is most
 * of what running IS — so the cycle stretches rather than the cadence going
 * silly at speed.
 */
export function cycleLength(o: FigureOptions): number {
  const stride = o.stride * (isRunning(o) ? RUN_STRIDE : 1)
  return stride * o.height * 2
}

/**
 * The gait at a given distance walked. Driven by DISTANCE, not by time, so
 * the feet cannot skate: however the figure is paced — clock, scroll, or a
 * scrubbed timeline — a step always covers a step's worth of ground.
 */
export function figureGait(distance: number, o: FigureOptions): FigurePose {
  const running = isRunning(o)
  const a = running ? RUN : WALK
  const cycle = cycleLength(o)
  const phase = cycle > 0 ? (((distance / cycle) % 1) + 1) % 1 : 0
  const w = phase * TAU

  const leftThigh = a.thigh * Math.sin(w)
  const rightThigh = a.thigh * Math.sin(w + Math.PI)

  // The knee folds through the swing — the leg is travelling forward and has
  // to clear the floor — and stays straight through the stance, where it is
  // carrying weight. Peak flex sits at mid-swing, three quarters of a cycle
  // after the leg is furthest forward.
  const flex = (at: number) => -a.knee * Math.max(0, Math.cos(w - at)) ** 1.5
  const leftKnee = flex((7 * Math.PI) / 4)
  const rightKnee = flex((3 * Math.PI) / 4)

  // Arms oppose legs — the counter-rotation that stops a walk reading as a shamble.
  const leftArm = -a.arm * o.swing * Math.sin(w)
  const rightArm = -a.arm * o.swing * Math.sin(w + Math.PI)

  // An elbow carries a standing bend and tightens as that arm drives forward;
  // running holds it near a right angle throughout. Scaled by `swing` with
  // the shoulder, so hands-in-pockets means straight arms rather than bent
  // ones frozen mid-drive.
  const bend = (forwardness: number) => a.elbow * o.swing * (0.7 + 0.3 * Math.max(0, forwardness))
  const leftElbow = bend(-Math.sin(w))
  const rightElbow = bend(-Math.sin(w + Math.PI))

  // The trunk. The pelvis turns to carry the swing-side hip forward, which is
  // what lets a step be longer than the leg; the chest turns against it,
  // cancelling most of that angular momentum so the head travels straight.
  // Take this pair out and a walk reads as a shamble however good the legs
  // are — it is the single most recognisable thing about human gait.
  const pelvis = a.pelvis * Math.sin(w)
  const chest = -a.chest * Math.sin(w)

  // Weight has to sit over the foot carrying it, so the trunk leans toward the
  // stance leg — twice per cycle, since there are two stances in a stride. At
  // w = 0 the right leg is under the body, so the lean is toward +X, which is
  // a NEGATIVE sway by the sign convention above.
  const sway = -a.sway * Math.cos(w)
  // Meanwhile the unweighted hip drops away, once per leg: at w = 0 the left
  // leg is mid-swing, so the left hip is the one falling.
  const hipDrop = a.hipDrop * Math.cos(w)

  // A walk vaults over a straight stance leg: highest at midstance, dropping
  // through double support, never above standing. A run inverts that — the
  // leg is a spring that compresses under the body at midstance and throws it
  // clear of the ground in between, so the same curve turns upside down and
  // crosses zero. That inversion is the difference you actually see.
  const midstance = Math.abs(Math.cos(w))
  const bob = running
    ? o.height * (RUN_LIFT * (1 - midstance) - RUN_COMPRESS * midstance)
    : -BOB * o.height * (1 - midstance)

  return {
    phase,
    running,
    bob,
    lean: running ? a.lean : a.lean * Math.min(o.speed / LEAN_FULL_SPEED, 1),
    pelvis,
    chest,
    sway,
    hipDrop,
    leftThigh,
    rightThigh,
    leftKnee,
    rightKnee,
    leftArm,
    rightArm,
    leftElbow,
    rightElbow,
  }
}

/**
 * Which of a model's animation clips to play, by name.
 *
 * Exporters name clips every which way — `Walk`, `walk_01`,
 * `Armature|Running` — so this matches loosely rather than exactly, prefers
 * the gait actually being performed, and will take the other gait over
 * nothing. A model with a single unnamed clip still animates.
 */
export function pickClip(names: readonly string[], running: boolean): string | undefined {
  const find = (re: RegExp) => names.find((n) => re.test(n))
  const wanted = running ? /run|jog|sprint/i : /walk/i
  const other = running ? /walk/i : /run|jog|sprint/i
  return find(wanted) ?? find(other) ?? names[0]
}

/**
 * Where to sit the playhead of a walk clip, given ground covered.
 *
 * This is the whole reason a rigged figure is worth having here rather than a
 * mixer and a clock: **the clip is scrubbed by DISTANCE, exactly as the
 * procedural gait is.** Play a walk cycle on its own timeline and the feet
 * skate the moment the figure's pace disagrees with the animator's; map one
 * gait cycle onto one clip instead, and a step always covers a step.
 *
 * It assumes the clip holds one full two-step cycle, which is the convention
 * for every walk cycle anyone ships. `stride` is the knob that syncs a
 * particular asset: set it to the stride the animator built, and the contact
 * points line up.
 */
export function clipTimeFor(distance: number, o: FigureOptions, clipDuration: number): number {
  if (!(clipDuration > 0)) return 0
  const cycle = cycleLength(o)
  if (!(cycle > 0)) return 0
  const phase = (((distance / cycle) % 1) + 1) % 1
  return phase * clipDuration
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
