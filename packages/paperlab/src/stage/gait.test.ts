import { describe, expect, it } from 'vitest'
import { createWalkPath, walkPathSchema } from './path'
import {
  clipTimeFor,
  cycleLength,
  figureGait,
  figureSchema,
  isRunning,
  pickClip,
  pickStillClip,
  placeFigure,
} from './gait'

const options = (o: Record<string, unknown> = {}) => figureSchema.parse(o)
const path = (o: Record<string, unknown> = {}) => createWalkPath(walkPathSchema.parse(o))

describe('figure gait', () => {
  it('repeats every cycle, and half a cycle swaps the legs', () => {
    const o = options()
    const cycle = cycleLength(o)
    const at = figureGait(2.3, o)
    const later = figureGait(2.3 + cycle, o)
    expect(later.leftThigh).toBeCloseTo(at.leftThigh, 6)
    expect(later.leftKnee).toBeCloseTo(at.leftKnee, 6)

    const half = figureGait(2.3 + cycle / 2, o)
    expect(half.leftThigh).toBeCloseTo(at.rightThigh, 6)
    expect(half.rightThigh).toBeCloseTo(at.leftThigh, 6)
  })

  it('is driven by distance, so the feet cannot skate', () => {
    // Same ground covered = same pose, whatever pace put the figure there —
    // WITHIN a gait. Both of these are walks; a speed that crosses into a run
    // is a different gait with a different stride, and is covered below.
    const slow = options({ speed: 0.4 })
    const brisk = options({ speed: 1.9 })
    expect(figureGait(5, slow).running).toBe(false)
    expect(figureGait(5, brisk).running).toBe(false)
    expect(figureGait(5, slow).leftThigh).toBeCloseTo(figureGait(5, brisk).leftThigh, 6)
    // A longer stride spends that same ground differently.
    expect(figureGait(5, options({ stride: 0.7 })).leftThigh).not.toBeCloseTo(
      figureGait(5, slow).leftThigh,
      3,
    )
  })

  it('holds within a run too — it is the gait that changes, not the rule', () => {
    const jog = options({ speed: 2.6 })
    const sprint = options({ speed: 3.8 })
    expect(figureGait(5, jog).running).toBe(true)
    expect(figureGait(5, sprint).running).toBe(true)
    expect(figureGait(5, jog).leftThigh).toBeCloseTo(figureGait(5, sprint).leftThigh, 6)
  })

  it('legs stay in antiphase and knees only ever fold backward', () => {
    const o = options()
    for (let i = 0; i <= 40; i++) {
      const pose = figureGait((i / 40) * cycleLength(o) * 2, o)
      expect(pose.leftThigh).toBeCloseTo(-pose.rightThigh, 6)
      expect(pose.leftKnee).toBeLessThanOrEqual(0)
      expect(pose.rightKnee).toBeLessThanOrEqual(0)
    }
  })

  it('arms counter-swing against the legs', () => {
    const o = options()
    for (let i = 1; i < 8; i++) {
      const pose = figureGait((i / 8) * cycleLength(o), o)
      if (Math.abs(pose.leftThigh) < 1e-6) continue
      expect(Math.sign(pose.leftArm)).toBe(-Math.sign(pose.leftThigh))
    }
  })

  it('swing 0 stills the arms without touching the walk', () => {
    const still = figureGait(3, options({ swing: 0 }))
    expect(still.leftArm).toBeCloseTo(0, 12)
    expect(still.rightArm).toBeCloseTo(0, 12)
    expect(still.leftThigh).toBeCloseTo(figureGait(3, options()).leftThigh, 6)
  })

  it('hips only ever drop, and touch standing height twice a cycle', () => {
    const o = options()
    const cycle = cycleLength(o)
    let lowest = 0
    for (let i = 0; i <= 60; i++) {
      const bob = figureGait((i / 60) * cycle, o).bob
      expect(bob).toBeLessThanOrEqual(1e-12)
      lowest = Math.min(lowest, bob)
    }
    expect(lowest).toBeLessThan(0)
    expect(figureGait(0, o).bob).toBeCloseTo(0, 6)
    expect(figureGait(cycle / 2, o).bob).toBeCloseTo(0, 6)
  })
})

