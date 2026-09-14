import { emitHex } from './emission'

/**
 * Particles: one pool, and presets that are only parameter sets.
 *
 * Embers, smoke and ash are not three systems. They are the same particle —
 * a position, a velocity, an age — told different things about how long it
 * lives, which way the air takes it and what it looks like. So there is one
 * pool, and a preset is a row of numbers; the next effect's droplet or dust is
 * another row, not another file. That is the P3 gate stated early: each effect
 * after the second should cost a preset, not a subsystem.
 *
 * **Simulated on the CPU,** for the same reason the damage field is: what
 * spawns them is read on the CPU. Ash leaves the texel that just burnt
 * through, and that texel is in a `Float32Array`, not a texture. A GPU
 * particle system would have to be told every spawn through an upload anyway,
 * and the counts here — hundreds, not hundreds of thousands — are ones a CPU
 * steps in a fraction of a millisecond.
 *
 * **A fixed capacity, from the tier,** allocated once and never grown. When
 * it is full, the particle closest to the end of its life gives up its slot:
 * dropping the NEW one instead would starve the burn of embers the moment the
 * room filled with old smoke, which is exactly backwards — the newest
 * particle is the one leaving the fire you are looking at.
 *
 * Drawing is `FxParticles`. Nothing in this file touches three.
 */

export interface ParticlePreset {
  /** Seconds a particle lives, drawn uniformly between the two. */
  readonly life: readonly [number, number]
  /** Launch speed in world units a second, drawn between the two. */
  readonly speed: readonly [number, number]
  /** Launch direction before spread, in world space. */
  readonly direction: readonly [number, number, number]
  /** 0 launches along `direction` exactly; 1 anywhere in the hemisphere around it. */
  readonly spread: number
  /** Acceleration straight up, world units a second squared. Hot air rises; ash is heavier than it. */
  readonly lift: number
  /** How fast the air brings a particle to its own speed, per second. */
  readonly drag: number
  /** A random acceleration, world units a second squared, drawn afresh every step — the flutter. */
  readonly jitter: number
  /** How much of the wind's velocity it takes on, 0..1. */
  readonly windCatch: number
  /** Diameter in world units, at birth and at death. */
  readonly size: readonly [number, number]
  /** Linear RGB at birth and at death. Above 1 for anything that is light rather than matter. */
  readonly color: readonly [readonly [number, number, number], readonly [number, number, number]]
  /** Opacity at birth and at death. Every particle also fades IN over the first tenth of its life. */
  readonly alpha: readonly [number, number]
  /** Spin in radians a second, drawn either way up to this. */
  readonly spin: number
  /** Added to what is behind it — light — or drawn over it — matter. */
  readonly blend: 'additive' | 'normal'
  /** A soft disc, or a jagged flake. */
  readonly shape: 'soft' | 'flake'
  /** Brightness wobble, 0..1: an ember flickers, a puff of smoke does not. */
  readonly flicker: number
}

/**
 * The fire's three. World units are the sheet's: a default sheet is one unit
 * across, about the width of A4, so 0.01 is two millimetres.
 */
