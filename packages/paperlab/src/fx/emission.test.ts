import { describe, expect, it } from 'vitest'
import {
  FIRE_BODY,
  FIRE_CORE,
  FIRE_GLOW,
  FX_BLOOM_THRESHOLD,
  PAPER_WHITE,
  emit,
  emitHex,
  luminance,
  srgbToLinear,
  timesPaperWhite,
} from './emission'
import { particlePresets } from './particles'

/**
 * The budget every emitter is held to.
 *
 * This test exists because of a specific failure: the fluid's flames — the
 * biggest light in a burning frame — sat at a scene luminance of 1.68 against
 * a bloom threshold of 3.6, so they never bloomed, and the ember preset sat at
 * 3.5× paper white under a comment claiming it cleared 4×. Both were invisible
 * for weeks because nothing converted between the four ways brightness was
 * written down. Now there is one way, and these are the assertions that would
 * have caught both in a second.
 */
describe('the emission unit', () => {
  it('converts sRGB the way a renderer does', () => {
    expect(srgbToLinear(0)).toBe(0)
    expect(srgbToLinear(1)).toBeCloseTo(1, 12)
    // The linear segment below the knee, and a mid grey.
    expect(srgbToLinear(0.04)).toBeCloseTo(0.04 / 12.92, 12)
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214, 3)
  })

  it('emits exactly the brightness it is asked for, whatever the hue', () => {
    for (const hex of ['#FFC271', '#FF5512', '#FFFFFF', '#8A4F24', '#FEFBE0']) {
      for (const times of [0.5, 1, 4, 6, 8]) {
        expect(timesPaperWhite(emitHex(hex, times))).toBeCloseTo(times, 6)
      }
    }
  })

  it('keeps the hue while changing the brightness', () => {
    // Two brightnesses of one colour differ by a scalar, so their ratios match.
    const dim = emitHex('#FFC271', 1)
    const bright = emitHex('#FFC271', 6)
    expect(bright[0] / dim[0]).toBeCloseTo(6, 6)
    expect(bright[1] / dim[1]).toBeCloseTo(6, 6)
    expect(bright[2] / dim[2]).toBeCloseTo(6, 6)
  })

  it('has no hue to scale when there is no light', () => {
    expect(emit([0, 0, 0], 8)).toEqual([0, 0, 0])
  })

  it('sets the bloom threshold above paper and says so as a multiple', () => {
    expect(FX_BLOOM_THRESHOLD).toBeGreaterThan(PAPER_WHITE)
    expect(FX_BLOOM_THRESHOLD / PAPER_WHITE).toBeCloseTo(2.25, 6)
  })

  describe('what each emitter is worth, in multiples of paper white', () => {
    it('a spark at its hottest is inside the spec band, and blooms', () => {
      const hot = particlePresets.ember.color[0]
      const x = timesPaperWhite(hot)
      expect(x).toBeGreaterThanOrEqual(FIRE_GLOW[0])
      expect(x).toBeLessThanOrEqual(FIRE_GLOW[1])
      expect(luminance(hot)).toBeGreaterThan(FX_BLOOM_THRESHOLD)
    })

    it('and as it dies it drops UNDER the threshold, so it stops glowing', () => {
      const cold = particlePresets.ember.color[1]
      expect(luminance(cold)).toBeLessThan(FX_BLOOM_THRESHOLD)
      // Still warm, not black: it fades out of glowing, it does not switch off.
      expect(timesPaperWhite(cold)).toBeGreaterThan(0.3)
    })

    it('a flame body sits BELOW paper, where the tone curve still has colour', () => {
      // This assertion used to read `FIRE_BODY > 1` — a flame has to be
      // brighter than the paper to be a light — and that reasoning produced
      // the salmon the spec forbids. The tone curve rolls everything
      // approaching white toward white, hue and all, and paper white is
      // already at the top of it: a body brighter than paper therefore lands
      // where the curve has no saturation left, and comes out the same
      // near-white as the sheet with a pink cast on it.
      //
      // A flame is only over-exposed in its CORE. Its body is what carries
      // the colour, and colour only survives in the mid-tones.
      expect(FIRE_BODY).toBeLessThan(1)
      expect(FIRE_BODY).toBeGreaterThan(0.2)
      expect(FIRE_BODY * PAPER_WHITE).toBeLessThan(FX_BLOOM_THRESHOLD)
    })

    it('a flame core clears the threshold and lands inside the spec band', () => {
      // The core is the only term allowed to over-expose, so it alone has to
      // carry the whole of §4.3's 4-8x.
      const peak = FIRE_BODY + FIRE_CORE
      expect(peak * PAPER_WHITE).toBeGreaterThan(FX_BLOOM_THRESHOLD)
      expect(peak).toBeGreaterThanOrEqual(FIRE_GLOW[0])
      expect(peak).toBeLessThanOrEqual(FIRE_GLOW[1])
    })

    it('smoke and ash never glow — they are lit, not emitting', () => {
      for (const name of ['smoke', 'ash'] as const) {
        for (const c of particlePresets[name].color) {
          expect(luminance(c)).toBeLessThan(FX_BLOOM_THRESHOLD)
          expect(luminance(c)).toBeLessThan(PAPER_WHITE)
        }
      }
    })
  })
})
