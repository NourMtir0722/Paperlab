import { describe, expect, it, vi } from 'vitest'
import { DamageField } from 'paperlab/fx'
import { FLAME_RADIUS, flameHeat } from './flame'

/**
 * Is the match hot enough to light paper, and cool enough not to light it by
 * accident?
 *
 * Both directions are here because the first version of these numbers failed
 * the first one silently. The gesture worked, the field was painted every
 * frame, every other test passed, and the paper never caught — the flame's
 * rate simply lost to the field's own cooling. That cost a full browser run
 * to find; this costs a second.
 */

vi.setConfig({ testTimeout: 30_000 })

/** Hold the flame on one spot for `seconds`, then let the field burn on alone. */
function hold(seconds: number, after = 2) {
  const field = new DamageField({ seed: 3 })
  const dt = 1 / 60
  let held = 0
  let peakFront = 0
  for (let f = 0; f < Math.round(seconds / dt); f++) {
    held += dt
    field.ignite(0.5, 0.5, FLAME_RADIUS, flameHeat(held, dt))
    peakFront = Math.max(peakFront, field.step(dt).front)
  }
  for (let f = 0; f < Math.round(after / dt); f++) {
    peakFront = Math.max(peakFront, field.step(dt).front)
  }
  return { field, peakFront, remaining: field.lastStats.remaining }
}

describe('the match’s flame', () => {
  it('lights the paper when it is held against it', () => {
    // The case that shipped broken: at 1.6 a second the heat settled at 0.234
    // against an ignition threshold of 0.35, and the sheet never caught.
    const { peakFront, remaining } = hold(1.5)
    expect(peakFront).toBeGreaterThan(0)
    expect(remaining).toBeLessThan(1)
  })

  it('keeps burning once the flame has gone — it is a fire, not a brush', () => {
    const { field } = hold(1.5, 0)
    const burning = field.lastStats.front
    for (let f = 0; f < 60; f++) field.step(1 / 60)
    expect(field.lastStats.front).toBeGreaterThan(0)
    expect(burning).toBeGreaterThan(0)
  })

  it('leaves a mark and no fire when it is only waved past', () => {
    // A hand crossing the sheet spends a few frames over any one spot. If that
    // lit a fire, the page would be alight the first time anyone reached
    // across it — which is what the dwell ramp is for.
    const { peakFront, remaining } = hold(0.1)
    expect(peakFront).toBe(0)
    expect(remaining).toBe(1)
  })
})
