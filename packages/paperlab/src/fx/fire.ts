import type { DamageField } from './field'
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
}

const DEFAULTS: Required<FireEmitterOptions> = { embers: 0.25, smoke: 0.12, ash: 0.35, seed: 7 }

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
      // Capped rather than trusted — see `PER_UPDATE`. A NaN delta falls
      // through both loops on its own, which is the right answer for it.
      this.emberDebt = Math.min(this.emberDebt + front * o.embers * dt, PER_UPDATE)
      this.smokeDebt = Math.min(this.smokeDebt + front * o.smoke * dt, PER_UPDATE)
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
    const size = this.field.size
    const last = size - 1
    // The field's convention: texel x sits at u = x / (size - 1), row 0 at v = 0.
    const at = this.locate((cell % size) / last, ((cell / size) | 0) / last)
    if (at) this.pool.spawn(name, at.x, at.y, at.z)
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
