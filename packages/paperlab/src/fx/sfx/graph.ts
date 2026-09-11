import { fxQualityFor, type FxQualityName, type FxQualitySettings } from '../quality'

/**
 * The audio graph: a context, a ceiling, and somewhere for a sound to go.
 *
 * There was no audio anywhere in this library or its three apps before this —
 * not an `AudioContext`, not a clip. Sound was not under-built, it was
 * absent, and that is most of why the wind reads as weightless: a sheet
 * moving in silence is a picture of a sheet moving.
 *
 * Two decisions are baked in here rather than left to each effect.
 *
 * **Synthesis, not samples.** A triggered crumple clip is the same crumple
 * every time, it does not know how fast you crushed it, and two overlapping
 * copies turn to mush. Paper sounds are broadband noise shaped by an
 * envelope, which is the cheapest thing a synthesiser does and the thing
 * sample playback is worst at. It also means no licensing question at all, in
 * a repo that has already had to reason carefully about the licence on the
 * hand-tracking weights.
 *
 * **A hard ceiling, from the tier.** Fire and crumple both want to be grain
 * clouds — dozens of short bursts a second — and a grain cloud with no
 * ceiling is an unbounded number of live nodes on a phone that is already
 * running a camera, a hand tracker and a cloth simulation. So voices come
 * from a fixed pool sized by `fx/quality.ts`, and asking for one past the
 * ceiling steals the least audible voice rather than allocating. Dropping the
 * NEW sound would be the obvious alternative and it is wrong: the newest
 * sound is the one the viewer just caused, and silence in response to an
 * action reads as a broken page.
 *
 * **What is testable, and what is not.** Everything above is policy — pool
 * size, stealing, the unlock state machine, gain arithmetic — and none of it
 * needs a browser. The DSP is a handful of node connections that only a
 * browser can make. So the context is injected rather than constructed, the
 * policy is tested against a stub, and what ships to the browser is the same
 * code path with a real `AudioContext` in it.
 */

/**
 * The part of the Web Audio API this uses.
 *
 * Written out rather than referring to `AudioContext` so that the policy can
 * be tested without a DOM, and so that the surface this depends on is small
 * enough to read. Anything added here is a new thing to stub.
 */
export interface AudioLike {
  readonly currentTime: number
  readonly state: 'suspended' | 'running' | 'closed'
  readonly destination: AudioNodeLike
  createGain(): GainLike
  createBufferSource(): BufferSourceLike
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike
  readonly sampleRate: number
  resume(): Promise<void>
  close(): Promise<void>
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): void
  disconnect(): void
}

export interface AudioParamLike {
  value: number
  setValueAtTime(value: number, when: number): void
  linearRampToValueAtTime(value: number, when: number): void
  cancelScheduledValues(when: number): void
}

export interface GainLike extends AudioNodeLike {
  readonly gain: AudioParamLike
}

export interface AudioBufferLike {
  getChannelData(channel: number): Float32Array
  readonly length: number
}

export interface BufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null
  loop: boolean
  start(when?: number): void
  stop(when?: number): void
  onended: (() => void) | null
}

export interface FxAudioOptions {
  quality?: FxQualityName | FxQualitySettings
  /**
   * The context to use. Required, and never made for you: constructing an
   * `AudioContext` is a side effect with a user-visible cost (a browser tab
   * shows an audio indicator), and a class that made one on construction
   * would take that from a page that never asked. Get a browser one from
   * `createAudioContext()`, inside the gesture that should start the sound.
   */
  context: AudioLike
  /** Master level, 0..1. */
  volume?: number
}

/** A sound in flight. Handed back so a caller can shape or stop it. */
export interface Voice {
  readonly id: number
  /** What this voice is for. Only used to explain who got stolen. */
  readonly kind: string
  /**
   * How much this voice deserves to survive, 0..1.
   *
   * The ONLY input to stealing, and it is not loudness. A near-silent tail of
   * a crackle is worth less than a quiet new ignition, because one is ending
   * and the other is something the viewer just did. Effects set this and the
   * pool obeys it.
   */
  priority: number
  readonly gain: GainLike
  readonly startedAt: number
  /**
   * Hand a source to this voice, so it lives and dies with it.
   *
   * Every source that plays through a voice must be given to it, because the
   * voice is the only thing that knows when to stop it. A voice that did not
   * own its sources could only fade its gain when stolen — and a looping bed
   * behind a silent gain keeps running, and keeps its nodes, for the life of
   * the page.
   *
   * A one-shot that ends on its own ends the voice with it; a voice already
   * released stops the source at once rather than letting it play unheard.
   */
  own(source: BufferSourceLike): void
  /** Stop and return this voice to the pool. */
  stop(): void
}