export const particlePresets = {
  /**
   * A spark off the burning line. Short-lived, shrinking as it cools, carried
   * up and sideways by the heat.
   *
   * Authored through `emission.ts`, in multiples of paper white, which is what
   * caught the bug in the version before this one. That version said "the hot
   * end is now ~5.6, well over the bloom threshold" — and 5.6 was an ABSOLUTE
   * luminance, while paper white under `window` is 1.6. So the hottest spark
   * in the frame was **3.5× paper, under the 4× floor**, and its
   * own comment said otherwise. A number that cannot be compared to anything
   * is a number nobody can check.
   *
   * It was also too red. `[12, 4.2, 0.9]` is a saturated red at high
   * intensity, and the tone curve takes a bright red-dominant colour to
   * SALMON — which is `Never_this.png`. The hue is now a blackbody's: a spark
   * leaving the fire is yellow-orange, about 2200 K, and cools to a deep
   * orange-red as it dies. Hue and brightness are separate arguments now, and
   * `emit` keeps them that way.
   */
  ember: {
    life: [0.5, 1.4],
    speed: [0.15, 0.5],
    direction: [0, 1, 0],
    spread: 0.6,
    lift: 0.6,
    drag: 0.8,
    jitter: 1.5,
    windCatch: 0.8,
    // 0.3-1 mm of core. A sheet is one world unit across, 210 mm, so
    // 0.0035 is 0.7 mm. It was 0.005 — a full millimetre wide before the
    // streak stretched it, which is where "wide bars" started.
    size: [0.0035, 0.0012],
    color: [
      // 6× paper white: inside the 4–8× band, so it blooms.
      emitHex('#FFC271', 6),
      // 0.7× — UNDER the bloom threshold on purpose, so a dying spark stops
      // glowing rather than merely fading.
      emitHex('#FF5512', 0.7),
    ],
    alpha: [1, 0],
    spin: 0,
    blend: 'additive',
    shape: 'soft',
    flicker: 0.35,
  },
  /**
   * What a paper fire mostly makes. Thin, slow, growing as it rises and
   * spreads, and gone well before it could read as a volume — no fluid
   * simulation, on purpose; see the fx plan.
   */
  smoke: {
    // Shorter, and smaller below: these are the thread beside the
    // simulator's smoke, and the simulator's is gone within a second or two
    // of the last flame. Left to live three and a half seconds and grow to
    // seven centimetres, the last few of them overlapped into a flat wash
    // over the hole with nothing left to move them — the one moment of a
    // burn where the smoke looked wrong.
    life: [1.4, 2.6],
    speed: [0.05, 0.15],
    direction: [0, 1, 0],
    spread: 0.3,
    lift: 0.25,
    drag: 0.9,
    jitter: 0.3,
    windCatch: 1,
    size: [0.05, 0.18],
    // #6B6560 grey-brown, linear, and thin — the background stays clear.
    color: [
      [0.147, 0.13, 0.117],
      [0.2, 0.19, 0.18],
    ],
    alpha: [0.07, 0],
    spin: 0.4,
    blend: 'normal',
    shape: 'soft',
    flicker: 0,
  },
  /**
   * Burnt-through paper, leaving. Lifted a little by the heat it came from,
   * then heavier than the air: it tumbles, flutters and falls — the part of a
   * burn that proves paper was there.
   */
  ash: {
    // A second or two: ash that hung in the air for five read as grey
    // confetti over the hole, dust or stars rather than something falling.
    life: [1.2, 2.6],
    // Thrown UP by the heat it came off, before it is heavier than the air.
    // It used to leave at almost nothing (0.02–0.1) with a lift of −0.35, so
    // every flake began falling the moment it was born — straight through the
    // hole it came from, onto the black stage, dark on dark.
    speed: [0.14, 0.3],
    direction: [0, 1, 0],
    spread: 0.55,
    // Heavier than the air once the throw is spent: most flakes tumble down,
    // only the lightest ride the heat up a little first.
    lift: -0.42,
    drag: 1.6,
    jitter: 1.2,
    windCatch: 1,
    // 5–10 mm across. A sheet is 210 mm, so 0.03 is 6.3 mm. They were
    // 3.8 mm and there were far too many of them: a shower of specks rather
    // than a few flakes you would notice.
    size: [0.03, 0.026],
    // Charred paper, near black: under a bright key the old value read as
    // pale grey against the black stage, which is the confetti.
    color: [
      [0.04, 0.037, 0.034],
      [0.07, 0.066, 0.062],
    ],
    alpha: [0.95, 0],
    spin: 4,
    blend: 'normal',
    shape: 'flake',
    flicker: 0,
  },
} as const satisfies Record<string, ParticlePreset>

export type ParticlePresetName = keyof typeof particlePresets

const PRESET_NAMES = Object.keys(particlePresets) as ParticlePresetName[]
const PRESETS: readonly ParticlePreset[] = PRESET_NAMES.map((name) => particlePresets[name])

/**
 * Where `write` puts one blend mode's particles, as flat arrays sized for the
 * pool's capacity: xyz, rgba, and four extras — size, spin angle, shape (0
 * soft, 1 flake) and a per-particle seed the sprite uses for its outline.
 */
export interface ParticleTarget {
  readonly position: Float32Array
  readonly color: Float32Array
  readonly extra: Float32Array
  /** Velocity, xyz, if the target wants it — an ember is drawn stretched along its own. */
  readonly velocity?: Float32Array
}

