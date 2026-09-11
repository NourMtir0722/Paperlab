import { describe, expect, it } from 'vitest'
import type { FieldStats } from '../field'
import { FireSound } from './fire'
import { FakeContext, type FakeFilter, type FakeParam } from './fixtures'
import { FxAudio } from './graph'

/**
 * The fire's voice, against a recording graph.
 *
 * What matters here is not "a sound played" but that the RIGHT number drives
 * each part: the bed follows the front's length, the crackle follows the rate
 * paper chars, and a fire that goes out stops. Those are the claims that keep
 * the sound and the picture from drifting apart, and a stub can check every
 * one of them.
 */

const quiet: FieldStats = { front: 0, charred: 0, consumed: 0, wetted: 0, saturation: 0, remaining: 1 }
const burning = (front: number, charred = 0): FieldStats => ({ ...quiet, front, charred })

function make(quality: 'low' | 'medium' | 'high' = 'high') {
  const context = new FakeContext()
  const audio = new FxAudio({ quality, context })
  return { context, audio, fire: new FireSound(audio) }
}

/**
 * Let time pass: every source that was told to stop, and every one started
 * with a duration of its own, ends.
 *
 * The second half matters here and nowhere else — a crackle is never stopped
 * by anything, it is started with a length and the browser ends it. A stub
 * that only ended what was explicitly stopped would leave every crackle
 * playing forever and report a leak that does not exist.
 */
const finish = (context: FakeContext) => {
  for (const source of context.sources) {
    if ((source.stopped !== null || source.duration !== null) && !source.disconnected) source.onended?.()
  }
}

const bedGain = (context: FakeContext) => context.gains[1]!.gain as unknown as FakeParam