/** Fades applied when a voice is taken away, so stealing never clicks. */
const STEAL_FADE = 0.012

export class FxAudio {
  readonly quality: FxQualitySettings
  private readonly ctx: AudioLike
  private readonly master: GainLike
  private readonly live: Voice[] = []
  /**
   * What each voice owns, until the last of it has actually stopped.
   *
   * Outlives the voice's place in `live` on purpose: a stolen voice leaves the
   * pool at once, so the new sound can have its slot, but its sources are
   * still fading for a few milliseconds and its gain is still connected. The
   * nodes are freed when the last source reports `ended`, not before — cut
   * sooner and the fade that stops stealing from clicking is cut with it.
   */
  private readonly slots = new Map<number, { gain: GainLike; sources: BufferSourceLike[] }>()
  private nextId = 1
  private unlocked = false
  private noise: AudioBufferLike | null = null

  constructor(options: FxAudioOptions) {
    const { quality = 'auto', context, volume = 0.8 } = options
    this.quality = typeof quality === 'string' ? fxQualityFor(quality) : quality
    // The type already requires it; this is for callers without one.
    if (!context) throw new Error('FxAudio needs a context — see createAudioContext()')
    this.ctx = context
    this.master = this.ctx.createGain()
    this.master.gain.value = volume
    this.master.connect(this.ctx.destination)
  }

  get context(): AudioLike {
    return this.ctx
  }

  /** Live voices right now. Never more than the tier's ceiling. */
  get voices(): readonly Voice[] {
    return this.live
  }

  get isUnlocked(): boolean {
    return this.unlocked
  }

  get volume(): number {
    return this.master.gain.value
  }

  set volume(value: number) {
    this.master.gain.value = Math.min(1, Math.max(0, value))
  }

  /**
   * Let sound happen, from inside a user gesture.
   *
   * Every browser starts an `AudioContext` suspended until a real interaction
   * resumes it, and a page that calls this from anywhere else is a page whose
   * audio silently never starts. Here the cost is zero: `/hands` already has
   * a button that turns the camera on, and nothing can be heard before the
   * camera is on anyway.
   *
   * Safe to call more than once — it is a latch, not a toggle.
   */
  async unlock(): Promise<void> {
    if (this.unlocked) return
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    this.unlocked = this.ctx.state === 'running'
  }

