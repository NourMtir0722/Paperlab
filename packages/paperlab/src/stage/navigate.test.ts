import { describe, expect, it } from 'vitest'
import {
  coast,
  dragWalk,
  holdOnWalk,
  nearestStop,
  nextStop,
  stageMotionSchema,
  travelBetween,
  travelEase,
  wheelWalk,
} from './navigate'
import { colonnade, colonnadeStop, getLayout } from '../field/layouts'

describe('who drives the walk', () => {
  it('defaults to the viewer, drifting until they take it', () => {
    expect(stageMotionSchema.parse({}).driver).toBe('drag')
    expect(stageMotionSchema.parse({}).speed).toBe(1)
  })

  it('takes the wheel by default, and can be told not to', () => {
    // A full-bleed stage IS the page. One in a column of prose is not, and a
    // card that eats a reader's scroll on the way past is hostile.
    expect(stageMotionSchema.parse({}).capture).toBe(true)
    expect(stageMotionSchema.parse({ capture: false }).capture).toBe(false)
  })

  it('names the same three drivers a field does', () => {
    for (const driver of ['autoplay', 'drag', 'none'] as const) {
      expect(stageMotionSchema.parse({ driver }).driver).toBe(driver)
    }
    expect(() => stageMotionSchema.parse({ driver: 'scroll' })).toThrow()
  })
})

describe('the gesture', () => {
  it('drags forward when the hand goes up, as every scroll does', () => {
    expect(dragWalk(-100, 1)).toBeGreaterThan(0)
    expect(dragWalk(100, 1)).toBeLessThan(0)
    // Wheel down goes forward too — the page convention, not the hand's.
    expect(wheelWalk(100, 1)).toBeGreaterThan(0)
  })

  it('scales with speed and is a fraction of the walk, not of the world', () => {
    expect(dragWalk(-100, 2)).toBeCloseTo(dragWalk(-100, 1) * 2)
    // A full-height drag covers a good stretch without throwing you to the end.
    expect(dragWalk(-800, 1)).toBeGreaterThan(0.1)
    expect(dragWalk(-800, 1)).toBeLessThan(0.35)
  })

  it('a flick decays to exactly zero rather than creeping forever', () => {
    let v = 0.5
    for (let i = 0; i < 200; i++) v = coast(v, 1 / 60)
    expect(v).toBe(0)
    // And it is still moving after a moment, or it would not read as weight.
    expect(Math.abs(coast(0.5, 0.1))).toBeGreaterThan(0.2)
  })
})

describe('staying in the room', () => {
  it('an open walk clamps — the camera extrapolates past the end, so the viewer must not', () => {
    expect(holdOnWalk(1.4, false)).toBe(1)
    expect(holdOnWalk(-0.3, false)).toBe(0)
    expect(holdOnWalk(0.5, false)).toBe(0.5)
  })

  it('a closed walk wraps, because it has no ends', () => {
    expect(holdOnWalk(1.25, true)).toBeCloseTo(0.25)
    expect(holdOnWalk(-0.25, true)).toBeCloseTo(0.75)
  })
})

describe('stepping between papers', () => {
  const stops = [0.1, 0.3, 0.5, 0.7, 0.9]

  it('moves, even when you are standing exactly on one', () => {
    expect(nextStop(stops, 0.3, 1)).toBe(0.5)
    expect(nextStop(stops, 0.3, -1)).toBe(0.1)
    // Between two: the next one forward, the last one back.
    expect(nextStop(stops, 0.42, 1)).toBe(0.5)
    expect(nextStop(stops, 0.42, -1)).toBe(0.3)
  })

  it('stays in the room at the ends of an open walk, and comes round on a closed one', () => {
    expect(nextStop(stops, 0.9, 1, false)).toBe(0.9)
    expect(nextStop(stops, 0.1, -1, false)).toBe(0.1)
    expect(nextStop(stops, 0.9, 1, true)).toBe(0.1)
    expect(nextStop(stops, 0.1, -1, true)).toBe(0.9)
  })

  it('finds the nearest, and survives having nowhere to go', () => {
    expect(nearestStop(stops, 0.44)).toBe(0.5)
    expect(nearestStop([], 0.44)).toBe(0.44)
    expect(nextStop([], 0.44, 1)).toBe(0.44)
  })

  it('takes the short way round the seam of a closed walk', () => {
    // 0.95 → 0.05 is one step across the seam, not eighteen back through the hall.
    expect(travelBetween(0.95, 0.05, 0.5, true)).toBeCloseTo(0)
    // The same two numbers on an open walk really are far apart.
    expect(travelBetween(0.95, 0.05, 0.5, false)).toBeCloseTo(0.5)
  })

  it('eases with no seam at either end', () => {
    expect(travelEase(0)).toBe(0)
    expect(travelEase(1)).toBe(1)
    expect(travelEase(0.5)).toBeCloseTo(0.5)
    // Clamped, so an overshooting clock cannot fling the camera past the stop.
    expect(travelEase(1.4)).toBe(1)
    expect(travelEase(-0.2)).toBe(0)
    // Slow off the mark: that is what makes it read as a camera move.
    expect(travelEase(0.1)).toBeLessThan(0.02)
  })
})

describe('the stops are where the paper actually is', () => {
  it('a colonnade reports the same positions it placed banners at', () => {
    const o = colonnade.optionsSchema.parse({})
    const n = 12
    const stops = colonnade.walkStops!(n, o)
    expect(stops).toHaveLength(n)
    for (let i = 0; i < n; i++) {
      // The pose reads the same helper, so a stop cannot drift off its banner.
      expect(stops[i]).toBeCloseTo(colonnadeStop(i, n, o.margin), 12)
    }
  })

  it('and keeps them inside the margin the layout left clear', () => {
    const o = colonnade.optionsSchema.parse({ margin: 0.1 })
    for (const s of colonnade.walkStops!(20, o)) {
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(1)
    }
  })

  it('layouts that do not arrange along a path decline to answer', () => {
    expect(getLayout('ring').walkStops).toBeUndefined()
    expect(getLayout('pile').walkStops).toBeUndefined()
  })
})
