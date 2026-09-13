import { describe, expect, it } from 'vitest'
import {
  FIRE_GLOW,
  FIRE_ZONES,
  FX_BLOOM_THRESHOLD,
  PAPER_WHITE,
  emit,
  emitHex,
  hexToLinear,
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

    it('each zone of a flame is brighter AND yellower than the one outside it', () => {
      // The order a hot body glows in: tip, body, core. Breaking it is how the
      // dim parts of a flame came out dark yellow — olive — when hue was once
      // chosen apart from brightness. Colour may be tuned freely in the lab;
      // the defaults keep this order.
      const z = FIRE_ZONES
      const lum = (hex: string) => luminance(hexToLinear(hex))
      expect(lum(z.tip.color)).toBeLessThan(lum(z.body.color))
      expect(lum(z.body.color)).toBeLessThan(lum(z.core.color))
      expect(lum(z.tip.color) * z.tip.glow).toBeLessThan(lum(z.body.color) * z.body.glow)
      expect(lum(z.body.color) * z.body.glow).toBeLessThan(lum(z.core.color) * z.core.glow)
    })

    it('a flame tip is dimmer than its body', () => {
      // How bright the body is against paper white is a judgement that has
      // gone both ways (see `FireZones`), so it is not asserted. The tip
      // burning off dimmer than the body it comes from is not a judgement.
      expect(FIRE_ZONES.tip.glow).toBeLessThan(FIRE_ZONES.body.glow)
    })

    it('no zone but the core could ever clear the bloom threshold', () => {
      // The defaults (Noor, 2026-09-13) author nothing past it at all, and let
      // the bloom's strength carry the glow — so there is no floor on the
      // core here any more. What stays is the ceiling on everything else: if
      // the body or tip cleared it, the whole flame would bloom into a blob.
      const z = FIRE_ZONES
      const lum = (hex: string) => luminance(hexToLinear(hex))
      expect(lum(z.body.color) * z.body.glow * PAPER_WHITE).toBeLessThan(FX_BLOOM_THRESHOLD)
      expect(lum(z.tip.color) * z.tip.glow * PAPER_WHITE).toBeLessThan(FX_BLOOM_THRESHOLD)
      expect(z.core.glow).toBeLessThanOrEqual(FIRE_GLOW[1])
    })

    it('the zones come in order up the flame, and the blue root is at most a trace', () => {
      const z = FIRE_ZONES
      // Colour bands, on temperature. (Where the flame starts, tip.from, is on
      // the soot's own axis and has no order against these.)
      expect(z.tip.to).toBeLessThan(z.core.from)
      expect(z.tip.from).toBeGreaterThanOrEqual(0)
      // Blue light over cream paper reads lavender; more than a trace of it is
      // for someone to dial in, not a default.
      expect(z.root.amount).toBeLessThanOrEqual(0.05)
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
