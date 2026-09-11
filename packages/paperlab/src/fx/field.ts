/**
 * The damage field: what has happened to this sheet, as four numbers per
 * texel, over the sheet's own UV.
 *
 * One primitive rather than one subsystem per effect. Fire is heat diffusing
 * into char and char eating presence; water is saturation diffusing along the
 * fibre; a tear is presence zeroed along a path. They share a grid, a step
 * and a set of paint operations, which is the whole reason the second effect
 * costs a chunk and a preset instead of a new system.
 *
 *   R  char        scorch colour, the brown halo, shrinkage and curl, smoke density
 *   G  saturation  wet darkening, roughness, translucency, added mass, sag
 *   B  heat        the glowing ignition line
 *   A  presence    alpha erosion — burn-away, tear-away, punched holes
 *
 * **It runs on the CPU because of who reads it.** Three of the four layers an
 * effect has to land on consume the field on the CPU: the physics coupling
 * needs stiffness and mass per vertex, the emitters spawn ash where presence
 * reaches zero and drips from the lowest wet vertex, and the sound is driven
 * by the length of the burn front every frame. A GPU field would have fed all
 * three through a `readPixels` per frame — a pipeline stall that tile-based
 * phone GPUs pay the most for. Only the shading reads the field on the GPU,
 * and it gets an 8-bit texture uploaded from here. Testability without a
 * renderer comes free with that, and it is how every property below is known.
 *
 * It stays on the main thread. A worker would need `SharedArrayBuffer` to
 * avoid copying the field every frame, and that needs COOP/COEP headers that
 * GitHub Pages cannot send. The main thread is affordable only because the
 * field costs nothing when nothing is happening to it — see `step`.
 *
 * **It is not tiered.** Every device runs the same grid at the same timestep
 * and produces the same fire. With explicit diffusion, halving the cell size
 * quadruples both the cells and the steps stability needs, so the same fire
 * costs N⁴: a 128 grid is sixteen times a 64 one. The first version tiered
 * grid size and substeps as though they were independent, and the measured
 * result was a fire whose speed depended on the device. Presentation is what
 * tiers now — see `fx/quality.ts`.
 */

import { DAMAGE_CHANNELS, type DamageSource } from '../surface/damageContract'

/**
 * Channel offsets into a texel — the contract's, not this file's. The sheet
 * defines what the four bytes mean because the sheet is what draws them;
 * the field is one thing that writes them.
 */
export const CHAR = DAMAGE_CHANNELS.char
export const SATURATION = DAMAGE_CHANNELS.saturation
export const HEAT = DAMAGE_CHANNELS.heat
export const PRESENCE = DAMAGE_CHANNELS.presence

/**
 * The grid, in texels along each edge. One number for every device.
 *
 * 64 until a real phone says otherwise — the P1 gate is where this gets
 * settled for good, by rendering a burn at 64 and 96 and looking. What the
 * field carries are soft quantities with soft edges; the RAGGED edge a burn
 * reads as comes from the anisotropy and the grain, which survive a coarse
 * grid, and from per-fragment detail in the shader, which does not need one.
 */
export const FIELD_SIZE = 64

/**
 * The simulation's own clock, independent of the frame rate.
 *
 * The first version ran a fixed number of substeps per FRAME, so a slow frame
 * meant a longer substep, the stability clamp scaled the diffusion down to
 * compensate, and the same simulated second burned half as far at 30 fps as
 * at 144. Measured on the high tier: 0.202, 0.290 and 0.439 UV of burn radius
 * at 30, 60 and 144 fps. A fire that burns slower when the phone is busy is a
 * fire that behaves differently on every device and every run.
 *
 * `ClothSim` already solved this with the same accumulator and the same
 * number, and the field now matches it. The rates are chosen so that the
 * stability bound is never reached at 1/120 — the clamp in `stencil` is a
 * safety net for extreme options, not something defaults lean on, and a test
 * says so.
 */
export const FIXED_DT = 1 / 120

/**
 * How far behind the accumulator may fall before it drops time.
 *
 * Eight steps covers any frame down to 15 fps exactly. Below that the fire
 * slows rather than the page spiralling — each late frame asking for more
 * steps, which make the next frame later still.
 */
const MAX_STEPS_PER_FRAME = 8

