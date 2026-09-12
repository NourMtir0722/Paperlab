import type {
  AudioBufferLike,
  AudioLike,
  AudioNodeLike,
  BiquadFilterLike,
  BufferSourceLike,
  GainLike,
  PannerLike,
} from './graph'

/**
 * A Web Audio graph that records instead of making a sound.
 *
 * Shared by every audio test here, because `AudioLike` is deliberately the
 * smallest surface the effects layer needs — so each node added to it is a new
 * thing to stub, and stubbing it twice is how two tests come to disagree about
 * what a browser does.
 */

export class FakeParam {
  value = 1
  readonly calls: string[] = []
  setValueAtTime(value: number, when: number) {
    this.value = value
    this.calls.push(`set ${value} @${when}`)
  }
  linearRampToValueAtTime(value: number, when: number) {
    this.value = value
    this.calls.push(`ramp ${value} @${when}`)
  }
  cancelScheduledValues(when: number) {
    this.calls.push(`cancel @${when}`)
  }
  /** The value of the last ramp asked for, which is where a fade is heading. */
  get ramped(): number | null {
    const last = [...this.calls].reverse().find((c) => c.startsWith('ramp '))
    return last ? Number(last.split(' ')[1]) : null
  }
}

/** Not exported: every fake below is one, and no test needs to name it. */
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

export class FakeGain extends FakeNode implements GainLike {
  readonly gain = new FakeParam()
}

export class FakeFilter extends FakeNode implements BiquadFilterLike {
  type: BiquadFilterLike['type'] = 'lowpass'
  readonly frequency = new FakeParam()
  readonly Q = new FakeParam()
}

export class FakePanner extends FakeNode implements PannerLike {
  panningModel: PannerLike['panningModel'] = 'equalpower'
  distanceModel: PannerLike['distanceModel'] = 'inverse'
  refDistance = 1
  maxDistance = 10000
  rolloffFactor = 1
  readonly positionX = new FakeParam()
  readonly positionY = new FakeParam()
  readonly positionZ = new FakeParam()
}

export class FakeSource extends FakeNode implements BufferSourceLike {
  buffer: AudioBufferLike | null = null
  loop = false
  started: number | null = null
  /** Where in the buffer it was told to start, and for how long. */
  offset: number | null = null
  duration: number | null = null
  stopped: number | null = null
  onended: (() => void) | null = null
  start(when = 0, offset?: number, duration?: number) {
    this.started = when
    this.offset = offset ?? null
    this.duration = duration ?? null
  }
  stop(when = 0) {
    this.stopped = when
  }
}

export class FakeContext implements AudioLike {
  currentTime = 0
  state: 'suspended' | 'running' | 'closed' = 'suspended'
  readonly sampleRate = 48000
  readonly destination = new FakeNode()
  readonly gains: FakeGain[] = []
  readonly sources: FakeSource[] = []
  readonly filters: FakeFilter[] = []
  readonly panners: FakePanner[] = []
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
  createBiquadFilter(): BiquadFilterLike {
    const filter = new FakeFilter()
    this.filters.push(filter)
    return filter
  }
  createPanner(): PannerLike {
    const panner = new FakePanner()
    this.panners.push(panner)
    return panner
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
