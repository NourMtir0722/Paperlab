import { describe, expect, it } from 'vitest'
import { ASPECT, POSES, hand } from './hands.fixtures'
import { GestureReader, classify } from './gestures'

/** Push one pose through the reader until it settles, then report the name. */
function settle(reader: GestureReader, pose: ReturnType<typeof hand> | null, frames = 4) {
  let last = reader.read(pose, ASPECT)
  for (let i = 1; i < frames; i++) last = reader.read(pose, ASPECT)
  return last
}

describe('classify', () => {
  it('names the four poses', () => {
    expect(classify(POSES.palm(), ASPECT, false).name).toBe('palm')
    expect(classify(POSES.fist(), ASPECT, false).name).toBe('fist')
    expect(classify(POSES.pinch(), ASPECT, false).name).toBe('pinch')
    expect(classify(POSES.point(), ASPECT, false).name).toBe('point')
  })

  it('does not mistake a fist for a pinch', () => {
    // The one that matters. A fist closes the thumb onto the index as tightly
    // as a pinch does, so anything reading the aperture alone calls it a
    // pinch — and the paper gets grabbed every time you try to crush it.
    const fist = POSES.fist()
    expect(classify(fist, ASPECT, false).aperture!).toBeLessThan(0.45)
    expect(classify(fist, ASPECT, false).name).toBe('fist')
  })

  it('still refuses to call a fist a pinch mid-grab', () => {
    // `wasPinching` widens the pinch threshold. It must not widen it so far
    // that closing your hand around the paper keeps reading as a hold.
    expect(classify(POSES.fist(), ASPECT, true).name).toBe('fist')
  })

  it('holds a pinch open wider than it closes it', () => {
    const marginal = hand({ reach: [1.5, 2, 2, 2], gap: 0.55 })
    expect(classify(marginal, ASPECT, false).name).not.toBe('pinch')
    expect(classify(marginal, ASPECT, true).name).toBe('pinch')
  })

  it('reports nothing it cannot measure', () => {
    expect(classify([], ASPECT, false)).toEqual({ name: 'none', aperture: null, curl: null, grasp: null })
  })
})

describe('GestureReader', () => {
  it('makes a new gesture prove itself before switching', () => {
    const reader = new GestureReader()
    settle(reader, POSES.palm())
    // One stray frame of a fist is a tracking blip, not a decision.
    expect(reader.read(POSES.fist(), ASPECT).name).toBe('palm')
    expect(reader.read(POSES.fist(), ASPECT).name).toBe('palm')
    expect(reader.read(POSES.fist(), ASPECT).name).toBe('fist')
  })

  it('lets go the instant the pinch opens', () => {
    // No debounce on release: a lagging one reads as the paper being stuck.
    const reader = new GestureReader()
    expect(settle(reader, POSES.pinch()).name).toBe('pinch')
    expect(reader.read(POSES.palm(), ASPECT).name).not.toBe('pinch')
  })

  it('drops everything when the hand leaves the frame', () => {
    const reader = new GestureReader()
    expect(settle(reader, POSES.pinch()).name).toBe('pinch')
    expect(reader.read(null, ASPECT).name).toBe('none')
  })

  it('carries the continuous signals through, not just the name', () => {
    const reader = new GestureReader()
    const frame = settle(reader, POSES.fist())
    expect(frame.curl!).toBeCloseTo(1, 6)
    expect(frame.grasp!).toBeCloseTo(1, 6)
  })

  it('reset forgets a held gesture', () => {
    const reader = new GestureReader()
    settle(reader, POSES.pinch())
    reader.reset()
    expect(reader.read(POSES.fist(), ASPECT).name).toBe('none')
  })
})
