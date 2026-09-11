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
   * A spark off the burning line. Short-lived, bright past 1 so a bloom pass
   * catches it, shrinking as it cools, carried up and sideways by the heat.
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
    size: [0.012, 0.004],
    color: [
      [4, 1.4, 0.3],
      [1.2, 0.2, 0.02],
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
    life: [1.8, 3.5],
    speed: [0.05, 0.15],
    direction: [0, 1, 0],
    spread: 0.3,
    lift: 0.25,
    drag: 0.9,
    jitter: 0.3,
    windCatch: 1,
    size: [0.05, 0.35],
    color: [
      [0.35, 0.33, 0.31],
      [0.6, 0.6, 0.6],
    ],
    alpha: [0.35, 0],
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
    life: [2.5, 5],
    speed: [0.02, 0.1],
    direction: [0, 1, 0],
    spread: 1,
    lift: -0.35,
    drag: 1.6,
    jitter: 1.2,
    windCatch: 1,
    size: [0.018, 0.014],
    color: [
      [0.07, 0.065, 0.06],
      [0.12, 0.115, 0.11],
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
    const k = PRESET_NAMES.indexOf(name)
    let n = 0
    for (let i = 0; i < this.live; i++) if (this.kind[i] === k) n++
    return n
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
    }
    const r = this.random
    this.kind[i] = PRESET_NAMES.indexOf(name)
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
      this.age[i] = this.age[i]! + dt
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
  write(additive: ParticleTarget, normal: ParticleTarget): { additive: number; normal: number } {
    let a = 0
    let n = 0
    for (let i = 0; i < this.live; i++) {
      const preset = PRESETS[this.kind[i]!]!
      const target = preset.blend === 'additive' ? additive : normal
      const k = preset.blend === 'additive' ? a++ : n++
      const t = this.age[i]! / this.life[i]!
      const i3 = i * 3
      const k3 = k * 3
      target.position[k3] = this.position[i3]!
      target.position[k3 + 1] = this.position[i3 + 1]!
      target.position[k3 + 2] = this.position[i3 + 2]!
      const [c0, c1] = preset.color
      const fadeIn = Math.min(1, t / 0.1)
      const flicker =
        preset.flicker > 0
          ? 1 - preset.flicker * (0.5 + 0.5 * Math.sin(this.age[i]! * 41 + this.seed[i]! * 97))
          : 1
      const k4 = k * 4
      target.color[k4] = c0[0] + (c1[0] - c0[0]) * t
      target.color[k4 + 1] = c0[1] + (c1[1] - c0[1]) * t
      target.color[k4 + 2] = c0[2] + (c1[2] - c0[2]) * t
      target.color[k4 + 3] = (preset.alpha[0] + (preset.alpha[1] - preset.alpha[0]) * t) * fadeIn * flicker
      target.extra[k4] = preset.size[0] + (preset.size[1] - preset.size[0]) * t
      target.extra[k4 + 1] = this.angle[i]!
      target.extra[k4 + 2] = preset.shape === 'flake' ? 1 : 0
      target.extra[k4 + 3] = this.seed[i]!
    }
    return { additive: a, normal: n }
  }

  /** Empty the air — a fresh sheet. */
  clear(): void {
    this.live = 0
  }

  /** Swap the last live particle into slot `i`. Order does not matter; density does. */
  private remove(i: number): void {
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
