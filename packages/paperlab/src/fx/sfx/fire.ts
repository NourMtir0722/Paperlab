import type { FieldStats } from '../field'
import type { BiquadFilterLike, FxAudio, PannerLike, Voice } from './graph'

/**
 * What a burning sheet sounds like, driven by the numbers that make it burn.
 *
 * Two layers, and the split is the whole design.
 *
 * A **bed**: one looping band of filtered noise whose level follows the
 * LENGTH of the burn front. Not the burnt area — a fire gets louder as its
 * edge gets longer, and a nearly-consumed sheet is quiet again, which a level
 * driven by char would get exactly backwards. It brightens as it grows too:
 * a big fire is not a small fire turned up.
 *
 * A **crackle**: one short burst of bright noise for every few texels that
 * char, so the rate is the rate the paper is actually catching. Each is a
 * different slice of the shared second of noise through its own bandpass, so
 * no two are the same sound; each ends itself.
 *
 * Both read `FieldStats` and nothing else. Sound and picture therefore cannot
 * drift apart: the number that raises the flame's glow is the number that
 * raises its voice. A seed makes a replayed burn crackle the same way, which
 * is the same property the untiered simulation exists to give.
 */

export interface FireSoundOptions {
  /** Loudest the bed gets, 0..1. */
  volume?: number
  /**
   * The front length that counts as a fire at full blast, as the fraction of
   * the sheet's texels on it. Four percent of a 64² grid is about 160 cells,
   * which is a sheet burning across its whole width.
   */
  fullFront?: number
  /** Crackles per texel that chars. */
  crackle?: number
  /** So the same burn sounds the same twice. */
  seed?: number
}

const DEFAULTS: Required<FireSoundOptions> = { volume: 0.55, fullFront: 0.04, crackle: 0.3, seed: 5 }

/** How fast the bed follows the front, in seconds. Fire breathes; it does not jump. */
const BED_SMOOTHING = 0.12

/**
 * At most this many crackles in one frame.
 *
 * A frame that chars a hundred texels at once — a whole dry sheet catching —
 * would otherwise ask for a hundred voices, steal every one of them from the
 * others and turn the pool over twice. Past a handful at once it is a noise
 * burst anyway, which is what the bed is for.
 */
const CRACKLES_PER_FRAME = 4

/** A place in the world, as little of one as this needs. */
export interface SoundAt {
  readonly x: number
  readonly y: number
  readonly z: number
}

export class FireSound {
  private readonly audio: FxAudio
  private readonly o: Required<FireSoundOptions>
  private bed: { voice: Voice; filter: BiquadFilterLike; panner: PannerLike | null } | null = null
  private level = 0
  private debt = 0
  private state: number

  constructor(audio: FxAudio, options: FireSoundOptions = {}) {
    this.audio = audio
    this.o = { ...DEFAULTS, ...options }
    this.state = this.o.seed >>> 0 || 1
  }

  /** True while the bed is playing. */
  get burning(): boolean {
    return this.bed !== null
  }

  /**
   * Call once a frame with what the field just did, and where the sheet is.
   *
   * `at` is optional: without it the fire is not placed in the room, which is
   * right for a sheet filling the frame and wrong for one held at arm's
   * length.
   */
  update(dt: number, stats: FieldStats, at?: SoundAt | null): void {
    const target = stats.front > 0 ? Math.min(1, Math.sqrt(stats.front / this.o.fullFront)) : 0
    // Toward the target rather than at it, so the level cannot flicker with
    // the front's own frame-to-frame wobble.
    const follow = dt > 0 ? Math.min(1, dt / BED_SMOOTHING) : 1
    this.level += (target - this.level) * follow

    if (target > 0 || this.level > 0.02) this.startBed(at)
    else this.stopBed()
    if (this.bed) this.driveBed(at)

    this.debt += stats.charred * this.o.crackle
    let budget = CRACKLES_PER_FRAME
    while (this.debt >= 1 && budget > 0) {
      this.debt -= 1
      budget--
      this.crackle()
    }
    // Whatever the budget could not play is dropped outright, down to the
    // fraction still accumulating toward the next one. A crackle carried into
    // a frame where nothing charred is a sound with no cause — and a sheet
    // that flashes over would otherwise go on crackling after it had stopped
    // burning.
    if (budget === 0) this.debt %= 1
  }

  /**
   * A match struck: the scratch of the head across the box, then the hiss of
   * it flaring as the head burns off. Two bursts of the shared
   * noise, one bright and short, one breathier and longer.
   */
  strike(): void {
    this.burst('fire-strike', 0.9, { type: 'bandpass', frequency: 3200, q: 1.1 }, 0.004, 0.07, 0.8)
    this.burst('fire-flare', 0.8, { type: 'highpass', frequency: 1800, q: 0.7 }, 0.03, 0.45, 0.45, 0.05)
  }

  /** Blown out: a soft, low breath of noise. */
  puff(): void {
    this.burst('fire-puff', 0.6, { type: 'lowpass', frequency: 520, q: 0.6 }, 0.02, 0.28, 0.55)
  }

