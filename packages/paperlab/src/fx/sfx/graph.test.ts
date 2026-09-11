import { describe, expect, it } from 'vitest'
import {
  FxAudio,
  type AudioBufferLike,
  type AudioLike,
  type AudioNodeLike,
  type BufferSourceLike,
  type GainLike,
} from './graph'

/**
 * Everything here is POLICY — how many voices there may be, which one gets
 * taken away when there is no room, what happens before a user gesture has
 * unlocked anything. None of it needs a browser, and all of it is the part
 * that goes wrong: a ceiling that does not hold is an unbounded number of
 * live nodes on a phone, and a stealing rule that picks the wrong victim
 * silences the sound the viewer just caused.
 *
 * The DSP — which filter, what envelope — is the part only a browser can run
 * and the part you can hear is wrong. That is what `FxAudio.test()` is for.
 */

class FakeParam {
  value = 1
  readonly calls: string[] = []
  setValueAtTime(value: number, when: number) {
    this.value = value
    this.calls.push(`set ${value} @${when}`)
  }
  linearRampToValueAtTime(value: number, when: number) {
    this.calls.push(`ramp ${value} @${when}`)
  }
  cancelScheduledValues(when: number) {
    this.calls.push(`cancel @${when}`)
  }
}

class FakeNode implements AudioNodeLike {
  connected: AudioNodeLike[] = []
  disconnected = false
  connect(destination: AudioNodeLike) {
    this.connected.push(destination)
  }
  disconnect() {
    this.disconnected = true
  }
}

class FakeGain extends FakeNode implements GainLike {
  readonly gain = new FakeParam()
}

class FakeSource extends FakeNode implements BufferSourceLike {
  buffer: AudioBufferLike | null = null
  loop = false
  started: number | null = null
  stopped: number | null = null
  onended: (() => void) | null = null
  start(when = 0) {
    this.started = when
  }
  stop(when = 0) {
    this.stopped = when
  }
}

class FakeContext implements AudioLike {
  currentTime = 0
  state: 'suspended' | 'running' | 'closed' = 'suspended'
  readonly sampleRate = 48000
  readonly destination = new FakeNode()
  readonly gains: FakeGain[] = []
  readonly sources: FakeSource[] = []
  closed = false
  resumes = 0
  createGain(): GainLike {
    const gain = new FakeGain()
    this.gains.push(gain)
    return gain
  }
  createBufferSource(): BufferSourceLike {
    const source = new FakeSource()
    this.sources.push(source)
    return source
  }
  createBuffer(_channels: number, length: number): AudioBufferLike {
    const data = new Float32Array(length)
    return { getChannelData: () => data, length }
  }
  async resume() {
    this.resumes++
    this.state = 'running'
  }
  async close() {
    this.closed = true
    this.state = 'closed'
  }
}

const make = (quality: 'low' | 'medium' | 'high' = 'low') => {
  const context = new FakeContext()
  return { context, audio: new FxAudio({ quality, context }) }
}

