import { fxQualityFor, type FxQualityName, type FxQualitySettings } from './quality'

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
 *   R  char        scorch colour, the brown halo, lost stiffness, smoke density
 *   G  saturation  wet darkening, roughness, translucency, added mass, sag
 *   B  heat        the glowing ignition line, the curl toward the flame
 *   A  presence    alpha erosion — burn-away, tear-away, punched holes
 *
 * **It runs on the CPU, and that is a deliberate departure from the plan.**
 * The plan called for a ping-pong FBO and a GPU diffusion pass. The argument
 * for one is real at high resolution and it does not apply at these sizes:
 * the field is 64–128 texels square, a substep is a four-neighbour read over
 * at most 16,384 cells, and the sheet it belongs to is already solving a
 * 28 × 28 constraint lattice five times a frame — an order of magnitude more
 * arithmetic than this, on the same thread, shipping today.
 *
 * What the CPU buys is the thing this repo has repeatedly found it needs:
 * the field is testable without a renderer. Every property below — that a
 * burn front advances, that it runs further along the grain than across it,
 * that water beats fire, that presence never returns — is a deterministic
 * unit test that runs in milliseconds. The alternative was a GPU pass whose
 * only witness would have been `test:hands`, which on an unchanged tree
 * reports three failures on one run and none on the next.
 *
 * It is also the half that Safari cannot surprise. Float render targets and
 * their read-back are exactly where the screenshot harness is structurally
 * blind — it is Chromium on SwiftShader — so putting the simulation where it
 * can be checked arithmetically leaves only the SHADING on the GPU, and a
 * shading chunk that is wrong is visibly wrong.
 *
 * The seam is kept open: nothing outside this file touches `data` except to
 * upload it, so moving the step onto the GPU later is a change to this class
 * and to nothing that uses it. Do that when a measurement asks for it.
 */

/** Channel offsets into a texel. Exported because the shader chunks agree with them. */
export const CHAR = 0
export const SATURATION = 1
export const HEAT = 2
export const PRESENCE = 3

export interface DamageFieldOptions {
  /** Device class. Decides the grid size and how many substeps a frame gets. */
  quality?: FxQualityName | FxQualitySettings
  /**
   * Which way the paper's fibres run, in radians over the sheet's UV, where
   * 0 points along +u.
   *
   * Paper is not isotropic and this is the single number that makes it look
   * like paper rather than like a fluid. Fibres are laid down along the
   * machine direction when the sheet is made; liquid wicks along them far
   * faster than across them, and a flame follows them for the same reason.
   * A wet front with this at zero is a circle, which reads as a stain on
   * cloth; with it set, the front is an ellipse with a frayed leading edge,
   * which reads as paper.
   */
  fibre?: number
  /** How much faster things travel along the fibre than across it. */
  anisotropy?: number
  /** Heat spread, in UV² per second. */
  heatDiffusion?: number
  /** Liquid wicking, in UV² per second, along the fibre. */
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
   * per field instance rather than per frame, because a sheet's grain does
   * not change while you hold it.
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
} satisfies Required<Omit<DamageFieldOptions, 'quality'>>

/** What the field did this step. The numbers the sound and the emitters read. */
export interface FieldStats {
  /**
   * How much sheet is actively burning right now, 0..1.
   *
   * The fraction of the sheet's texels that are part-way through charring.
   * Resolution-independent by construction, which matters because the tier
   * changes the grid and the sound must not change with it.
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
  /** Texels that became wet this step. Drives the water bed's level. */
  wetted: number
  /** Mean saturation over the sheet, 0..1. Drives added mass in the coupling. */
  saturation: number
  /** Fraction of the sheet still present, 1 at the start. */
  remaining: number
}

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
 * The largest the two diffusion coefficients may sum to in one substep.
 *
 * The five-point explicit Laplacian is stable up to 0.25 and rings as it
 * approaches it, so this sits below with margin. Raising it does not make
 * anything spread faster — it makes the spread oscillate, and the clamp to
 * 0..1 turns oscillation into quiet loss.
 */
const STABLE = 0.2