/**
 * Below this, a cell is at rest: it no longer keeps the field awake.
 *
 * Cooling and drying are exponential and never arrive at zero on their own,
 * so without a threshold a fire that went out ten minutes ago would keep
 * every cell it touched awake forever.
 *
 * It decides whether a cell is AWAKE, and never rewrites a value. The first
 * version snapped values below it to zero, and that is a leak with a worse
 * shape than it sounds: the leading edge of anything spreading is exactly the
 * set of cells receiving less than this per step, so every step zeroed the
 * front before it could advance, and a wet patch drained from its rim —
 * three-quarters of it gone in three seconds, with drying switched off. When
 * every cell is below this the field sleeps with the residue frozen in place:
 * nothing lost, and invisible at 8 bits.
 */
const REST = 1e-3

/**
 * How hot paper has to get before it starts to char, as a fraction of a
 * texel's own tinder value.
 *
 * Below the heat a flame deposits and above what diffusion alone leaves
 * behind — which is the gap the whole fire lives in. Too high and a match
 * cannot light the sheet; too low and the preheated region ahead of the
 * front ignites all at once and the burn is a disc rather than a front.
 */
const IGNITION = 0.35

/**
 * The largest the stencil's coefficients may sum to in one step.
 *
 * The positive nine-point stencil below is monotone — no overshoot, so the
 * 0..1 clamp never eats mass — while this stays under a half. 0.4 leaves
 * margin. Defaults sit well below it; see `FIXED_DT`.
 */
const STABLE = 0.4

export interface DamageFieldOptions {
  /**
   * Which way the paper's fibres run, in radians over the sheet's UV, where
   * 0 points along +u.
   *
   * Paper is not isotropic and this is the single number that makes it look
   * like paper rather than like a fluid. Fibres are laid down along the
   * machine direction when the sheet is made; liquid wicks along them far
   * faster than across them, and a flame follows them for the same reason.
   * A wet front with anisotropy at 1 is a circle, which reads as a stain on
   * cloth; with it raised, the front is an ellipse along this angle, which
   * reads as paper. Any angle — see `diffusionTensor`.
   */
  fibre?: number
  /** How much faster things travel along the fibre than across it. */
  anisotropy?: number
  /** Heat spread, in UV² per second, averaged over direction. */
  heatDiffusion?: number
  /** Liquid wicking, in UV² per second, averaged over direction. */
  wicking?: number
  /** How fast heat turns paper to char. */
  charRate?: number
  /** How fast char consumes presence — the burn-away. */
  consumeRate?: number
  /** How much heat burning gives back. Above ~1 the front sustains itself. */
  combustion?: number
  /** Heat lost to the room each second, as a fraction. */
  cooling?: number
  /** How much heat it costs to boil a wet cell dry before it can char. */
  wetResistance?: number
  /** How fast standing water leaves the sheet, as a fraction per second. */
  drying?: number
  /**
   * Per-texel variation in how readily the paper takes light, 0..1.
   *
   * Real paper is not uniform, and a burn front on a uniform sheet advances
   * as a perfect circle — the single most synthetic-looking thing this
   * simulation could do. This is what makes the edge ragged, and it is fixed
   * per field rather than per frame, because a sheet's grain does not change
   * while you hold it.
   */
  grain?: number
  /** Seed for the grain, so a field is reproducible. */
  seed?: number
}

const DEFAULTS = {
  fibre: 0,
  anisotropy: 3,
  heatDiffusion: 0.0035,
  wicking: 0.0045,
  charRate: 16,
  consumeRate: 4,
  combustion: 2.4,
  cooling: 1.1,
  wetResistance: 2.6,
  drying: 0.015,
  grain: 0.34,
  seed: 1,
} satisfies Required<DamageFieldOptions>