describe('the audio graph', () => {
  it('does not start a context just by existing', () => {
    // Constructing one shows an indicator in the browser tab. A library that
    // lights that up on import has taken something nobody offered.
    expect(() => new FxAudio({})).toThrow(/needs a context/)
  })

  it('stays locked until a gesture resumes it', async () => {
    const { context, audio } = make()
    expect(audio.isUnlocked).toBe(false)

    await audio.unlock()
    expect(context.resumes).toBe(1)
    expect(audio.isUnlocked).toBe(true)

    // A latch, not a toggle: called again from a second gesture it does
    // nothing rather than resuming a running context.
    await audio.unlock()
    expect(context.resumes).toBe(1)
  })

  it('reports itself still locked if the browser refused to resume', async () => {
    const { context, audio } = make()
    context.resume = async () => {
      context.resumes++
      // Some browsers simply do not resume outside a real gesture.
    }
    await audio.unlock()
    expect(audio.isUnlocked).toBe(false)
  })

  it('never exceeds the tier ceiling, however hard it is asked', () => {
    const { audio } = make('low')
    expect(audio.quality.voices).toBe(6)
    for (let i = 0; i < 50; i++) audio.take('crackle', 0.5)
    expect(audio.voices.length).toBe(6)
  })

  it('gives a bigger tier a bigger pool', () => {
    const { audio } = make('high')
    for (let i = 0; i < 50; i++) audio.take('crackle')
    expect(audio.voices.length).toBe(16)
  })

  it('steals the least deserving voice rather than dropping the new sound', () => {
    const { audio } = make('low')
    // Fill the pool, one of them clearly on its way out.
    for (let i = 0; i < 6; i++) audio.take(`old-${i}`, 0.6)
    const dying = audio.voices[2]!
    dying.priority = 0.05

    const fresh = audio.take('ignition', 0.5)
    expect(fresh).not.toBeNull()
    expect(audio.voices.length).toBe(6)
    // The tail went; the new thing the viewer just caused is playing.
    expect(audio.voices.map((v) => v.id)).not.toContain(dying.id)
    expect(audio.voices.map((v) => v.kind)).toContain('ignition')
  })

  it('breaks a tie by age, so the older of two equals is the one that goes', () => {
    const { context, audio } = make('low')
    const ids: number[] = []
    for (let i = 0; i < 6; i++) {
      context.currentTime = i
      ids.push(audio.take('same', 0.5)!.id)
    }
    context.currentTime = 10
    audio.take('new', 0.5)
    expect(audio.voices.map((v) => v.id)).not.toContain(ids[0])
    expect(audio.voices.map((v) => v.id)).toContain(ids[5])
  })

  it('refuses rather than silencing something more important', () => {
    const { audio } = make('low')
    for (let i = 0; i < 6; i++) audio.take('fire', 0.9)
    // A background hiss does not get to interrupt six burning voices.
    expect(audio.take('dust', 0.2)).toBeNull()
    expect(audio.voices.length).toBe(6)
  })

  it('fades a voice out instead of cutting it, because a cut is a click', () => {
    const { audio } = make('low')
    const voice = audio.take('crumple', 0.5)!
    const param = voice.gain.gain as unknown as { calls: string[] }
    voice.stop()
    expect(audio.voices.length).toBe(0)
    expect(param.calls.some((c) => c.startsWith('cancel'))).toBe(true)
    expect(param.calls.some((c) => c.startsWith('ramp 0'))).toBe(true)
  })

  it('ignores a voice stopped twice', () => {
    const { audio } = make('low')
    const voice = audio.take('crumple')!
    voice.stop()
    voice.stop()
    expect(audio.voices.length).toBe(0)
  })

  it('makes one noise buffer and shares it', () => {
    // A second of audio per crackle would be the single worst allocation in
    // the whole effects layer, and a grain cloud asks for dozens a second.
    const { audio } = make()
    const first = audio.noiseBuffer()
    expect(audio.noiseBuffer()).toBe(first)
    expect(first.length).toBe(48000)
    // Actually noise, not silence.
    const data = first.getChannelData(0)
    // Reduced rather than spread: `Math.max(...data)` on 48,000 samples is
    // one engine's argument limit away from a stack overflow, and it would
    // be a CI-only one.
    let lo = Infinity
    let hi = -Infinity
    let nonZero = false
    for (const v of data) {
      if (v !== 0) nonZero = true
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    expect(nonZero).toBe(true)
    expect(hi).toBeLessThanOrEqual(1)
    expect(lo).toBeGreaterThanOrEqual(-1)
  })

  it('plays the test tone through the same path everything else uses', () => {
    const { context, audio } = make()
    const voice = audio.test(0.2)
    expect(voice).not.toBeNull()
    const source = context.sources.at(-1)!
    expect(source.buffer).toBe(audio.noiseBuffer())
    expect(source.started).toBe(0)
    expect(source.stopped).toBeCloseTo(0.2)
    // It returns its voice when it finishes rather than holding one forever.
    source.onended?.()
    expect(audio.voices.length).toBe(0)
  })

  it('clamps the master volume to something a speaker can take', () => {
    const { audio } = make()
    audio.volume = 4
    expect(audio.volume).toBe(1)
    audio.volume = -1
    expect(audio.volume).toBe(0)
  })

  it('stops everything on demand and on dispose', async () => {
    const { context, audio } = make('low')
    for (let i = 0; i < 4; i++) audio.take('fire')
    audio.stopAll()
    expect(audio.voices.length).toBe(0)

    audio.take('fire')
    await audio.dispose()
    expect(audio.voices.length).toBe(0)
    expect(context.closed).toBe(true)
  })
})
