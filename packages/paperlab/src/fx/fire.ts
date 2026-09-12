import { HEAT, type DamageField } from './field'
import type { ParticlePool } from './particles'

/**
 * Where a point of the sheet is in the world, given its UV — `v = 0` at the
 * bottom edge, as the damage grid has it. Null when it cannot say (the sheet
 * has not mounted yet).
 *
 * On `<Paper>` this is `(u, v) => handle.surfacePoint(u, v, scratch)`: the
 * drawn surface this frame, after the cloth and the deformers. A callback and
 * not the handle, because `paperlab/fx` cannot name a type from the main
 * entry without reaching into it — see `fx/boundary.test.ts`.
 */
export type SurfaceLocator = (
  u: number,
  v: number,
) => { readonly x: number; readonly y: number; readonly z: number } | null

export interface FireEmitterOptions {
  /** Embers a second for every texel on the burn front. */
  embers?: number
  /** Puffs of smoke a second for every texel on the burn front. */
  smoke?: number
  /** The chance a texel that burns through leaves a flake of ash. */
  ash?: number
  /** Seed for which cells are chosen, so a replayed burn throws the same sparks. */
  seed?: number
  /** The most of each kind in the air at once — `fxQualityFor(tier).caps`. Uncapped if omitted. */
  caps?: { ember?: number; smoke?: number; ash?: number }
}

// Smoke kept light: a clean fire makes little, and a frame full of it hides
// the burn — more only where burning struggles (see `struggle` below).
const DEFAULTS: Required<FireEmitterOptions> = { embers: 0.59, smoke: 0.19, ash: 0.86, seed: 7, caps: {} }

/**
 * The most of each kind one `update` may emit.
 *
 * A caller's `dt` is not a promise: this is public API, and a tab returning
 * from the background can hand it a delta of minutes. Without a ceiling the
 * debt loop below runs once per whole unit of it — which is a frozen page for
 * a shower of particles the pool would immediately throw away, since it only
 * holds `capacity` of them. An infinite delta never left the loop at all.
 */
const PER_UPDATE = 24

/**
 * What a burn throws into the air, read off the field that is burning.
 *
 * Nothing here decides where a fire IS — the field does. Embers and smoke
 * leave the front, at a rate set by how long the front is (a fire gets
 * busier as its edge gets longer, the same number its sound follows). Ash
 * leaves exactly the texels that burnt through this frame, so a hole opening
 * is a hole shedding. On a sheet nothing is happening to, `update` reads two
 * zeros and returns.
 */
export class FireEmitter {
  private readonly field: DamageField
  private readonly pool: ParticlePool
  private readonly locate: SurfaceLocator
  private readonly o: Required<FireEmitterOptions>
  private emberDebt = 0
  private smokeDebt = 0
  private state: number

  constructor(
    field: DamageField,
    pool: ParticlePool,
    locate: SurfaceLocator,
    options: FireEmitterOptions = {},
  ) {
    this.field = field
    this.pool = pool
    this.locate = locate
    this.o = { ...DEFAULTS, ...options }
    this.state = this.o.seed >>> 0 || 1
  }

  /** Call once a frame, after the field has stepped. */
  update(dt: number): void {
    const { field, o } = this
    const front = field.frontCount
    const consumed = field.consumedCount
    if (front === 0 && consumed === 0) {
      // A fire that has gone out owes nothing: a debt carried across would
      // put out a burst of sparks the moment the next one caught.
      this.emberDebt = 0
      this.smokeDebt = 0
      return
    }

    for (let k = 0; k < consumed; k++) {
      if (this.next() < o.ash) this.emit('ash', field.consumedCells[k]!)
    }

    if (front > 0 && dt > 0) {
      // The air the page is blowing, from the same pool the smoke rides.
      const [wx, wy, wz] = this.pool.wind
      const air = Math.hypot(wx, wy, wz)
      // How well it is burning: the mean heat along the front. A clean, hot
      // front makes little smoke; one that is catching, dying or being blown
      // on makes a lot (fire spec §4.9, §8.2 — smoke peaks when burning
      // struggles, never at the peak).
      let heat = 0
      for (let k = 0; k < front; k++) heat += field.data[field.frontCells[k]! * 4 + HEAT]!
      heat /= front
      const struggle = 0.35 + 1.6 * Math.max(0, 0.7 - heat) + air * 0.8
      // Blown on, a fire gets air: the embers flare and more fly (§10.6).
      const oxygen = 1 + air * 1.5
      // Capped rather than trusted — see `PER_UPDATE`. A NaN delta falls
      // through both loops on its own, which is the right answer for it.
      this.emberDebt = Math.min(this.emberDebt + front * o.embers * oxygen * dt, PER_UPDATE)
      this.smokeDebt = Math.min(this.smokeDebt + front * o.smoke * struggle * dt, PER_UPDATE)
      while (this.emberDebt >= 1) {
        this.emberDebt -= 1
        this.emit('ember', field.frontCells[Math.floor(this.next() * front)]!)
      }
      while (this.smokeDebt >= 1) {
        this.smokeDebt -= 1
        this.emit('smoke', field.frontCells[Math.floor(this.next() * front)]!)
      }
    }
  }

  private emit(name: 'ember' | 'smoke' | 'ash', cell: number): void {
    const cap = this.o.caps[name]
    if (cap !== undefined && this.pool.countOf(name) >= cap) return
    const size = this.field.size
    const last = size - 1
    // The field's convention: texel x sits at u = x / (size - 1), row 0 at v = 0.
    const at = this.locate((cell % size) / last, ((cell / size) | 0) / last)
    if (!at) return
    if (name === 'ember') {
      // Sparks leave the flames as well as the edge: some start partway up a
      // tongue, a little to one side, and drift off from there.
      const lift = this.next() * this.next() * 0.09
      this.pool.spawn(name, at.x + (this.next() - 0.5) * 0.012, at.y + lift, at.z)
    } else {
      this.pool.spawn(name, at.x, at.y, at.z)
    }
  }

  /** xorshift32 — its own stream, so the pool's randomness cannot shift which cells are picked. */
  private next(): number {
    let s = this.state
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    this.state = s >>> 0
    return this.state / 4294967296
  }
}
