import { describe, expect, it } from 'vitest'
import { peel } from './peel'
import { unroll } from './unroll'
import { flip } from './flip'
import { getBehavior, listBehaviors } from './registry'
import { behaviorConfigSchema, paperConfigSchema } from '../config/schema'

const sheet = { width: 1, height: 2.6 }

describe('behavior registry', () => {
  it('has the built-in behaviors', () => {
    expect(listBehaviors()).toEqual([
      'peel',
      'unroll',
      'flip',
      'letter-fold',
      'hang',
      'fly',
      'fall',
    ])
  })

  it('throws helpfully on unknown behaviors', () => {
    expect(() => getBehavior('teleport')).toThrow(/Unknown behavior/)
  })
})

describe('peel', () => {
  it('expands human params to a curl instance', () => {
    const stack = peel.stack(
      { progress: 0.4, corner: 'top-left', radius: 0.2 },
      { width: 1, height: 1 },
    )
    expect(stack).toEqual([
      // radius grows with progress: 0.2 + 0.4·0.3
      { type: 'curl', options: { corner: 'top-left', amount: 0.4, radius: 0.32, skew: 0 } },
    ])
  })

  it('handle drag maps pull-distance to progress, clamped to [0, 1]', () => {
    const o = peel.defaults
    const handle = peel.handles![0]!
    // Corner of a 1×1 sheet is (0.5, -0.5); dragging to the center is
    // half-diagonal travel → progress ≈ 1... scaled by diag·0.5.
    const atCorner = handle.drag({ x: 0.5, y: -0.5 }, o, { width: 1, height: 1 })
    expect(atCorner.progress).toBeCloseTo(0, 5)
    const wayPast = handle.drag({ x: -5, y: 5 }, o, { width: 1, height: 1 })
    expect(wayPast.progress).toBe(1)
  })
})

describe('unroll', () => {
  it('progress 0 rolls everything, progress 1 is flat', () => {
    const rolled = unroll.stack({ progress: 0, tightness: 0.5, sway: 0 }, sheet)
    expect(rolled[0]!.options).toMatchObject({ angle: 270, boundary: -1.3 })
    const flat = unroll.stack({ progress: 1, tightness: 0.5, sway: 0 }, sheet)
    // Boundary swept past the bottom edge (+ slack): nothing left to roll.
    expect((flat[0]!.options as { boundary: number }).boundary).toBeGreaterThan(sheet.height / 2)
  })

  it('tightness shrinks the roll radius', () => {
    const loose = unroll.stack({ progress: 0.5, tightness: 0, sway: 0 }, sheet)
    const tight = unroll.stack({ progress: 0.5, tightness: 1, sway: 0 }, sheet)
    const rLoose = (loose[0]!.options as { radius: number }).radius
    const rTight = (tight[0]!.options as { radius: number }).radius
    expect(rLoose).toBeGreaterThan(rTight)
    expect(rTight).toBeGreaterThan(0)
  })

  it('sway loop is transient and bounded', () => {
    const o = { progress: 0.5, tightness: 0.5, sway: 1 }
    for (const t of [0, 0.7, 1.9, 3.2]) {
      const p = unroll.loop!(o, t).progress!
      expect(Math.abs(p - o.progress)).toBeLessThanOrEqual(0.01)
    }
    expect(unroll.loop!({ ...o, sway: 0 }, 1)).toEqual({})
  })
})

describe('flip', () => {
  it('sweeps the roll boundary from the free edge to the spine', () => {
    const s = { width: 1, height: 1.4 }
    const flat = flip.stack({ progress: 0, spine: 'left', radius: 0.3 }, s)
    expect((flat[0]!.options as { boundary: number }).boundary).toBeCloseTo(0.5)
    const turned = flip.stack({ progress: 1, spine: 'left', radius: 0.3 }, s)
    expect((turned[0]!.options as { boundary: number }).boundary).toBeCloseTo(-0.5)
  })
})

describe('behavior config schema', () => {
  it('parses and defaults each behavior type', () => {
    expect(behaviorConfigSchema.parse({ type: 'peel' })).toMatchObject({
      progress: 0.35,
      corner: 'bottom-right',
    })
    expect(behaviorConfigSchema.parse({ type: 'unroll' })).toMatchObject({ tightness: 0.5 })
  })

  it('round-trips a paper config with a behavior', () => {
    const config = paperConfigSchema.parse({
      behavior: { type: 'unroll', progress: 0.7 },
    })
    expect(paperConfigSchema.parse(JSON.parse(JSON.stringify(config)))).toEqual(config)
  })

  it('rejects unknown behavior types', () => {
    expect(() => paperConfigSchema.parse({ behavior: { type: 'teleport' } })).toThrow()
  })
})