  /**
   * One second of white noise, made once and shared.
   *
   * Nearly every paper sound is filtered noise — a crumple is a cloud of
   * short bursts of it, a fire is a bed of it, a tear is a fast train of it —
   * so this is the single most reused object in the graph. Generating it per
   * voice would allocate a second of audio per crackle.
   */
  noiseBuffer(): AudioBufferLike {
    if (this.noise) return this.noise
    const length = Math.floor(this.ctx.sampleRate)
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate)
    const data = buffer.getChannelData(0)
    // Deterministic rather than Math.random: a reproducible bed is one that
    // can be compared between two runs when something sounds wrong.
    let seed = 0x9e3779b9
    for (let i = 0; i < length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0
      data[i] = (seed >>> 0) / 2147483648 - 1
    }
    this.noise = buffer
    return buffer
  }

  /**
   * Take a voice, stealing the least deserving one if the pool is full.
   *
   * Returns null only when the ceiling is zero or the caller's priority is
   * below everything already playing — the one case where refusing is right,
   * because the alternative is cutting off something more important to play
   * something less.
   */
  take(kind: string, priority = 0.5): Voice | null {
    if (this.quality.voices <= 0) return null

    if (this.live.length >= this.quality.voices) {
      // The weakest voice, tie-broken by age so the older of two equals goes.
      let weakest = 0
      for (let i = 1; i < this.live.length; i++) {
        const a = this.live[i]!
        const b = this.live[weakest]!
        if (a.priority < b.priority || (a.priority === b.priority && a.startedAt < b.startedAt)) {
          weakest = i
        }
      }
      const victim = this.live[weakest]!
      if (victim.priority > priority) return null
      victim.stop()
    }

    const gain = this.ctx.createGain()
    gain.connect(this.master)
    const id = this.nextId++
    this.slots.set(id, { gain, sources: [] })
    const voice: Voice = {
      id,
      kind,
      priority,
      gain,
      startedAt: this.ctx.currentTime,
      own: (source) => this.own(id, source),
      stop: () => this.release(id),
    }
    this.live.push(voice)
    return voice
  }

  private own(id: number, source: BufferSourceLike): void {
    const slot = this.slots.get(id)
    const alive = this.live.some((v) => v.id === id)
    if (!slot || !alive) {
      // A source given to a voice that has already gone: it must not play
      // through a gain that is fading out, or through nothing at all.
      stopNow(source)
      source.disconnect()
      return
    }
    slot.sources.push(source)
    source.onended = () => this.ended(id, source)
  }

  private ended(id: number, source: BufferSourceLike): void {
    source.disconnect()
    const slot = this.slots.get(id)
    if (!slot) return
    const at = slot.sources.indexOf(source)
    if (at >= 0) slot.sources.splice(at, 1)
    if (slot.sources.length > 0) return
    // The last of it. If the voice is still in the pool it finished on its
    // own — a one-shot — and is done; if it was released, its fade is over.
    if (this.live.some((v) => v.id === id)) this.release(id)
    else this.free(id)
  }

  /** Disconnect a voice's gain. Only once nothing that feeds it is still running. */
  private free(id: number): void {
    const slot = this.slots.get(id)
    if (!slot) return
    slot.gain.disconnect()
    this.slots.delete(id)
  }

  /**
   * Return a voice to the pool, fading it out first.
   *
   * The fade is the whole reason this is not just a splice. Cutting a
   * waveform mid-cycle produces a step, and a step is a click — audible,
   * cheap-sounding, and most likely to happen exactly when the most is going
   * on, since that is when voices get stolen.
   */
  private release(id: number): void {
    const index = this.live.findIndex((v) => v.id === id)
    if (index < 0) return
    const [voice] = this.live.splice(index, 1)
    if (!voice) return
    const slot = this.slots.get(id)
    // Nothing is playing through it, so there is nothing to fade and nothing
    // to wait for.
    if (!slot || slot.sources.length === 0) {
      this.free(id)
      return
    }
    const now = this.ctx.currentTime
    voice.gain.gain.cancelScheduledValues(now)
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now)
    voice.gain.gain.linearRampToValueAtTime(0, now + STEAL_FADE)
    // Stopped at the END of the fade, which is what lets `ended` free the
    // nodes without cutting the ramp short. This is the half the first
    // version was missing: it faded the gain and never stopped a thing, so a
    // looping bed on a stolen voice ran silently forever.
    for (const source of [...slot.sources]) {
      try {
        source.stop(now + STEAL_FADE)
      } catch {
        // Never started: nothing will ever report `ended`, so do it here.
        this.ended(id, source)
      }
    }
  }

  /** Stop everything. The panic button, and what unmounting calls. */
  stopAll(): void {
    for (const voice of [...this.live]) voice.stop()
  }

  /**
   * A short tone, to prove the chain end to end.
   *
   * Deliberately part of the shipped surface rather than a test fixture:
   * "is the audio graph actually connected" is a question that comes up on
   * every device, and the honest answer is a sound you can hear. It uses the
   * same path everything else does — a voice from the pool, the noise buffer,
   * the master gain — so if this is audible the path works.
   */
  test(duration = 0.15): Voice | null {
    const voice = this.take('test', 1)
    if (!voice) return null
    const source = this.ctx.createBufferSource()
    source.buffer = this.noiseBuffer()
    source.connect(voice.gain)
    const now = this.ctx.currentTime
    voice.gain.gain.setValueAtTime(0, now)
    voice.gain.gain.linearRampToValueAtTime(0.4, now + 0.01)
    voice.gain.gain.linearRampToValueAtTime(0, now + duration)
    source.start(now)
    source.stop(now + duration)
    // Owned, so its end frees the voice and every node it used.
    voice.own(source)
    return voice
  }

  /** Release the context. Nothing survives this. */
  async dispose(): Promise<void> {
    this.stopAll()
    // Closing the context ends every source at once, and `ended` may never
    // arrive after that — so let go of everything here rather than wait.
    for (const id of [...this.slots.keys()]) this.free(id)
    this.master.disconnect()
    await this.ctx.close()
  }
}

/** Stop a source that may or may not have been started. */
function stopNow(source: BufferSourceLike): void {
  try {
    source.stop()
  } catch {
    // Never started — which is the same as stopped.
  }
}

/**
 * Make a real browser context.
 *
 * Separate from the constructor so that importing this module never starts an
 * audio context — a browser shows an indicator for one, and a library that
 * lights it up on import is a library that has taken something that was not
 * offered.
 */
export function createAudioContext(): AudioLike {
  const Ctor = (globalThis as { AudioContext?: new () => AudioLike }).AudioContext
  if (!Ctor) throw new Error('no Web Audio support in this environment')
  return new Ctor()
}