/** What the field did this step. The numbers the sound and the emitters read. */
export interface FieldStats {
  /**
   * How much sheet is actively burning right now, 0..1.
   *
   * The fraction of texels part-way through charring AND still hot.
   * Resolution-independent by construction. Both halves matter: combustion
   * pumps heat into everything it has already burnt, so "hot" alone lights
   * up the whole interior; and a fire that went out leaves partly charred
   * cells behind, so "part-charred" alone would report a burn that is over as
   * one still going.
   *
   * This is the number fire's audio is driven by, and it is the right one:
   * a fire gets louder as the front gets LONGER, not as the burnt area gets
   * bigger. A sheet nearly consumed is quiet again, which is true, and which
   * a level driven by char would get exactly backwards.
   */
  front: number
  /** Texels that crossed into char this step. Drives crackle rate and smoke. */
  charred: number
  /** Texels whose presence reached zero this step. Drives ash, and burn-through. */
  consumed: number
  /** Texels that became wetter this step. Drives the water bed's level. */
  wetted: number
  /** Mean saturation over the sheet, 0..1. Drives added mass in the coupling. */
  saturation: number
  /** Fraction of the sheet still present, 1 at the start. */
  remaining: number
}

/**
 * The per-neighbour weights of one diffusing quantity, already multiplied by
 * the timestep over the cell size squared.
 */
export interface Stencil {
  /** East and west neighbours. */
  ax: number
  /** North and south neighbours. */
  ay: number
  /** The two neighbours on one diagonal. */
  ad: number
  /** Which diagonal: +1 is north-east/south-west, -1 is north-west/south-east. */
  diagonal: 1 | -1
  /** True if the stability bound had to scale these down. Never, at defaults. */
  clamped: boolean
}

/**
 * The diffusion tensor for paper with its fibre at `fibre` radians.
 *
 * Along the fibre things travel `anisotropy` times faster than across it, and
 * the two are normalised so that their mean is `rate` — turning the grain
 * changes which way things go, never how fast overall.
 *
 * The first version reduced this to two per-axis weights, `[cos², sin²]`,
 * which is the tensor with its off-diagonal term thrown away. That can only
 * describe ellipses aligned to the UV axes, so it was right at 0° and 90° —
 * the two angles the tests used — and wrong everywhere else: a 30° grain made
 * a 0° front with the anisotropy halved, and a 45° grain made a circle.
 */
export function diffusionTensor(rate: number, anisotropy: number, fibre: number) {
  const along = (rate * 2 * anisotropy) / (1 + anisotropy)
  const across = (rate * 2) / (1 + anisotropy)
  const c = Math.cos(fibre)
  const s = Math.sin(fibre)
  return {
    xx: along * c * c + across * s * s,
    yy: along * s * s + across * c * c,
    xy: (along - across) * c * s,
  }
}

/**
 * A positive nine-point stencil for that tensor.
 *
 * The textbook cross-derivative puts NEGATIVE weights on two of the diagonal
 * neighbours, and a negative weight overshoots: the update dips below zero,
 * the 0..1 clamp clips the dip, and the clip is not symmetric — which is
 * precisely how the first version of this file lost a wet patch in two
 * seconds. So the cross term is written as a second difference along ONE
 * diagonal instead, the one the fibre leans toward:
 *
 *   Dxx u_xx + 2 Dxy u_xy + Dyy u_yy
 *     = (Dxx − |Dxy|) u_xx + (Dyy − |Dxy|) u_yy + 2 |Dxy| u_dd
 *
 * Every weight is non-negative while |Dxy| ≤ min(Dxx, Dyy), which holds at
 * any angle for anisotropy up to about 5. Beyond that |Dxy| is capped at the
 * bound: the front comes out slightly rounder than asked for, which is a far
 * better failure than a front that eats itself.
 */
export function stencil(rate: number, anisotropy: number, fibre: number, dt = FIXED_DT): Stencil {
  const d = diffusionTensor(rate, anisotropy, fibre)
  const cross = Math.min(Math.abs(d.xy), d.xx, d.yy)
  const scale = dt * (FIELD_SIZE - 1) * (FIELD_SIZE - 1)
  let ax = (d.xx - cross) * scale
  let ay = (d.yy - cross) * scale
  let ad = cross * scale
  const total = ax + ay + ad
  const clamped = total > STABLE
  if (clamped) {
    const k = STABLE / total
    ax *= k
    ay *= k
    ad *= k
  }
  return { ax, ay, ad, diagonal: d.xy >= 0 ? 1 : -1, clamped }
}