/** Cheap reproducible hash noise — same input, same sheet, every time. */
function hash(x: number, y: number, seed: number): number {
  // Multipliers kept inside 32 bits on purpose: anything larger is silently
  // rounded by a double before `^` truncates it, which makes the "hash"
  // lose its low bits and the grain come out in visible bands.
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export class DamageField {
  readonly size: number
  readonly quality: FxQualitySettings
  /** RGBA per texel, row-major from v = 0. The only thing a renderer uploads. */
  readonly data: Float32Array
  /** True while `data` differs from what was last uploaded. */
  dirty = true

  private readonly next: Float32Array
  /** Per-texel ignition threshold, fixed for the life of the sheet. */
  private readonly tinder: Float32Array
  private readonly o: Required<Omit<DamageFieldOptions, 'quality'>>
  /** Fibre direction as a unit vector, squared per axis — used every substep. */
  private readonly along: [number, number]
  private stats: FieldStats = {
    front: 0,
    charred: 0,
    consumed: 0,
    wetted: 0,
    saturation: 0,
    remaining: 1,
  }

  constructor(options: DamageFieldOptions = {}) {
    const { quality = 'auto', ...rest } = options
    this.quality = typeof quality === 'string' ? fxQualityFor(quality) : quality
    this.size = this.quality.field
    this.o = { ...DEFAULTS, ...rest }

    const n = this.size * this.size
    this.data = new Float32Array(n * 4)
    this.next = new Float32Array(n * 4)
    this.tinder = new Float32Array(n)

    // Presence starts at 1 — the whole sheet is there. Everything else at 0.
    for (let i = 0; i < n; i++) {
      this.data[i * 4 + PRESENCE] = 1
      const x = i % this.size
      const y = (i / this.size) | 0
      // Two octaves: a coarse one that makes whole regions catch before their
      // neighbours, and a fine one that frays the edge between them.
      const coarse = hash(x >> 2, y >> 2, this.o.seed)
      const fine = hash(x, y, this.o.seed * 7 + 11)
      // Centred on 1, so `grain` changes only the VARIANCE. Written as
      // `1 - grain * noise` it also lowered the mean, which made the sheet
      // easier to light the rougher its paper was — so a test that turned
      // the grain off to isolate the anisotropy turned the fire off with it,
      // and the knob was silently two knobs.
      this.tinder[i] = 1 + this.o.grain * (coarse * 0.65 + fine * 0.35 - 0.5)
    }

    const c = Math.cos(this.o.fibre)
    const s = Math.sin(this.o.fibre)
    this.along = [c * c, s * s]
  }

  /** Texel index for a UV, clamped to the sheet. */
  private at(u: number, v: number): number {
    const x = Math.min(this.size - 1, Math.max(0, Math.round(u * (this.size - 1))))
    const y = Math.min(this.size - 1, Math.max(0, Math.round(v * (this.size - 1))))
    return y * this.size + x
  }

  /** The four channels at a UV, for anything that needs to ask a question of a point. */
  sample(u: number, v: number): [number, number, number, number] {
    const i = this.at(u, v) * 4
    return [this.data[i]!, this.data[i + 1]!, this.data[i + 2]!, this.data[i + 3]!]
  }

  /** What the last `step` produced. */
  get lastStats(): FieldStats {
    return this.stats
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
   * soft peak; raised for anything removed, so a hole goes all the way
   * through.
   */
  paint(channel: number, u: number, v: number, radius: number, amount: number, plateau = 0): void {
    if (radius <= 0 || amount === 0) return
    const cx = u * (this.size - 1)
    const cy = v * (this.size - 1)
    const r = radius * (this.size - 1)
    const lo = Math.max(0, Math.floor(cy - r))
    const hi = Math.min(this.size - 1, Math.ceil(cy + r))
    const left = Math.max(0, Math.floor(cx - r))
    const right = Math.min(this.size - 1, Math.ceil(cx + r))
    const r2 = r * r

    for (let y = lo; y <= hi; y++) {
      for (let x = left; x <= right; x++) {
        const dx = x - cx
        const dy = y - cy
        const d2 = dx * dx + dy * dy
        if (d2 > r2) continue
        // smoothstep on the normalised distance, with an optional flat core.
        // Removal needs the core: a hole punched with a pure smoothstep never
        // quite reaches zero even at its centre — it lands around 0.02 — and
        // "almost all the way through" is not a hole. Everything ADDED keeps
        // the soft peak, because a flame held near paper does not deposit a
        // stamped disc of heat and a too-perfect edge is the first thing that
        // reads as fake.
        const d = Math.sqrt(d2) / r
        const t = plateau >= 1 ? 1 : Math.min(1, (1 - d) / (1 - plateau))
        const falloff = t * t * (3 - 2 * t)
        const i = (y * this.size + x) * 4 + channel
        // Presence is the one channel that is REMOVED rather than added, and
        // it must never come back — see `cut`.
        this.data[i] = Math.min(1, Math.max(0, this.data[i]! + amount * falloff))
      }
    }
    this.dirty = true
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
    const steps = Math.max(1, Math.ceil(Math.hypot(u1 - u0, v1 - v0) * this.size))
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
   * Advance the field.
   *
   * Substepped because explicit diffusion goes unstable above a step size set
   * by the rate and the cell size — and the frame's delta is not ours to
   * choose. The per-substep rate is clamped rather than the frame rejected,
   * so a long frame advances the front coarsely instead of exploding or
   * stalling.
   */
  step(delta: number): FieldStats {
    if (delta <= 0) return this.stats
    const substeps = this.quality.substeps
    const dt = Math.min(delta, 1 / 20) / substeps

    let charred = 0
    let consumed = 0
    let wetted = 0
    for (let s = 0; s < substeps; s++) {
      const done = this.substep(dt)
      charred += done.charred
      consumed += done.consumed
      wetted += done.wetted
    }

    // Front length and totals are read once at the end — they describe the
    // state, not the path taken to it.
    const n = this.size * this.size
    let front = 0
    let saturation = 0
    let present = 0
    for (let i = 0; i < n; i++) {
      const base = i * 4
      const presence = this.data[base + PRESENCE]!
      saturation += this.data[base + SATURATION]!
      present += presence
      // A burning EDGE is paper part-way through charring — not paper that
      // is merely hot. Those are different sets and the difference matters:
      // combustion pumps heat into everything it has already burnt, so a
      // "hot and present" test lights up the whole interior of the burn and
      // reports 90% of the sheet as flame front. What is actually burning is
      // the ring where char is on its way from nothing to everything, and
      // that ring is a few texels wide however big the fire gets.
      const c = this.data[base + CHAR]!
      if (presence > 0.15 && c > 0.08 && c < 0.92) front++
    }

    this.stats = {
      front: front / (this.size * this.size),
      charred,
      consumed,
      wetted,
      saturation: saturation / n,
      remaining: present / n,
    }
    if (charred > 0 || consumed > 0 || front > 0 || wetted > 0) this.dirty = true
    return this.stats
  }

  /** One stable diffusion + reaction pass. */
  private substep(dt: number): { charred: number; consumed: number; wetted: number } {
    const { size, data, o } = this
    const along = this.along
    const next = this.next
    const tinder = this.tinder
    const cell = 1 / (size - 1)
    const cell2 = cell * cell

    /**
     * Diffusion coefficients per axis, anisotropic and stable.
     *
     * Anisotropy first: each axis gets a share set by how much of the fibre
     * direction lies along it, normalised so that turning the grain changes
     * WHICH WAY things travel and not how fast overall.
     *
     * Then the stability clamp, and it is a clamp on the SUM. Explicit
     * diffusion on a five-point stencil is stable while the two coefficients
     * together stay under a quarter — not while each of them does. Written
     * per axis it admitted coefficients summing to 0.9, which rings: the
     * update overshoots negative, `Math.max(0, …)` clips the overshoot away,
     * and the clip is not symmetric, so every step quietly destroys some of
     * the quantity. A wet patch lost every drop of itself in two seconds and
     * looked from the outside like drying.
     *
     * Scaling the pair down rather than rejecting the step means a coarse
     * tier diffuses more slowly rather than unstably, which is the right
     * failure: the front still advances, it just advances less per frame.
     */
    const aniso = o.anisotropy
    const share = (axis: 0 | 1) => {
      const withGrain = along[axis]
      return (withGrain * aniso + (1 - withGrain)) / (1 + (aniso - 1) * 0.5)
    }
    const sx = share(0)
    const sy = share(1)
    const coefficients = (rate: number): [number, number] => {
      const scale = (rate * dt) / cell2
      const x = sx * scale
      const y = sy * scale
      const total = x + y
      const safe = total > STABLE ? STABLE / total : 1
      return [x * safe, y * safe]
    }
    const [hx, hy] = coefficients(o.heatDiffusion)
    const [wx, wy] = coefficients(o.wicking)

    next.set(data)
    let charred = 0
    let consumed = 0
    let wetted = 0

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x
        const b = i * 4
        const presence = data[b + PRESENCE]!

        // Gone is gone: a hole neither conducts heat nor holds water, which
        // is what makes a burnt-through region stop the fire rather than
        // carry it. The A channel is a boundary condition, not just a mask.
        if (presence <= 0) {
          next[b + HEAT] = 0
          next[b + SATURATION] = 0
          continue
        }

        const left = x > 0 ? i - 1 : i
        const right = x < size - 1 ? i + 1 : i
        const down = y > 0 ? i - size : i
        const up = y < size - 1 ? i + size : i

        // Neighbours weighted by their presence: heat does not cross a hole.
        const w = (j: number) => data[j * 4 + PRESENCE]!
        const lap = (channel: number, ax: number, ay: number) => {
          const here = data[b + channel]!
          const l = (data[left * 4 + channel]! - here) * w(left)
          const r = (data[right * 4 + channel]! - here) * w(right)
          const d = (data[down * 4 + channel]! - here) * w(down)
          const u = (data[up * 4 + channel]! - here) * w(up)
          return (l + r) * ax + (d + u) * ay
        }

        const h0 = data[b + HEAT]!
        const sat = data[b + SATURATION]!
        const char = data[b + CHAR]!

        // ── Heat ─────────────────────────────────────────────────────────
        let h = h0 + lap(HEAT, hx, hy)
        h -= h * o.cooling * dt

        // ── Water ────────────────────────────────────────────────────────
        let g = sat + lap(SATURATION, wx, wy)
        // Boiling off costs heat, which is exactly why a wet sheet will not
        // light: the flame front spends itself drying the paper in front of
        // it and arrives with nothing left. This one term is the whole of
        // "dunk the burning corner".
        if (g > 0 && h > 0) {
          const boiled = Math.min(g, h * o.wetResistance * dt)
          g -= boiled
          h -= boiled / o.wetResistance
        }
        // Proportional, not absolute. An absolute sink annihilates a thin
        // film: once diffusion has spread a wet patch below the amount
        // subtracted each substep, every cell clamps to zero at once and the
        // whole patch vanishes — which looked exactly like drying and was
        // not. Evaporation scales with how wet the paper is anyway.
        g -= g * o.drying * dt
        if (g > sat + 1e-6) wetted++

        // ── Char ─────────────────────────────────────────────────────────
        // Only paper dry enough to burn chars, and only above its own
        // threshold. The threshold varies per texel, which is where the
        // ragged front comes from.
        let c = char
        if (h > tinder[i]! * IGNITION && g < 0.25) {
          const made = Math.min(1 - c, o.charRate * (h - tinder[i]! * IGNITION) * dt)
          if (made > 0) {
            c += made
            // Burning is exothermic; above 1 the front feeds itself and runs.
            h += made * o.combustion
            if (char < 0.5 && c >= 0.5) charred++
          }
        }

        // ── Presence ─────────────────────────────────────────────────────
        // Fully charred paper is consumed. This is the only thing that
        // removes presence besides a cut, and it is one-way.
        let p = presence
        if (c > 0.85) {
          p = Math.max(0, p - o.consumeRate * (c - 0.85) * dt)
          if (presence > 0 && p <= 0) consumed++
        }

        next[b + CHAR] = Math.min(1, c)
        next[b + SATURATION] = Math.min(1, Math.max(0, g))
        next[b + HEAT] = Math.min(1, Math.max(0, h))
        next[b + PRESENCE] = p
      }
    }

    data.set(next)
    return { charred, consumed, wetted }
  }
}