  /** One ember popping in the air — a tiny click on the frame it flashes. */
  pop(): void {
    const f = 3000 + this.next() * 3000
    this.burst(
      'fire-pop',
      0.2,
      { type: 'bandpass', frequency: f, q: 3 },
      0.001,
      0.012 + this.next() * 0.01,
      0.35,
    )
  }

  /** Silence, now — the flame blown out, or the page going away. */
  stop(): void {
    this.stopBed()
    this.level = 0
    this.debt = 0
  }

  private startBed(at?: SoundAt | null): void {
    if (this.bed) return
    const ctx = this.audio.context
    // Above the crackles on purpose: the bed IS the fire, and a pool full of
    // crackles that stole it would leave a burning sheet sounding like static.
    const voice = this.audio.take('fire-bed', 0.7)
    if (!voice) return
    const source = ctx.createBufferSource()
    source.buffer = this.audio.noiseBuffer()
    source.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 380
    filter.Q.value = 0.7
    const panner = at ? ctx.createPanner() : null
    source.connect(filter)
    if (panner) {
      panner.panningModel = 'equalpower'
      panner.distanceModel = 'inverse'
      panner.refDistance = 1
      filter.connect(panner)
      panner.connect(voice.gain)
    } else {
      filter.connect(voice.gain)
    }
    // From silence: a bed that arrives at full level is a click.
    voice.gain.gain.setValueAtTime(0, ctx.currentTime)
    source.start(ctx.currentTime)
    voice.own(source)
    voice.use(filter)
    if (panner) voice.use(panner)
    this.bed = { voice, filter, panner }
  }

  private driveBed(at?: SoundAt | null): void {
    const bed = this.bed
    if (!bed) return
    const ctx = this.audio.context
    const now = ctx.currentTime
    const gain = bed.voice.gain.gain
    gain.cancelScheduledValues(now)
    gain.setValueAtTime(gain.value, now)
    gain.linearRampToValueAtTime(this.level * this.o.volume, now + BED_SMOOTHING / 2)
    // A bigger fire is brighter as well as louder.
    bed.filter.frequency.setValueAtTime(380 + 900 * this.level, now)
    if (at && bed.panner) {
      bed.panner.positionX.setValueAtTime(at.x, now)
      bed.panner.positionY.setValueAtTime(at.y, now)
      bed.panner.positionZ.setValueAtTime(at.z, now)
    }
  }

  private stopBed(): void {
    if (!this.bed) return
    this.bed.voice.stop()
    this.bed = null
  }

  private crackle(): void {
    const voice = this.audio.take('fire-crackle', 0.25)
    if (!voice) return
    const ctx = this.audio.context
    const now = ctx.currentTime
    const buffer = this.audio.noiseBuffer()
    const seconds = buffer.length / ctx.sampleRate
    const duration = 0.018 + this.next() * 0.05
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    // High and narrow: a crackle is the sound of fibres letting go, not a
    // small version of the rumble.
    filter.frequency.value = 1400 + this.next() * 2800
    filter.Q.value = 1.6 + this.next() * 3
    source.connect(filter)
    filter.connect(voice.gain)
    const peak = (0.25 + this.next() * 0.5) * this.o.volume * Math.max(0.25, this.level)
    const gain = voice.gain.gain
    gain.setValueAtTime(0, now)
    gain.linearRampToValueAtTime(peak, now + 0.004)
    gain.linearRampToValueAtTime(0, now + duration)
    // A different slice of the shared noise every time, ending itself.
    source.start(now, this.next() * Math.max(0, seconds - duration), duration)
    voice.own(source)
    voice.use(filter)
  }

  /**
   * One shaped burst of the shared noise through one filter — what strike,
   * puff and pop are made of. `delay` starts it a moment late, which is how
   * the flare follows the scratch.
   */
  private burst(
    name: string,
    priority: number,
    filterSpec: { type: 'bandpass' | 'highpass' | 'lowpass'; frequency: number; q: number },
    attack: number,
    duration: number,
    level: number,
    delay = 0,
  ): void {
    const voice = this.audio.take(name, priority)
    if (!voice) return
    const ctx = this.audio.context
    const now = ctx.currentTime + delay
    const buffer = this.audio.noiseBuffer()
    const seconds = buffer.length / ctx.sampleRate
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = filterSpec.type
    filter.frequency.value = filterSpec.frequency
    filter.Q.value = filterSpec.q
    source.connect(filter)
    filter.connect(voice.gain)
    const gain = voice.gain.gain
    gain.setValueAtTime(0, now)
    gain.linearRampToValueAtTime(level * this.o.volume, now + attack)
    gain.linearRampToValueAtTime(0, now + attack + duration)
    source.start(now, this.next() * Math.max(0, seconds - attack - duration), attack + duration)
    voice.own(source)
    voice.use(filter)
  }

  /** xorshift32 — its own stream, so nothing else can shift the crackle. */
  private next(): number {
    let s = this.state
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    this.state = s >>> 0
    return this.state / 4294967296
  }
}