/** Cheap reproducible hash noise — same input, same sheet, every time. */
function hash(x: number, y: number, seed: number): number {
  // Multipliers kept inside 32 bits on purpose: anything larger is silently
  // rounded by a double before `^` truncates it, which makes the "hash"
  // lose its low bits and the grain come out in visible bands.
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** An inclusive rectangle of cells. Empty when x0 > x1. */
interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

const EMPTY = (): Box => ({ x0: 1, y0: 1, x1: 0, y1: 0 })

export class DamageField implements DamageSource {
  readonly size = FIELD_SIZE
  /** RGBA per texel in float, row-major from v = 0. The simulation's own state. */
  readonly data: Float32Array
  /** The same, at 8 bits, for upload. Kept in step with `data` over what changed. */
  readonly pixels: Uint8Array
  /**
   * How ragged the sheet DRAWS this field's edges, 0..1 — see
   * `DamageSource.detail`. Not a simulation option, because it changes
   * nothing the field computes: set it from `fxQualityFor(tier).detail`, and
   * again whenever the tier moves.
   */
  detail = 1
  private revision = 0

  private readonly next: Float32Array
  /** Per-texel ignition threshold, fixed for the life of the sheet. */
  private readonly tinder: Float32Array
  private readonly o: Required<DamageFieldOptions>
  private readonly heat: Stencil
  private readonly water: Stencil
  private accumulator = 0
  /** Cells that might change on the next step. Everything outside is at rest. */
  private active: Box = EMPTY()
  /** Cells written since the last pack into `pixels`. */
  private touched: Box = EMPTY()
  private visited = 0
  /** Running totals, so the stats never have to walk the whole grid. */
  private present: number
  private wetTotal = 0
  private stats: FieldStats = {
    front: 0,
    charred: 0,
    consumed: 0,
    wetted: 0,
    saturation: 0,
    remaining: 1,
  }
  /**
   * Texels whose presence reached zero during the last `step`, in the first
   * {@link consumedCount} slots — where ash leaves from.
   *
   * WHERE, not just how many. The stats were enough for the sound, which
   * wants a level; an emitter wants a place. Fixed buffers the size of the
   * grid and written in place: a burning sheet must not allocate a list a
   * step, and a texel is consumed once, so a step can never fill it twice.
   */
  readonly consumedCells = new Int32Array(FIELD_SIZE * FIELD_SIZE)
  /** The burn front as of the last step that ran, in the first {@link frontCount} slots — where embers and smoke leave from. */
  readonly frontCells = new Int32Array(FIELD_SIZE * FIELD_SIZE)
  private consumedLength = 0
  private frontLength = 0

  constructor(options: DamageFieldOptions = {}) {
    this.o = { ...DEFAULTS, ...options }
    const n = FIELD_SIZE * FIELD_SIZE
    this.data = new Float32Array(n * 4)
    this.next = new Float32Array(n * 4)
    this.pixels = new Uint8Array(n * 4)
    this.tinder = new Float32Array(n)
    this.present = n

    for (let i = 0; i < n; i++) {
      // Presence starts at 1 — the whole sheet is there. Everything else at 0.
      this.data[i * 4 + PRESENCE] = 1
      this.pixels[i * 4 + PRESENCE] = 255
      const x = i % FIELD_SIZE
      const y = (i / FIELD_SIZE) | 0
      // Two octaves: a coarse one that makes whole regions catch before their
      // neighbours, and a fine one that frays the edge between them. Centred
      // on 1, so `grain` changes only the VARIANCE — written as
      // `1 - grain * noise` it also lowered the mean, and the knob was
      // silently two knobs.
      const coarse = hash(x >> 2, y >> 2, this.o.seed)
      const fine = hash(x, y, this.o.seed * 7 + 11)
      this.tinder[i] = 1 + this.o.grain * (coarse * 0.65 + fine * 0.35 - 0.5)
    }
    this.next.set(this.data)

    // Constant for the life of the field, now that the timestep is.
    this.heat = stencil(this.o.heatDiffusion, this.o.anisotropy, this.o.fibre)
    this.water = stencil(this.o.wicking, this.o.anisotropy, this.o.fibre)
  }

  /** Bumped whenever `pixels` changes. */
  get version(): number {
    return this.revision
  }

  /** Nothing is happening to this sheet, and stepping it costs nothing. */
  get asleep(): boolean {
    return this.active.x0 > this.active.x1
  }

  /**
   * Cells the last `step` visited.
   *
   * The cost of the field, stated in the one unit that means the same thing on
   * every machine. Milliseconds would make a test of it a test of whoever ran
   * it — which is how the hands harness spent weeks passing on one laptop.
   */
  get cellsVisited(): number {
    return this.visited
  }

  /** What the last `step` produced. */
  get lastStats(): FieldStats {
    return this.stats
  }

  /** How many of {@link consumedCells} the last `step` wrote. Always `lastStats.consumed`. */
  get consumedCount(): number {
    return this.consumedLength
  }

  /**
   * How many of {@link frontCells} are current. `lastStats.front` times the
   * texel count — and held, like it, across a frame too short to step.
   */
  get frontCount(): number {
    return this.frontLength
  }

  /** Texel index for a UV, clamped to the sheet. */
  private at(u: number, v: number): number {
    const x = Math.min(FIELD_SIZE - 1, Math.max(0, Math.round(u * (FIELD_SIZE - 1))))
    const y = Math.min(FIELD_SIZE - 1, Math.max(0, Math.round(v * (FIELD_SIZE - 1))))
    return y * FIELD_SIZE + x
  }

  /** The four channels at a UV, for anything that needs to ask a question of a point. */
  sample(u: number, v: number): [number, number, number, number] {
    const i = this.at(u, v) * 4
    return [this.data[i]!, this.data[i + 1]!, this.data[i + 2]!, this.data[i + 3]!]
  }

  /**
   * Add to one channel in a soft disc.
   *
   * Every paint operation is this with a different channel, which is the
   * point of having one primitive: `ignite` and `wet` are not two systems
   * that happen to look alike, they are the same write.
   *
   * `plateau` is the fraction of the radius that takes the full amount
   * before the falloff starts. Zero for anything added, so the deposit has a
   * soft peak — a flame held near paper does not deposit a stamped disc of
   * heat, and a too-perfect edge is the first thing that reads as fake.
   * Raised for anything removed, because a pure smoothstep never quite
   * reaches zero even at its centre, and "almost all the way through" is not
   * a hole.
   */
  paint(channel: number, u: number, v: number, radius: number, amount: number, plateau = 0): void {
    if (radius <= 0 || amount === 0) return
    const last = FIELD_SIZE - 1
    const cx = u * last
    const cy = v * last
    const r = radius * last
    const box: Box = {
      x0: Math.max(0, Math.floor(cx - r)),
      y0: Math.max(0, Math.floor(cy - r)),
      x1: Math.min(last, Math.ceil(cx + r)),
      y1: Math.min(last, Math.ceil(cy + r)),
    }
    if (box.x0 > box.x1 || box.y0 > box.y1) return
    const r2 = r * r
    const { data, next } = this

    for (let y = box.y0; y <= box.y1; y++) {
      for (let x = box.x0; x <= box.x1; x++) {
        const dx = x - cx
        const dy = y - cy
        const d2 = dx * dx + dy * dy
        if (d2 > r2) continue
        const t = plateau >= 1 ? 1 : Math.min(1, (1 - Math.sqrt(d2) / r) / (1 - plateau))
        const falloff = t * t * (3 - 2 * t)
        const i = (y * FIELD_SIZE + x) * 4 + channel
        const before = data[i]!
        // Presence is the one channel that is REMOVED rather than added, and
        // it must never come back — see `cut`.
        const after = Math.min(1, Math.max(0, before + amount * falloff))
        if (after === before) continue
        data[i] = after
        next[i] = after
        if (channel === PRESENCE) this.present += after - before
        if (channel === SATURATION) this.wetTotal += after - before
      }
    }

    grow(this.active, box)
    grow(this.touched, box)
    this.pack()
  }

  /** Hold a flame near the sheet. Heat, not char — the burning is the field's job. */
  ignite(u: number, v: number, radius = 0.06, amount = 1): void {
    this.paint(HEAT, u, v, radius, amount)
  }

  /** Wet the sheet. Saturation wicks along the fibre from wherever it lands. */
  wet(u: number, v: number, radius = 0.08, amount = 0.9): void {
    this.paint(SATURATION, u, v, radius, amount)
  }

  /**
   * Take the paper away along a path: a tear, a cut, a punched hole.
   *
   * Presence only ever decreases. A sheet does not grow back, and a paint op
   * that could raise it would make every burn reversible by accident.
   */
  cut(u0: number, v0: number, u1: number, v1: number, width = 0.02): void {
    const steps = Math.max(1, Math.ceil(Math.hypot(u1 - u0, v1 - v0) * FIELD_SIZE))
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      this.paint(PRESENCE, u0 + (u1 - u0) * t, v0 + (v1 - v0) * t, width, -1, 0.5)
    }
  }

  /** Punch a hole. The middle of the sheet, which a fixed-topology mesh cannot do. */
  punch(u: number, v: number, radius = 0.04): void {
    this.paint(PRESENCE, u, v, radius, -1, 0.5)
  }

  /**
   * Advance the field by a frame's worth of real time.
   *
   * Fixed steps from an accumulator, so the same simulated second is the same
   * fire at any frame rate. A sheet nothing is happening to returns at once
   * and visits no cells at all — which is the condition for keeping this on
   * the main thread, and the thing the first version could not do: an
   * untouched sheet cost exactly what a burning one did.
   */
  step(delta: number): FieldStats {
    this.visited = 0
    // The transient outputs belong to the step that produced them, and they
    // are cleared BEFORE the guards below rather than after. A frame with no
    // time in it — the first one, or one whose clock went backwards — used to
    // hand back the LAST frame's `consumed` cells and charred count, and the
    // emitters and the sound duly shed the same ash and played the same
    // crackles a second time. `front` is not transient: it is the state of
    // the burn, and it is held across a frame too short to step on purpose.
    this.consumedLength = 0
    if (delta <= 0) {
      this.stats = { ...this.stats, charred: 0, consumed: 0, wetted: 0 }
      return this.stats
    }
    if (this.asleep) {
      // Asleep means nothing CAN change, so there is no time owed either;
      // banking it would replay a burst of steps the moment something wakes.
      this.accumulator = 0
      this.frontLength = 0
      this.stats = { ...this.stats, front: 0, charred: 0, consumed: 0, wetted: 0 }
      return this.stats
    }

    this.accumulator = Math.min(this.accumulator + delta, FIXED_DT * MAX_STEPS_PER_FRAME)
    let charred = 0
    let consumed = 0
    let wetted = 0
    let front = 0
    let stepped = false
    while (this.accumulator >= FIXED_DT && !this.asleep) {
      this.accumulator -= FIXED_DT
      stepped = true
      const done = this.substep()
      charred += done.charred
      consumed += done.consumed
      wetted += done.wetted
      front = done.front
    }
    this.pack()

    const n = FIELD_SIZE * FIELD_SIZE
    this.stats = {
      // A frame shorter than one fixed step runs none — one frame in six at
      // 144 Hz — and nothing about the fire changed on it. Reporting 0 there
      // would drop the burn's sound to silence mid-burn, six times a second.
      front: stepped ? front / n : this.stats.front,
      charred,
      consumed,
      wetted,
      saturation: this.wetTotal / n,
      remaining: this.present / n,
    }
    return this.stats
  }

  /**
   * One fixed step of diffusion and reaction, over the active region only.
   *
   * The region is the box around every cell that could change, grown by one
   * cell because diffusion reaches exactly one neighbour per step. Cells
   * outside it are at rest and read-only here — their neighbours may read
   * them, and nothing writes them.
   *
   * Written into `next` and copied back over the same region, rather than
   * swapping the two buffers. A swap needs both buffers to agree everywhere
   * the step did not write, and a region that SHRINKS breaks that: a cell the
   * last step wrote into one buffer still holds an older value in the other.
   * Copying the region back keeps them identical outside it, for the cost of
   * the region itself — which is the cost that matters, since it is zero on
   * a sheet at rest rather than a whole grid every step.
   */
  private substep(): { charred: number; consumed: number; wetted: number; front: number } {
    const { data, next, tinder, o } = this
    const heat = this.heat
    const water = this.water
    const size = FIELD_SIZE
    const last = size - 1
    const dt = FIXED_DT

    const region: Box = {
      x0: Math.max(0, this.active.x0 - 1),
      y0: Math.max(0, this.active.y0 - 1),
      x1: Math.min(last, this.active.x1 + 1),
      y1: Math.min(last, this.active.y1 + 1),
    }
    const awake = EMPTY()

    let charred = 0
    let consumed = 0
    let wetted = 0
    let front = 0
    // This step's front replaces the last one's; see `frontCells`.
    const { frontCells, consumedCells } = this

    // The diagonal the fibre leans toward, as index offsets. Constant per
    // field; hoisted so the inner loop is arithmetic and nothing else.
    const hd = heat.diagonal
    const wd = water.diagonal

    // The region's edge is a NO-FLUX boundary, exactly like the sheet's.
    // A cell on the rim reading a neighbour outside the region would take or
    // give heat and water to a cell that is not being updated — a transfer
    // with no second half, which leaked 7% of a wet patch in three seconds.
    // Treating the outside as absent makes every exchange mirrored. Nothing
    // stops spreading because of it: a rim cell that gathers more than
    // `REST` wakes, and the region grows past it on the next step. What
    // cannot cross is a residue too thin to wake anything — which is also
    // why a wet front on paper has an edge instead of an infinite tail.
    for (let y = region.y0; y <= region.y1; y++) {
      const hasN = y < region.y1
      const hasS = y > region.y0
      for (let x = region.x0; x <= region.x1; x++) {
        this.visited++
        const i = y * size + x
        const b = i * 4
        const presence = data[b + PRESENCE]!

        // Gone is gone: a hole neither conducts heat nor holds water, which
        // is what makes a burnt-through region stop the fire rather than
        // carry it. The A channel is a boundary condition, not just a mask.
        if (presence <= 0) {
          // Whatever water this cell held went with the paper. Take it off the
          // running total as well as the cell, or `saturation` reports water
          // that is gone — and the coupling reads that number as added mass.
          this.wetTotal -= data[b + SATURATION]!
          next[b + HEAT] = 0
          next[b + SATURATION] = 0
          next[b + CHAR] = data[b + CHAR]!
          next[b + PRESENCE] = 0
          continue
        }

        const hasE = x < region.x1
        const hasW = x > region.x0
        // Missing neighbours are this cell, which makes the edge of the sheet
        // a no-flux boundary without a branch in the arithmetic below.
        const e = hasE ? i + 1 : i
        const w = hasW ? i - 1 : i
        const n = hasN ? i + size : i
        const s = hasS ? i - size : i
        // The two diagonal neighbours on each stencil's own diagonal.
        const hd1 = hd > 0 ? (hasN && hasE ? i + size + 1 : i) : hasN && hasW ? i + size - 1 : i
        const hd2 = hd > 0 ? (hasS && hasW ? i - size - 1 : i) : hasS && hasE ? i - size + 1 : i
        const wd1 = wd > 0 ? (hasN && hasE ? i + size + 1 : i) : hasN && hasW ? i + size - 1 : i
        const wd2 = wd > 0 ? (hasS && hasW ? i - size - 1 : i) : hasS && hasE ? i - size + 1 : i

        // Flux between two cells is weighted by the LESSER of their
        // presences. Symmetric, so what leaves one cell is exactly what
        // arrives in the other and nothing is created or lost at the edge of
        // a hole — the first version weighted by the neighbour alone, which
        // is not.
        const me = e * 4
        const mw = w * 4
        const mn = n * 4
        const ms = s * 4
        const pe = Math.min(presence, data[me + PRESENCE]!)
        const pw = Math.min(presence, data[mw + PRESENCE]!)
        const pn = Math.min(presence, data[mn + PRESENCE]!)
        const ps = Math.min(presence, data[ms + PRESENCE]!)

        // ── Heat ─────────────────────────────────────────────────────────
        const h0 = data[b + HEAT]!
        const h1 = hd1 * 4
        const h2 = hd2 * 4
        let h =
          h0 +
          heat.ax * ((data[me + HEAT]! - h0) * pe + (data[mw + HEAT]! - h0) * pw) +
          heat.ay * ((data[mn + HEAT]! - h0) * pn + (data[ms + HEAT]! - h0) * ps) +
          heat.ad *
            ((data[h1 + HEAT]! - h0) * Math.min(presence, data[h1 + PRESENCE]!) +
              (data[h2 + HEAT]! - h0) * Math.min(presence, data[h2 + PRESENCE]!))
        h -= h * o.cooling * dt

        // ── Water ────────────────────────────────────────────────────────
        const sat = data[b + SATURATION]!
        const w1 = wd1 * 4
        const w2 = wd2 * 4
        let g =
          sat +
          water.ax * ((data[me + SATURATION]! - sat) * pe + (data[mw + SATURATION]! - sat) * pw) +
          water.ay * ((data[mn + SATURATION]! - sat) * pn + (data[ms + SATURATION]! - sat) * ps) +
          water.ad *
            ((data[w1 + SATURATION]! - sat) * Math.min(presence, data[w1 + PRESENCE]!) +
              (data[w2 + SATURATION]! - sat) * Math.min(presence, data[w2 + PRESENCE]!))
        // Boiling off costs heat, which is exactly why a wet sheet will not
        // light: the flame front spends itself drying the paper in front of
        // it and arrives with nothing left. This one term is the whole of
        // "dunk the burning corner".
        if (g > 0 && h > 0) {
          const boiled = Math.min(g, h * o.wetResistance * dt)
          g -= boiled
          h -= boiled / o.wetResistance
        }
        // Proportional, not absolute: an absolute sink annihilates a thin
        // film the moment diffusion spreads it below the per-step amount.
        g -= g * o.drying * dt

        // ── Char ─────────────────────────────────────────────────────────
        // Only paper dry enough to burn chars, and only above its own
        // threshold, which varies per texel — that is the ragged front.
        const char = data[b + CHAR]!
        let c = char
        const threshold = tinder[i]! * IGNITION
        if (h > threshold && g < 0.25) {
          const made = Math.min(1 - c, o.charRate * (h - threshold) * dt)
          if (made > 0) {
            c += made
            // Burning is exothermic; above 1 the front feeds itself and runs.
            h += made * o.combustion
            if (char < 0.5 && c >= 0.5) charred++
          }
        }

        // ── Presence ─────────────────────────────────────────────────────
        // Fully charred paper is consumed, one way. The only thing besides a
        // cut that removes it.
        let p = presence
        if (c > 0.85) {
          p = Math.max(0, p - o.consumeRate * (c - 0.85) * dt)
          if (p <= 0) {
            consumed++
            consumedCells[this.consumedLength++] = i
          }
        }

        h = Math.min(1, Math.max(0, h))
        g = Math.min(1, Math.max(0, g))
        c = Math.min(1, c)
        if (g > sat + 1e-6) wetted++
        if (p > 0.15 && c > 0.08 && c < 0.92 && h > 0.1) frontCells[front++] = i

        next[b + CHAR] = c
        next[b + SATURATION] = g
        next[b + HEAT] = h
        next[b + PRESENCE] = p
        this.present += p - presence
        this.wetTotal += g - sat

        // Still able to change next step: hot, wet, or being consumed.
        if (h > REST || g > REST || (c > 0.85 && p > 0)) {
          if (x < awake.x0) awake.x0 = x
          if (x > awake.x1) awake.x1 = x
          if (y < awake.y0) awake.y0 = y
          if (y > awake.y1) awake.y1 = y
        }
      }
    }

    // Back over the same region only — see the note above.
    for (let y = region.y0; y <= region.y1; y++) {
      const from = (y * size + region.x0) * 4
      const to = (y * size + region.x1 + 1) * 4
      data.set(next.subarray(from, to), from)
    }

    grow(this.touched, region)
    this.active = awake
    this.frontLength = front
    return { charred, consumed, wetted, front }
  }

  /** Quantise everything touched since the last pack, and mark it uploadable. */
  private pack(): void {
    const t = this.touched
    if (t.x0 > t.x1) return
    const { data, pixels } = this
    for (let y = t.y0; y <= t.y1; y++) {
      const from = (y * FIELD_SIZE + t.x0) * 4
      const to = (y * FIELD_SIZE + t.x1 + 1) * 4
      for (let k = from; k < to; k++) pixels[k] = Math.round(data[k]! * 255)
    }
    this.touched = EMPTY()
    this.revision++
  }
}

/** Grow a box to include another. */
function grow(into: Box, box: Box): void {
  if (box.x0 > box.x1) return
  if (into.x0 > into.x1) {
    into.x0 = box.x0
    into.y0 = box.y0
    into.x1 = box.x1
    into.y1 = box.y1
    return
  }
  if (box.x0 < into.x0) into.x0 = box.x0
  if (box.y0 < into.y0) into.y0 = box.y0
  if (box.x1 > into.x1) into.x1 = box.x1
  if (box.y1 > into.y1) into.y1 = box.y1
}