describe('placing the figure on the walk', () => {
  it('faces the direction of travel', () => {
    // The default walk heads down -Z; facing it means a half turn from +Z.
    const placed = placeFigure(path(), 4, options())
    expect(Math.abs(placed.yaw)).toBeCloseTo(Math.PI, 5)
    expect(placed.position[1]).toBe(0)
  })

  it('turns with a curved walk', () => {
    const curve = path({
      points: [
        [0, 8],
        [4, 0],
        [0, -8],
      ],
    })
    const early = placeFigure(curve, 2, options())
    const late = placeFigure(curve, curve.length - 2, options())
    expect(early.yaw).not.toBeCloseTo(late.yaw, 2)
  })

  it('an open walk ends: the figure arrives and stops stepping', () => {
    const walk = path()
    const arrived = placeFigure(walk, walk.length + 5, options())
    const muchLater = placeFigure(walk, walk.length + 50, options())
    expect(arrived.s).toBe(1)
    expect(muchLater.s).toBe(1)
    expect(muchLater.pose.leftThigh).toBeCloseTo(arrived.pose.leftThigh, 6)
    expect(muchLater.position).toEqual(arrived.position)
  })

  it('a closed walk loops forever', () => {
    const ring = path({
      points: [
        [4, 0],
        [0, 4],
        [-4, 0],
        [0, -4],
      ],
      closed: true,
    })
    const first = placeFigure(ring, 1.5, options())
    const lap = placeFigure(ring, 1.5 + ring.length, options())
    expect(lap.position[0]).toBeCloseTo(first.position[0], 5)
    expect(lap.position[2]).toBeCloseTo(first.position[2], 5)
    expect(lap.s).toBeCloseTo(first.s, 6)
  })

  it('walking backward from the start clamps instead of going negative', () => {
    const walk = path()
    expect(placeFigure(walk, -12, options()).s).toBe(0)
  })
})

/**
 * Sample a whole stride. Every claim below is about the SHAPE of the cycle,
 * so none of them can be made from one instant of it.
 */
const overACycle = (o: ReturnType<typeof options>, n = 48) =>
  Array.from({ length: n }, (_, i) => figureGait((i / n) * cycleLength(o), o))

describe('the trunk', () => {
  it('counter-rotates: the chest turns against the pelvis, never with it', () => {
    // The single most recognisable thing about human gait. If these ever
    // share a sign the walk reads as a shamble, however good the legs are.
    for (const pose of overACycle(options())) {
      if (Math.abs(pose.pelvis) < 1e-9) continue
      expect(Math.sign(pose.chest)).toBe(-Math.sign(pose.pelvis))
    }
  })

  it('turns the shoulders further than the hips, or the counter-rotation reads as nothing', () => {
    const poses = overACycle(options())
    const peak = (pick: (p: (typeof poses)[number]) => number) =>
      Math.max(...poses.map((p) => Math.abs(pick(p))))
    expect(peak((p) => p.chest)).toBeGreaterThan(peak((p) => p.pelvis))
  })

  it('leans toward whichever foot is carrying the weight', () => {
    // A stance leg travels backward relative to the body; the swing leg
    // travels forward. Lean has to follow the one on the ground, or the
    // figure walks like it is falling away from its own steps.
    const o = options()
    const cycle = cycleLength(o)
    for (let i = 0; i < 32; i++) {
      const d = (i / 32) * cycle
      const step = cycle / 400
      const pose = figureGait(d, o)
      const leftMovingForward = figureGait(d + step, o).leftThigh > pose.leftThigh
      if (Math.abs(pose.sway) < 1e-6) continue
      // Positive sway tips the trunk toward the figure's left (−X), which is
      // where the left leg is. So lean left exactly when the LEFT leg is the
      // stance leg — that is, when it is not swinging forward.
      expect(pose.sway > 0).toBe(!leftMovingForward)
    }
  })

  it('drops the hip on the side that is swinging', () => {
    const o = options()
    const cycle = cycleLength(o)
    for (let i = 0; i < 32; i++) {
      const d = (i / 32) * cycle
      const pose = figureGait(d, o)
      if (Math.abs(pose.hipDrop) < 1e-6) continue
      const leftMovingForward = figureGait(d + cycle / 400, o).leftThigh > pose.leftThigh
      // Positive hipDrop drops the LEFT hip, which is what the left hip does
      // while that leg is unloaded.
      expect(pose.hipDrop > 0).toBe(leftMovingForward)
    }
  })

  it('sways and drops twice per stride — once for each foot', () => {
    // Half a cycle later the body is doing the same thing on the other side,
    // so both terms must invert rather than repeat.
    const o = options()
    const at = figureGait(0.31, o)
    const half = figureGait(0.31 + cycleLength(o) / 2, o)
    expect(half.sway).toBeCloseTo(-at.sway, 6)
    expect(half.hipDrop).toBeCloseTo(-at.hipDrop, 6)
  })
})

describe('elbows', () => {
  it('only ever fold forward', () => {
    for (const pose of overACycle(options())) {
      expect(pose.leftElbow).toBeGreaterThanOrEqual(0)
      expect(pose.rightElbow).toBeGreaterThanOrEqual(0)
    }
  })

  it('straighten with the shoulders when the arms are stilled', () => {
    const still = figureGait(3, options({ swing: 0 }))
    expect(still.leftElbow).toBeCloseTo(0, 12)
    expect(still.rightElbow).toBeCloseTo(0, 12)
  })

  it('carry a real bend in a run, where a walk barely has one', () => {
    const peak = (o: ReturnType<typeof options>) => Math.max(...overACycle(o).map((p) => p.leftElbow))
    expect(peak(options({ gait: 'run' }))).toBeGreaterThan(peak(options({ gait: 'walk' })) * 3)
  })
})

