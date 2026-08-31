import { describe, expect, it } from 'vitest'
import { getPreset, listPresets, maxStripLength } from 'paperlab'
import { sheetHeightMax } from './Inspector'

/**
 * A control whose range cannot contain its own value destroys data.
 *
 * Both edit paths in `controls.tsx` clamp to `[min, max]` — the drag and the
 * click-to-type readout — so a slider showing a value from outside its range
 * is not merely mis-drawn. The first touch writes the clamped number back.
 *
 * That is not hypothetical. `height` shipped with `max: 4` while `paper-roll`
 * (5), `paper-ribbon` (6.4) and `toilet-roll` (14) were all taller, so opening
 * any of the three and nudging the slider collapsed the sheet. Nothing failed,
 * because nothing compared a control's range against the presets it had to
 * display.
 */
describe('the sheet height control', () => {
  it('has a range that can hold every built-in preset it will be asked to show', () => {
    for (const name of listPresets()) {
      const config = getPreset(name)
      expect(
        config.sheet.height,
        `${name} is taller than the height slider can represent`,
      ).toBeLessThanOrEqual(sheetHeightMax(config))
      expect(config.sheet.height, `${name} is shorter than the height slider's floor`).toBeGreaterThanOrEqual(
        0.2,
      )
    }
  })

  it('stops a strip at the length its chain can still be drawn at', () => {
    // Past the node-count cap the spacing between nodes grows instead, and the
    // roll comes apart. The ceiling is the sim's, not a comfortable number.
    const config = getPreset('toilet-roll')
    const strip = config.physics as Extract<typeof config.physics, { type: 'strip' }>
    expect(sheetHeightMax(config)).toBeCloseTo(maxStripLength(strip.perforation), 6)
    // 16.44 at the toilet roll's 0.6 spacing: the node count is 439 there and
    // hits its 440 cap just past it.
    expect(sheetHeightMax(config)).toBeGreaterThan(16)
    expect(sheetHeightMax(config)).toBeLessThan(17)
    // And it is genuinely above the preset, so the roll is authorable in both
    // directions rather than pinned at the end of its own track.
    expect(sheetHeightMax(config)).toBeGreaterThan(config.sheet.height)
  })

  it('never offers to write a height the schema would reject', () => {
    // A coarse perforation computes a ceiling of 27 on the node cap alone,
    // while `sheetSchema.height` stops at 20.
    const config = getPreset('toilet-roll')
    const coarse = { ...config, physics: { ...(config.physics as object), perforation: 1 } } as typeof config
    expect(sheetHeightMax(coarse)).toBeLessThanOrEqual(20)
  })

  it('never returns a ceiling below the value it was given', () => {
    // The safety net, for user presets and shared links carrying anything the
    // schema allows (up to 20).
    const config = { ...getPreset('blank-sheet'), sheet: { ...getPreset('blank-sheet').sheet, height: 19 } }
    expect(sheetHeightMax(config)).toBeGreaterThanOrEqual(19)
  })
})
