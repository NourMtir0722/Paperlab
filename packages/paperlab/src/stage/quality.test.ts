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
  settleTier,
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
      expect(Number(worse.environment)).toBeLessThanOrEqual(Number(better.environment))
      expect(Number(worse.grade)).toBeLessThanOrEqual(Number(better.grade))
    }
  })

  it('the print pass is high-only, and that is a measured budget', () => {
    // Measured on the SwiftShader floor (`pnpm perf --soft`): switching the
    // grade on at `medium` took the frame 51.0 ms → 92.2 ms, 20 fps to 11,
    // while `low` — which never had it — held at 26.1 → 28.4 ms. `medium` is
    // where `auto` STARTS, so paying it there demotes weak machines to `low`
    // and costs them the environment light and the shadow map.
    expect(qualityTiers.high.grade).toBe(true)
    expect(qualityTiers.medium.grade).toBe(false)
    expect(qualityTiers.low.grade).toBe(false)
    // The same tier that already pays for the other full-screen pass.
    expect(qualityTiers.high.contactShadow).toBe(true)
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

  it('drops the studio light only at the bottom, where a texture read per fragment is not free', () => {
    expect(qualityTiers.low.environment).toBe(false)
    expect(qualityTiers.medium.environment).toBe(true)
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

describe('settleTier — the ladder can only settle', () => {
  it('sinks when the floor is missed, and remembers what failed', () => {
    expect(settleTier('high', 10, null)).toEqual({ tier: 'medium', failed: 'high' })
    expect(settleTier('medium', 10, null)).toEqual({ tier: 'low', failed: 'medium' })
  })

  it('cannot sink below the bottom, and does not blame a tier it stayed on', () => {
    expect(settleTier('low', 4, null)).toEqual({ tier: 'low', failed: null })
  })

  it('rises when there is headroom', () => {
    expect(settleTier('low', 120, null)).toEqual({ tier: 'medium', failed: null })
    expect(settleTier('medium', 120, null)).toEqual({ tier: 'high', failed: null })
  })

  it('holds still between the thresholds', () => {
    for (const tier of ['low', 'medium', 'high'] as const) {
      expect(settleTier(tier, 40, null)).toEqual({ tier, failed: null })
    }
  })

  /**
   * The one this function exists for. A machine where the next tier costs
   * more than CEILING/FLOOR (~2.1×) satisfies "promote" at one tier and
   * "demote" at the next, forever — and `high` really is 2.1× `medium` on a
   * software rasterizer. Without the latch this walks up and down until the
   * tab closes, changing the picture every few seconds.
   */
  it('never re-offers a tier that already failed', () => {
    // Comfortable at medium, stalls at high — the pumping machine.
    const fpsAt = (tier: QualityTier) => (tier === 'high' ? 20 : tier === 'medium' ? 60 : 90)

    let tier: QualityTier = 'medium'
    let failed: QualityTier | null = null
    const visited: QualityTier[] = [tier]
    for (let i = 0; i < 40; i++) {
      const verdict = settleTier(tier, fpsAt(tier), failed)
      failed = verdict.failed
      if (verdict.tier !== tier) {
        tier = verdict.tier
        visited.push(tier)
      }
    }
    // It is allowed to try `high` exactly once and fall back for good.
    expect(visited).toEqual(['medium', 'high', 'medium'])
    expect(tier).toBe('medium')
  })

  it('a machine that can hold the top stays there', () => {
    let tier: QualityTier = INITIAL_TIER
    let failed: QualityTier | null = null
    for (let i = 0; i < 20; i++) {
      const verdict = settleTier(tier, 120, failed)
      failed = verdict.failed
      tier = verdict.tier
    }
    expect(tier).toBe('high')
  })
})
