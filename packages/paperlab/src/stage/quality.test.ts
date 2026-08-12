import { describe, expect, it } from 'vitest'
import {
  FIRST_WINDOW,
  INITIAL_TIER,
  SETTLE_FRAMES,
  STEADY_WINDOW,
  TIER_ORDER,
  qualityFor,
  qualityNames,
  qualityTiers,
  tierDown,
  tierUp,
  type QualityTier,
} from './quality'
import { stageSchema } from './schema'

describe('quality tiers', () => {
  it('every knob gets cheaper as the tier drops', () => {
    for (let i = 1; i < TIER_ORDER.length; i++) {
      const worse = qualityTiers[TIER_ORDER[i - 1]!]
      const better = qualityTiers[TIER_ORDER[i]!]
      expect(worse.dpr).toBeLessThanOrEqual(better.dpr)
      expect(worse.shadowMapSize).toBeLessThanOrEqual(better.shadowMapSize)
      expect(worse.segments).toBeLessThanOrEqual(better.segments)
    }
  })

  it('the cheapest tier still draws a readable scene', () => {
    // Paper with too few subdivisions cannot hold a fold, and a stage
    // without a backdrop is the black void we removed on purpose.
    expect(qualityTiers.low.segments).toBeGreaterThanOrEqual(24)
    expect(qualityTiers.low.surround).toBe(true)
  })

  it('drops the shadow pass only at the bottom', () => {
    expect(qualityTiers.low.shadowMapSize).toBe(0)
    expect(qualityTiers.medium.shadowMapSize).toBeGreaterThan(0)
  })

  it('auto resolves to a tier that exists, and starts in the middle', () => {
    expect(qualityFor('auto')).toEqual(qualityTiers[INITIAL_TIER])
    expect(INITIAL_TIER).toBe('medium')
    for (const name of qualityNames) expect(qualityFor(name)).toBeDefined()
  })

  it('stepping saturates instead of running off either end', () => {
    expect(tierUp('high')).toBe('high')
    expect(tierDown('low')).toBe('low')
    expect(tierUp('low')).toBe('medium')
    expect(tierDown('high')).toBe('medium')
    // Round trips land where they started.
    for (const tier of TIER_ORDER) {
      expect(tierDown(tierUp(tier as QualityTier))).toBe(tier === 'high' ? 'medium' : tier)
    }
  })

  it('is NOT part of the scene — a shared link must not carry a device setting', () => {
    // Two people opening the same link should see the same scene, each at
    // whatever fidelity their own hardware can hold.
    const parsed = stageSchema.parse({}) as Record<string, unknown>
    expect(parsed.quality).toBeUndefined()
    expect(Object.keys(parsed)).not.toContain('quality')
  })
})

describe('how fast auto reacts', () => {
  it('judges the first frames quickly and later ones carefully', () => {
    // A machine that cannot hold the opening scene should not stutter
    // through a hundred frames before anything is done about it.
    expect(FIRST_WINDOW).toBeLessThan(STEADY_WINDOW)
    // At 20fps — the case this exists for — the first correction lands
    // inside about a second.
    expect(FIRST_WINDOW / 20).toBeLessThan(1.5)
  })

  it('leaves room for the new programs and shadow maps to land', () => {
    expect(SETTLE_FRAMES).toBeGreaterThan(20)
    // But never so long that a second correction takes longer than the first.
    expect(SETTLE_FRAMES).toBeLessThan(STEADY_WINDOW)
  })
})