describe('the fire voice', () => {
  it('says nothing about a sheet that is not burning', () => {
    const { context, audio, fire } = make()
    for (let i = 0; i < 10; i++) fire.update(1 / 60, quiet)
    expect(fire.burning).toBe(false)
    expect(audio.voices.length).toBe(0)
    expect(context.sources.length).toBe(0)
  })

  it('lays a looping bed of filtered noise once there is a front', () => {
    const { context, audio, fire } = make()
    fire.update(1 / 60, burning(0.01))
    expect(fire.burning).toBe(true)
    expect(audio.voices.map((v) => v.kind)).toEqual(['fire-bed'])
    const source = context.sources[0]!
    expect(source.loop).toBe(true)
    expect(source.buffer).toBe(audio.noiseBuffer())
    expect(source.started).not.toBeNull()
    // Through a band of the spectrum, not raw.
    expect(context.filters[0]!.type).toBe('bandpass')
    expect(source.connected).toContain(context.filters[0])
  })

  it('follows the LENGTH of the front, not the area burnt', () => {
    // A fire gets louder as its edge gets longer. A nearly-consumed sheet is
    // quiet again — which a level driven by char would get backwards.
    const small = make()
    const big = make()
    for (let i = 0; i < 30; i++) {
      small.fire.update(1 / 60, burning(0.004))
      big.fire.update(1 / 60, burning(0.04))
    }
    const quietLevel = bedGain(small.context).ramped!
    const loudLevel = bedGain(big.context).ramped!
    expect(loudLevel).toBeGreaterThan(quietLevel * 2)
    // And it is brighter, not just louder.
    const brightness = (c: FakeContext) => (c.filters[0]! as FakeFilter).frequency.value
    expect(brightness(big.context)).toBeGreaterThan(brightness(small.context))
  })

  it('arrives from silence rather than clicking in', () => {
    const { context, fire } = make()
    fire.update(1 / 60, burning(0.04))
    expect(bedGain(context).calls[0]).toMatch(/^set 0 /)
  })

  it('stops the bed when the fire goes out', () => {
    const { context, audio, fire } = make()
    for (let i = 0; i < 30; i++) fire.update(1 / 60, burning(0.02))
    for (let i = 0; i < 60; i++) fire.update(1 / 60, quiet)
    expect(fire.burning).toBe(false)
    expect(context.sources[0]!.stopped).not.toBeNull()
    finish(context)
    expect(audio.voices.length).toBe(0)
  })

  it('crackles at the rate the paper chars, each its own slice of noise', () => {
    const { context, fire } = make()
    // Ten texels charring a frame for thirty frames: 300 × 0.3 ≈ 90 crackles,
    // under the four-a-frame ceiling throughout.
    for (let i = 0; i < 30; i++) {
      context.currentTime += 1 / 60
      fire.update(1 / 60, burning(0.02, 10))
    }
    const crackles = context.sources.filter((s) => s.duration !== null)
    expect(crackles.length).toBeGreaterThan(60)
    expect(crackles.length).toBeLessThan(120)
    // Each ends itself, from somewhere of its own in the shared buffer.
    for (const source of crackles) {
      expect(source.duration!).toBeGreaterThan(0)
      expect(source.offset!).toBeGreaterThanOrEqual(0)
    }
    expect(new Set(crackles.map((s) => s.offset)).size).toBeGreaterThan(crackles.length / 2)
    // Bright and narrow, not a small copy of the rumble.
    const bands = context.filters.slice(1)
    expect(bands.every((f) => f.frequency.value > 1000)).toBe(true)
  })

  it('will not spend a whole frame on crackles when a sheet catches at once', () => {
    const { context, fire } = make()
    fire.update(1 / 60, burning(0.02, 500))
    // The bed, and no more than the per-frame ceiling of crackles.
    expect(context.sources.filter((s) => s.duration !== null).length).toBe(4)
    // And the backlog is not paid back as a burst on the next frame either.
    context.currentTime += 1 / 60
    fire.update(1 / 60, burning(0.02, 0))
    expect(context.sources.filter((s) => s.duration !== null).length).toBe(8)
  })

  it('keeps the bed when crackles fill the pool', () => {
    // The bed IS the fire. A burning sheet that sounds like static because
    // its crackles stole the bed is the failure this priority exists for.
    const { audio, fire, context } = make('low')
    for (let i = 0; i < 20; i++) {
      context.currentTime += 1 / 60
      fire.update(1 / 60, burning(0.03, 40))
    }
    expect(audio.voices.length).toBeLessThanOrEqual(6)
    expect(audio.voices.map((v) => v.kind)).toContain('fire-bed')
    expect(fire.burning).toBe(true)
  })

  it('places the fire in the room when it is told where the sheet is', () => {
    const { context, fire } = make()
    fire.update(1 / 60, burning(0.02), { x: 1.5, y: -0.5, z: 2 })
    const panner = context.panners[0]!
    expect(panner.positionX.value).toBe(1.5)
    expect(panner.positionZ.value).toBe(2)
    expect(context.filters[0]!.connected).toContain(panner)
  })

  it('makes no panner at all when it is not placed', () => {
    // A sheet filling the frame is not somewhere else in the room, and a
    // panner it did not need is a node per burn for nothing.
    const { context, fire } = make()
    fire.update(1 / 60, burning(0.02))
    expect(context.panners.length).toBe(0)
  })

  it('lets go of the filters it made', () => {
    // Every crackle makes its own filter, dozens a second. Left connected to
    // a freed gain they are the same leak the sources used to have.
    const { context, audio, fire } = make()
    for (let i = 0; i < 20; i++) {
      context.currentTime += 1 / 60
      fire.update(1 / 60, burning(0.02, 8))
    }
    fire.stop()
    finish(context)
    expect(audio.voices.length).toBe(0)
    expect(context.filters.every((f) => f.disconnected)).toBe(true)
  })

  it('crackles the same way twice from the same seed', () => {
    const run = () => {
      const context = new FakeContext()
      const audio = new FxAudio({ quality: 'high', context })
      const fire = new FireSound(audio, { seed: 21 })
      for (let i = 0; i < 20; i++) {
        context.currentTime += 1 / 60
        fire.update(1 / 60, burning(0.02, 6))
      }
      return context.filters.map((f) => f.frequency.value)
    }
    expect(run()).toEqual(run())
  })
})
