import { describe, expect, it } from 'vitest'
import { Breath, PUCKER_AT, WIND_STEP, blowFromPucker, quantiseWind, windFromBlow } from './breath'

describe('blowFromPucker', () => {
  it('spends the bottom of the range, because a resting mouth is not zero', () => {
    expect(blowFromPucker(0)).toBe(0)
    expect(blowFromPucker(PUCKER_AT)).toBe(0)
    expect(blowFromPucker(1)).toBe(1)
  })
})

describe('windFromBlow', () => {
  it('leaves the wind the sheet was given alone until someone blows', () => {
    expect(windFromBlow(0, 0.25)).toBe(0.25)
    expect(windFromBlow(1, 0.25)).toBe(1)
  })
})

describe('quantiseWind', () => {
  it('lands on whole steps, and does not drift off them', () => {
    expect(quantiseWind(0.263)).toBe(0.25)
    expect(quantiseWind(0.28)).toBe(0.3)
    expect(quantiseWind(0.25)).toBe(0.25)
  })
})

describe('Breath', () => {
  const settle = (breath: Breath, pucker: number | null, frames = 60) => {
    let wind = 0
    for (let i = 0; i < frames; i++) wind = breath.push(pucker)
    return wind
  }

  it('rests at the wind the sheet was given, and rises when blown at', () => {
    const breath = new Breath(0.25)
    expect(breath.push(null)).toBe(0.25)
    expect(settle(breath, 1)).toBe(1)
  })

  it('falls back when the blowing stops', () => {
    const breath = new Breath(0.25)
    settle(breath, 1)
    expect(settle(breath, null)).toBe(0.25)
  })

  it('takes a few frames to believe a reading', () => {
    // Blendshapes are noisy frame to frame, and an unsmoothed one would put
    // a gale through the paper every time the tracker blinked.
    const breath = new Breath(0.25)
    expect(breath.push(1)).toBeLessThan(0.6)
  })

  it('publishes a step at a time, not every frame', () => {
    // Every published value is a React render of the tree that owns the
    // canvas, so a wind that moved continuously would re-render continuously.
    const breath = new Breath(0)
    const seen = new Set<number>()
    for (let i = 0; i < 120; i++) seen.add(breath.push(i < 60 ? 1 : 0))
    for (const wind of seen) expect(Math.round(wind / WIND_STEP) * WIND_STEP).toBeCloseTo(wind, 6)
    expect(seen.size).toBeLessThan(30)
  })

  it('forgets a blow on reset', () => {
    const breath = new Breath(0.25)
    settle(breath, 1)
    breath.reset()
    expect(breath.blow).toBe(0)
  })
})
