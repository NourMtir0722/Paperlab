import { describe, expect, it } from 'vitest'
import { SCALE_MAX, SCALE_MIN, SCALE_STEP, Span, quantiseScale } from './span'

describe('quantiseScale', () => {
  it('lands on whole steps, and does not drift off them', () => {
    expect(quantiseScale(1.01)).toBe(1)
    expect(quantiseScale(1.09)).toBe(1.08)
    expect(quantiseScale(0.9)).toBe(0.92)
    expect(quantiseScale(0.99)).toBe(1)
  })
})

describe('Span', () => {
  const hold = (span: Span, gap: number, frames = 4) => {
    let scale = 1
    for (let i = 0; i < frames; i++) scale = span.push(gap)
    return scale
  }

  it('changes nothing when the hands go up', () => {
    // The gesture is SPREADING your hands, not holding them at some absolute
    // width — so raising them at any distance must not resize the sheet.
    const span = new Span()
    expect(hold(span, 3)).toBe(1)
    expect(new Span().push(0.4)).toBe(1)
  })

  it('grows and shrinks the sheet with the gap', () => {
    const span = new Span()
    hold(span, 2)
    expect(hold(span, 3)).toBeCloseTo(1.48, 2)
    expect(hold(span, 1)).toBeCloseTo(0.52, 2)
  })

  it('stays put until the hands move past a step', () => {
    const span = new Span()
    hold(span, 2)
    expect(hold(span, 2 * (1 + SCALE_STEP * 0.5))).toBe(1)
    expect(hold(span, 2 * (1 + SCALE_STEP * 0.8))).toBeGreaterThan(1)
  })

  it('refuses to shrink the sheet away or blow it up', () => {
    const span = new Span()
    hold(span, 2)
    expect(hold(span, 200)).toBeCloseTo(SCALE_MAX, 2)
    span.reset()
    hold(span, 2)
    expect(hold(span, 0.001)).toBeCloseTo(SCALE_MIN, 2)
  })

  it('keeps the size when the hands come down', () => {
    const span = new Span()
    hold(span, 2)
    hold(span, 3)
    const sized = span.value
    expect(span.push(null)).toBe(sized)
    expect(span.engaged).toBe(false)
  })

  it('picks the gesture back up from the size the sheet is', () => {
    // Re-anchoring against the current scale. Without it, raising your hands
    // a second time snaps the sheet back to whatever the new gap implies.
    const span = new Span()
    hold(span, 2)
    hold(span, 2.5)
    const sized = span.value
    span.push(null)
    expect(hold(span, 0.5)).toBe(sized)
    expect(hold(span, 0.6)).toBeCloseTo(sized * 1.2, 1)
  })

  it('ignores a gap that cannot be measured', () => {
    const span = new Span()
    expect(span.push(0)).toBe(1)
    expect(span.engaged).toBe(false)
  })
})