/** A small, fast, seeded generator — the same seed makes the same fire. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class ParticlePool {
  readonly capacity: number
  /**
   * The air's own velocity, world units a second. A blow on `/hands` is a
   * wind, and smoke that ignores it is smoke painted on the glass.
   */
  readonly wind: [number, number, number] = [0, 0, 0]
  private readonly kind: Uint8Array
  private readonly position: Float32Array
  private readonly velocity: Float32Array
  private readonly age: Float32Array
  private readonly life: Float32Array
  private readonly angle: Float32Array
  private readonly spin: Float32Array
  private readonly seed: Float32Array
  private live = 0
  /** Live particles of each preset, kept as they come and go, so a cap costs nothing to check. */
  private readonly perKind = new Int32Array(PRESET_NAMES.length)
  /** Embers that popped in the air since the last `takePops` — the sound follows the picture. */
  private pops = 0
  private readonly random: () => number

  constructor(capacity: number, seed = 1) {
    this.capacity = Math.max(0, Math.floor(capacity))
    const n = this.capacity
    this.kind = new Uint8Array(n)
    this.position = new Float32Array(n * 3)
    this.velocity = new Float32Array(n * 3)
    this.age = new Float32Array(n)
    this.life = new Float32Array(n)
    this.angle = new Float32Array(n)
    this.spin = new Float32Array(n)
    this.seed = new Float32Array(n)
    this.random = mulberry32(seed)
  }

  /** Particles in the air. */
  get count(): number {
    return this.live
  }

  /** How many live particles are of one preset. For tests and for a HUD. */
  countOf(name: ParticlePresetName): number {
    return this.perKind[PRESET_NAMES.indexOf(name)]!
  }

  /** Launch one particle from a point. Never allocates; at capacity it takes the most-spent slot. */
  spawn(name: ParticlePresetName, x: number, y: number, z: number): void {
    if (this.capacity === 0) return
    const preset = particlePresets[name]
    let i = this.live
    if (i < this.capacity) {
      this.live++
    } else {
      // Full: the particle nearest the end of its life gives up its slot.
      i = 0
      let spent = -1
      for (let j = 0; j < this.live; j++) {
        const f = this.age[j]! / this.life[j]!
        if (f > spent) {
          spent = f
          i = j
        }
      }
      this.perKind[this.kind[i]!] = this.perKind[this.kind[i]!]! - 1
    }
    const r = this.random
    this.kind[i] = PRESET_NAMES.indexOf(name)
    this.perKind[this.kind[i]!] = this.perKind[this.kind[i]!]! + 1
    const i3 = i * 3
    this.position[i3] = x
    this.position[i3 + 1] = y
    this.position[i3 + 2] = z

    // A direction around the preset's, by as much as its spread allows: a
    // random unit vector mixed in, and folded into the preset's hemisphere.
    const [dx, dy, dz] = preset.direction
    let rx = r() * 2 - 1
    let ry = r() * 2 - 1
    let rz = r() * 2 - 1
    const rl = Math.hypot(rx, ry, rz) || 1
    rx /= rl
    ry /= rl
    rz /= rl
    let ox = dx * (1 - preset.spread) + rx * preset.spread
    let oy = dy * (1 - preset.spread) + ry * preset.spread
    let oz = dz * (1 - preset.spread) + rz * preset.spread
    if (ox * dx + oy * dy + oz * dz < 0) {
      ox = -ox
      oy = -oy
      oz = -oz
    }
    const ol = Math.hypot(ox, oy, oz) || 1
    const speed = preset.speed[0] + (preset.speed[1] - preset.speed[0]) * r()
    this.velocity[i3] = (ox / ol) * speed
    this.velocity[i3 + 1] = (oy / ol) * speed
    this.velocity[i3 + 2] = (oz / ol) * speed

    this.age[i] = 0
    this.life[i] = preset.life[0] + (preset.life[1] - preset.life[0]) * r()
    this.angle[i] = r() * Math.PI * 2
    this.spin[i] = (r() * 2 - 1) * preset.spin
    this.seed[i] = r()
  }

  /** Advance every particle by `dt` seconds; the dead leave the pool. */
  step(dt: number): void {
    if (dt <= 0) return
    const r = this.random
    const [wx, wy, wz] = this.wind
    for (let i = 0; i < this.live; i++) {
      const before = this.age[i]! / this.life[i]!
      this.age[i] = this.age[i]! + dt
      // The one ember in ten that dies in the air flashes as it crosses 0.86
      // of its life (see `write`); count it as it does, for the sound.
      if (this.seed[i]! < 0.1 && before < 0.86 && this.age[i]! / this.life[i]! >= 0.86) {
        if (PRESETS[this.kind[i]!]!.blend === 'additive') this.pops++
      }
      if (this.age[i]! >= this.life[i]!) {
        this.remove(i)
        i--
        continue
      }
      const preset = PRESETS[this.kind[i]!]!
      const i3 = i * 3
      const drag = Math.min(1, preset.drag * dt)
      const catchWind = preset.windCatch
      const jitter = preset.jitter
      // Toward the air's velocity, not toward rest: in a wind, "drag" is the
      // wind carrying it.
      let vx = this.velocity[i3]!
      let vy = this.velocity[i3 + 1]!
      let vz = this.velocity[i3 + 2]!
      vx += (wx * catchWind - vx) * drag + (r() * 2 - 1) * jitter * dt
      vy += (wy * catchWind - vy) * drag + (preset.lift + (r() * 2 - 1) * jitter) * dt
      vz += (wz * catchWind - vz) * drag + (r() * 2 - 1) * jitter * dt
      this.velocity[i3] = vx
      this.velocity[i3 + 1] = vy
      this.velocity[i3 + 2] = vz
      this.position[i3] = this.position[i3]! + vx * dt
      this.position[i3 + 1] = this.position[i3 + 1]! + vy * dt
      this.position[i3 + 2] = this.position[i3 + 2]! + vz * dt
      this.angle[i] = this.angle[i]! + this.spin[i]! * dt
    }
  }

  /**
   * Write every live particle into the target for its blend mode. Returns how
   * many went into each — the draw ranges.
   */
  write(
    additive: ParticleTarget,
    normal: ParticleTarget,
    /**
     * Where flakes go, if they are to be drawn apart from the smoke — ash is
     * a tumbling plane and smoke is a soft sprite, and one blend mode is not
     * one way of drawing. Omitted, flakes go with `normal` as they always did.
     */
    flakes?: ParticleTarget,
  ): { additive: number; normal: number; flakes: number } {
    let a = 0
    let n = 0
    let f = 0
    for (let i = 0; i < this.live; i++) {
      const preset = PRESETS[this.kind[i]!]!
      const flake = flakes !== undefined && preset.shape === 'flake'
      const target = preset.blend === 'additive' ? additive : flake ? flakes : normal
      const k = preset.blend === 'additive' ? a++ : flake ? f++ : n++
      const t = this.age[i]! / this.life[i]!
      const i3 = i * 3
      const k3 = k * 3
      target.position[k3] = this.position[i3]!
      target.position[k3 + 1] = this.position[i3 + 1]!
      target.position[k3 + 2] = this.position[i3 + 2]!
      if (target.velocity) {
        target.velocity[k3] = this.velocity[i3]!
        target.velocity[k3 + 1] = this.velocity[i3 + 1]!
        target.velocity[k3 + 2] = this.velocity[i3 + 2]!
      }
      const [c0, c1] = preset.color
      const fadeIn = Math.min(1, t / 0.1)
      const flicker =
        preset.flicker > 0
          ? 1 - preset.flicker * (0.5 + 0.5 * Math.sin(this.age[i]! * 41 + this.seed[i]! * 97))
          : 1
      const k4 = k * 4
      // One ember in ten dies in the air with a flash — a tiny pop at the end
      // of its life, which the sound can follow.
      const pop = preset.blend === 'additive' && this.seed[i]! < 0.1 && t > 0.86 ? 2.6 : 1
      target.color[k4] = (c0[0] + (c1[0] - c0[0]) * t) * pop
      target.color[k4 + 1] = (c0[1] + (c1[1] - c0[1]) * t) * pop
      target.color[k4 + 2] = (c0[2] + (c1[2] - c0[2]) * t) * pop
      target.color[k4 + 3] = (preset.alpha[0] + (preset.alpha[1] - preset.alpha[0]) * t) * fadeIn * flicker
      target.extra[k4] = preset.size[0] + (preset.size[1] - preset.size[0]) * t
      target.extra[k4 + 1] = this.angle[i]!
      target.extra[k4 + 2] = preset.shape === 'flake' ? 1 : 0
      target.extra[k4 + 3] = this.seed[i]!
    }
    return { additive: a, normal: n, flakes: f }
  }

  /**
   * How many embers popped in the air since the last call, and reset — one
   * `FireSound.pop()` each keeps the sound on the frame the flash is on.
   */
  takePops(): number {
    const n = this.pops
    this.pops = 0
    return n
  }

  /** Empty the air — a fresh sheet. */
  clear(): void {
    this.live = 0
    this.perKind.fill(0)
  }

  /** Swap the last live particle into slot `i`. Order does not matter; density does. */
  private remove(i: number): void {
    this.perKind[this.kind[i]!] = this.perKind[this.kind[i]!]! - 1
    const last = --this.live
    if (i === last) return
    this.kind[i] = this.kind[last]!
    this.age[i] = this.age[last]!
    this.life[i] = this.life[last]!
    this.angle[i] = this.angle[last]!
    this.spin[i] = this.spin[last]!
    this.seed[i] = this.seed[last]!
    this.position.copyWithin(i * 3, last * 3, last * 3 + 3)
    this.velocity.copyWithin(i * 3, last * 3, last * 3 + 3)
  }
}
