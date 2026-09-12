import { describe, expect, it } from 'vitest'
import { wispAlpha } from './FxWisps'

/**
 * A wisp point's opacity has to be a number, whatever its age.
 *
 * The inline version was NaN for every dead point — a negative base to a
 * fractional power — and NaN in one vertex was enough to put NaN pixels in
 * the HDR frame, which bloom spread into white suns across the paper during
 * the smoulder. Ages here include the ones the wisp actually produces:
 * never-born points are a billion seconds old.
 */
describe('wispAlpha', () => {
  it('is a finite number for every age a point can have', () => {
    for (const age of [-1e9, -1, 0, 0.1, 0.25, 1, 3.3, 3.4, 3.5, 10, 1e9, Number.POSITIVE_INFINITY]) {
      expect(Number.isFinite(wispAlpha(age))).toBe(true)
    }
    expect(Number.isNaN(wispAlpha(Number.NaN))).toBe(false)
  })

  it('is zero for a point that is not alive, and never negative', () => {
    for (const age of [-1, 3.4, 4, 1e9]) expect(wispAlpha(age)).toBe(0)
    for (let age = 0; age < 3.4; age += 0.05) expect(wispAlpha(age)).toBeGreaterThanOrEqual(0)
  })

  it('fades in and out rather than switching', () => {
    expect(wispAlpha(0)).toBe(0)
    expect(wispAlpha(0.5)).toBeGreaterThan(wispAlpha(0.05))
    expect(wispAlpha(3.3)).toBeLessThan(wispAlpha(1))
  })
})
