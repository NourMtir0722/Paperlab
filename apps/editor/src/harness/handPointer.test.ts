import { describe, expect, it } from 'vitest'
import { reach } from './handPointer'

describe('reach', () => {
  it('stretches the middle of the frame across the whole canvas', () => {
    expect(reach(0.5)).toBeCloseTo(0.5, 6)
    expect(reach(0.15)).toBeCloseTo(0, 6)
    expect(reach(0.85)).toBeCloseTo(1, 6)
  })

  it('clamps the margins instead of overshooting the canvas', () => {
    expect(reach(0)).toBe(0)
    expect(reach(1)).toBe(1)
    expect(reach(-0.5)).toBe(0)
  })
})
