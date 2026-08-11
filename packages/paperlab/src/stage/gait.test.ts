import { describe, expect, it } from 'vitest'
import { createWalkPath, walkPathSchema } from './path'
import { cycleLength, figureGait, figureSchema, placeFigure } from './gait'

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
    // Same ground covered = same pose, whatever pace put the figure there.
    const slow = options({ speed: 0.4 })
    const fast = options({ speed: 3 })
    expect(figureGait(5, slow).leftThigh).toBeCloseTo(figureGait(5, fast).leftThigh, 6)
    // A longer stride spends that same ground differently.
    expect(figureGait(5, options({ stride: 0.7 })).leftThigh).not.toBeCloseTo(
      figureGait(5, slow).leftThigh,
      3,
    )
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