describe('walking versus running', () => {
  it('breaks into a run where people actually do, and sooner for a smaller figure', () => {
    // Froude: v²/gL past ~0.5. For a 1.75 m figure that is ~2.1 units/second.
    expect(isRunning(options({ speed: 1.9 }))).toBe(false)
    expect(isRunning(options({ speed: 2.4 }))).toBe(true)
    // Shorter legs vault more slowly, so a child runs at a speed an adult
    // still walks. This is the whole reason the threshold is derived.
    expect(isRunning(options({ speed: 1.9, height: 1.0 }))).toBe(true)
  })

  it('takes the explicit answer over the derived one', () => {
    expect(isRunning(options({ speed: 3.5, gait: 'walk' }))).toBe(false)
    expect(isRunning(options({ speed: 0.3, gait: 'run' }))).toBe(true)
  })

  it('covers more ground per step at a run', () => {
    expect(cycleLength(options({ gait: 'run' }))).toBeGreaterThan(cycleLength(options({ gait: 'walk' })))
  })

  it('inverts the bounce: a walk only ever drops, a run leaves the ground', () => {
    // A walk vaults over a straight stance leg, so standing height is its
    // ceiling. A run compresses the leg under the body and then flies, so it
    // has to go both ways — and that inversion is the difference you see.
    const walk = overACycle(options({ gait: 'walk' })).map((p) => p.bob)
    expect(Math.max(...walk)).toBeLessThanOrEqual(1e-12)

    const run = overACycle(options({ gait: 'run' })).map((p) => p.bob)
    expect(Math.max(...run)).toBeGreaterThan(0)
    expect(Math.min(...run)).toBeLessThan(0)
  })

  it('swings and leans further at a run', () => {
    const peakThigh = (o: ReturnType<typeof options>) =>
      Math.max(...overACycle(o).map((p) => Math.abs(p.leftThigh)))
    expect(peakThigh(options({ gait: 'run' }))).toBeGreaterThan(peakThigh(options({ gait: 'walk' })))
    expect(figureGait(0, options({ gait: 'run' })).lean).toBeGreaterThan(
      figureGait(0, options({ gait: 'walk' })).lean,
    )
  })
})

describe('driving a rigged model', () => {
  it('picks the clip for the gait being performed', () => {
    const names = ['Armature|Walk', 'Armature|Run', 'TPose']
    expect(pickClip(names, false)).toBe('Armature|Walk')
    expect(pickClip(names, true)).toBe('Armature|Run')
  })

  it('takes the other gait over nothing, and anything over nothing at all', () => {
    expect(pickClip(['walk_01'], true)).toBe('walk_01')
    expect(pickClip(['mystery'], false)).toBe('mystery')
    expect(pickClip([], false)).toBeUndefined()
  })

  it('scrubs the clip by distance, so a rig cannot skate either', () => {
    const o = options()
    const cycle = cycleLength(o)
    const duration = 1.4
    // One cycle of ground = one pass of the clip, wrapping cleanly.
    expect(clipTimeFor(0, o, duration)).toBeCloseTo(0, 9)
    expect(clipTimeFor(cycle / 4, o, duration)).toBeCloseTo(duration / 4, 9)
    expect(clipTimeFor(cycle, o, duration)).toBeCloseTo(0, 9)
    expect(clipTimeFor(cycle * 3.5, o, duration)).toBeCloseTo(duration / 2, 9)
    // And walking backwards past the start does not produce a negative time.
    expect(clipTimeFor(-cycle / 4, o, duration)).toBeCloseTo(duration * 0.75, 9)
  })

  it('survives a clip with no duration rather than dividing by it', () => {
    expect(clipTimeFor(5, options(), 0)).toBe(0)
  })
})

describe('choosing a clip out of a real pack', () => {
  // Verbatim from the asset the demo apps ship — the case that made the
  // shortest-name rule necessary, since `Man_RunningJump` also matches /run/.
  const PACK = [
    'HumanArmature|Man_Clapping',
    'HumanArmature|Man_Death',
    'HumanArmature|Man_Idle',
    'HumanArmature|Man_Jump',
    'HumanArmature|Man_Punch',
    'HumanArmature|Man_Run',
    'HumanArmature|Man_RunningJump',
    'HumanArmature|Man_Sitting',
    'HumanArmature|Man_Standing',
    'HumanArmature|Man_SwordSlash',
    'HumanArmature|Man_Walk',
  ]

  it('takes the gait, not the trick that happens to be named after it', () => {
    expect(pickClip(PACK, false)).toBe('HumanArmature|Man_Walk')
    expect(pickClip(PACK, true)).toBe('HumanArmature|Man_Run')
  })

  it('stands still rather than freezing mid-stride', () => {
    expect(pickStillClip(PACK)).toBe('HumanArmature|Man_Idle')
    // No idle in the pack: standing will do, and a walk is the last resort.
    expect(pickStillClip(['Armature|Standing', 'Armature|Walk'])).toBe('Armature|Standing')
    expect(pickStillClip(['Armature|Walk'])).toBe('Armature|Walk')
    expect(pickStillClip([])).toBeUndefined()
  })

  it('a figure is shaded by default, and can be flattened back to a silhouette', () => {
    expect(figureSchema.parse({}).finish).toBe('shaded')
    expect(figureSchema.parse({ finish: 'silhouette' }).finish).toBe('silhouette')
  })
})
