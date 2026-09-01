import { describe, expect, it } from 'vitest'
import { DETENT, DIAL, DIAL_STEP, dialIndex, dialStock, turnedBy } from './dial'

describe('dialIndex', () => {
  const last = DIAL.length - 1

  it('changes nothing when the hand goes up without turning', () => {
    // The rule the whole design rests on. An open palm also means "put the
    // paper back", so a palm that has not turned must not swap the material.
    expect(dialIndex(0, 2, 2)).toBe(2)
    expect(dialIndex(0, 5, 5)).toBe(5)
  })

  it('moves a stock for a step of turn', () => {
    expect(dialIndex(DIAL_STEP, 2, 2)).toBe(3)
    expect(dialIndex(-DIAL_STEP, 2, 2)).toBe(1)
  })

  it('stays put until the hand turns past a detent', () => {
    expect(dialIndex(DIAL_STEP * 0.5, 2, 2)).toBe(2)
    expect(dialIndex(DIAL_STEP * (DETENT + 0.05), 2, 2)).toBe(3)
  })

  it('does not count the same turn twice as the dial moves under it', () => {
    // The anchor stays where the hand engaged; only the stock it is on
    // changes. Measuring the turn from the CURRENT stock would advance the
    // dial again on every frame of one continuous rotation.
    expect(dialIndex(DIAL_STEP * 1.1, 2, 3)).toBe(3)
    expect(dialIndex(DIAL_STEP * 2, 2, 3)).toBe(4)
  })

  it('clamps at the ends rather than wrapping', () => {
    // A wrap would take an over-rotated wrist from vellum back to kraft.
    expect(dialIndex(-4000, 3, 3)).toBe(0)
    expect(dialIndex(4000, 3, 3)).toBe(last)
  })

  it('survives an index from outside the dial', () => {
    expect(dialStock(-1)).toBe(DIAL[0])
    expect(dialStock(99)).toBe(DIAL[last])
  })
})

describe('turnedBy', () => {
  it('takes the short way round, so passing straight up is not a full sweep', () => {
    expect(turnedBy(170, -170)).toBeCloseTo(20, 6)
    expect(turnedBy(-170, 170)).toBeCloseTo(-20, 6)
    expect(turnedBy(10, 40)).toBeCloseTo(30, 6)
  })
})
