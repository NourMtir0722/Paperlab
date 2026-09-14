import type { DamageSource } from '../surface/damageContract'
import { FIELD_SIZE, HEAT, type DamageField } from './field'

export interface AfterglowOptions {
  /**
   * How long a bead keeps glowing after the heat under it has gone, in
   * seconds — a range, each cell drawn its own life from it by a seeded hash.
   */
  hold?: readonly [number, number]
  /** Seed for which bead outlives which. */
  seed?: number
}

/** The most a spent cell may keep glowing: a smoulder, not a fire. */
const SMOULDER = 0.3
/** Below this a bead is out. */
const OUT = 0.004

/**
 * The embers a burn leaves behind, drawn over the field it came from.
 *
 * Smoulder: after the flames, glowing spots
 * crawl along the edge, flare on a breath, and go out one by one over
 * seconds. The field cannot do this, and it is not a tuning problem:
 * a burn blown out loses its heat in a fraction of a second — below ignition
 * everywhere or it recovers — so its own heat channel has nothing left to
 * smoulder with.
 *
 * So this is presentation, and holds no simulation state. It wraps a field as
 * a `DamageSource`: every channel is the field's, except HEAT, which is the
 * field's heat or what each cell remembers of it, whichever is more. When the
 * heat under a cell goes, the cell keeps a smoulder's worth of it and lets it
 * go at its own pace — each cell's pace drawn once from a seeded hash, so
 * beads go out one at a time, and the same burn goes out the same way. A
 * breath flares what is left.
 *
 * Only the sheet reads it. Flames and the fire light read the FIELD, so the
 * flames die with the gas while the edge keeps glowing; the physics
 * reads char, saturation and presence, which pass through untouched.
 */
export class Afterglow implements DamageSource {
  readonly size = FIELD_SIZE
  readonly pixels = new Uint8Array(FIELD_SIZE * FIELD_SIZE * 4)
  private readonly field: DamageField
  private readonly glow = new Float32Array(FIELD_SIZE * FIELD_SIZE)
  private readonly rate = new Float32Array(FIELD_SIZE * FIELD_SIZE)
  private revision = 0
  private clock = 0
  private flare = 0
  private lastField = -1
  private lit = false

  constructor(field: DamageField, options: AfterglowOptions = {}) {
    this.field = field
    const [shortest, longest] = options.hold ?? [0.6, 2.2]
    const seed = (options.seed ?? 5) >>> 0
    for (let i = 0; i < this.rate.length; i++) {
      // A bead's life, from its own hash: e^(-rate · t) over [0.3 → out] is
      // ln(75) / rate, so these lives land the last bead between ~2 and ~8 s.
      let h = Math.imul(i ^ seed, 2654435761) >>> 0
      h ^= h >>> 15
      h = Math.imul(h, 2246822519) >>> 0
      const life = shortest + (longest - shortest) * ((h >>> 0) / 4294967296)
      this.rate[i] = 1 / life
    }
    this.pixels.set(field.pixels)
  }

  get version(): number {
    return this.revision
  }

  get detail(): number | undefined {
    return this.field.detail
  }

  /** Its own clock: the beads keep flickering after the field has gone to sleep. */
  get time(): number {
    return this.clock
  }

  /** Whether anything is still glowing that the field no longer is. */
  get smouldering(): boolean {
    return this.lit
  }

  /**
   * Advance by `dt`, after the field has stepped. `blow` is the breath on the
   * sheet, 0..1: it flares what is left ("on smoulder: beads flare,
   * then fade").
   */
  step(dt: number, blow = 0): void {
    if (!(dt > 0)) return
    this.clock += dt
    this.flare = blow > 0.05 ? Math.min(1, this.flare + dt * 4) : Math.max(0, this.flare - dt * 1.5)
    const data = this.field.data
    const glow = this.glow
    let lit = false
    for (let i = 0; i < glow.length; i++) {
      const heat = data[i * 4 + HEAT]!
      const was = glow[i]!
      let next: number
      if (heat >= was) {
        // Follow the heat up at once.
        next = heat
      } else {
        // Let it go slowly: at most a smoulder's worth, then its own pace.
        next = Math.max(heat, Math.min(was, SMOULDER) * Math.exp(-dt * this.rate[i]!))
      }
      if (next < OUT) next = 0
      glow[i] = next
      if (next > heat + OUT) lit = true
    }
    this.lit = lit
    this.sync()
  }

  /** Copy the field in, and lay the remembered heat over its heat channel. */
  private sync(): void {
    const fieldVersion = this.field.version
    if (!this.lit && fieldVersion === this.lastField && this.flare === 0) return
    this.lastField = fieldVersion
    const src = this.field.pixels
    const dst = this.pixels
    dst.set(src)
    const boost = 1 + 0.9 * this.flare
    for (let i = 0; i < this.glow.length; i++) {
      const g = Math.round(Math.min(1, this.glow[i]! * boost) * 255)
      const k = i * 4 + HEAT
      if (g > dst[k]!) dst[k] = g
    }
    this.revision++
  }
}
