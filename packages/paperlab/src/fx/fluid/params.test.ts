import { describe, expect, it } from 'vitest'
import { fireFluidControls, fireFluidDefaults, solverUniforms } from './params'

describe('the fire simulator controls', () => {
  it('gives every default a slider that can reach it', () => {
    for (const c of fireFluidControls) {
      const value = fireFluidDefaults[c.key]
      expect(value).toBeGreaterThanOrEqual(c.min)
      expect(value).toBeLessThanOrEqual(c.max)
    }
  })

  /**
   * A default pinned to the end of its own slider is a bug report about the
   * slider, not a setting.
   *
   * This replaced a test that asserted four defaults were four specific
   * numbers, which is a test that can only ever be wrong or redundant — it
   * pinned `flamePersistence` to 0.005, and 0.005 was the slider's FLOOR,
   * which is to say the flame channel's history was switched off and the test
   * was holding it there. The review found the same shape of thing all over
   * the look panel: `lipBrightness`, `charWarmth` and `charCracks` all sat at
   * their maxima, and a control at its limit means the problem is underneath.
   *
   * So: every default has to have somewhere to go in both directions.
   */
  it('never leaves a default at the end of its own slider', () => {
    for (const c of fireFluidControls) {
      const value = fireFluidDefaults[c.key]
      const room = (c.max - c.min) * 0.02
      expect(value, `${c.key} sits at its slider's floor (${c.min})`).toBeGreaterThan(c.min + room)
      expect(value, `${c.key} sits at its slider's ceiling (${c.max})`).toBeLessThan(c.max - room)
    }
  })

  it('turns them into finite solver numbers, whatever a slider sends', () => {
    const u = solverUniforms({ ...fireFluidDefaults, fuel: Number.NaN, cooling: Number.POSITIVE_INFINITY })
    for (const value of Object.values(u).flat()) expect(Number.isFinite(value)).toBe(true)
    expect(u.fuel).toBe(0)
  })

  it('rises: the default initial velocity points up', () => {
    expect(solverUniforms(fireFluidDefaults).initialVelocity[1]).toBeGreaterThan(0)
  })
})
