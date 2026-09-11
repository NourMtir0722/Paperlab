import { DAMAGE_CHANNELS, type DamageSource } from '../surface/damageContract'
import type { ClothSim } from './cloth'

/**
 * Damage, as the cloth feels it.
 *
 * The shading layer already draws a burn; this is what makes the paper under
 * it behave like burnt paper instead of a picture of it — the four-layer
 * rule's physics row. It lives in the main entry beside the sim, not in
 * `paperlab/fx`, for the same reason the shading does: `ClothSim` is not
 * exported, and what damage DOES to a sheet belongs to the sheet. fx decides
 * what causes it.
 *
 * Read from the 8-bit `pixels`, the same bytes the GPU draws, so the physics
 * and the picture cannot disagree about where the paper is. 1/255 is finer
 * than any of these levers can be seen to move.
 *
 * Cheap at rest: nothing is read unless the source's `version` moved.
 */

const { char: CHAR, saturation: SATURATION, presence: PRESENCE } = DAMAGE_CHANNELS

/**
 * Presence below this, as a byte, is paper the sheet does not draw.
 *
 * The shader cuts at `step(0.5, presence)`: drawn from 127.5/255 up, so from
 * 128. The physics uses the same line, because a particle that is drawn but
 * has left the solve hangs in the air, and one that is gone but still in it
 * pulls on paper that can see it isn't there.
 */
const GONE_BELOW = 128

/**
 * How far fully-charred paper shrinks in its own plane.
 *
 * Char shrinks — it does not soften, which would only make the sheet droop.
 * Every kind of spring alike: the shrinking is of the paper, and the curl is
 * {@link CHAR_CURL}'s job, not a difference in how far the springs shrink.
 */
const CHAR_SHRINK = 0.12

/**
 * The curvature fully-charred paper relaxes into, toward the sheet's front,
 * in one over world units: 6 is a curl of radius a sixth of a sheet — about
 * three and a half centimetres on A4, which is what a burnt edge rolls to.
 *
 * Char and not heat, because a burnt edge STAYS curled. The first version
 * drove the curl from heat and it held only while the heat did; see
 * `ClothSim.restBend`. Toward the front because that is the side a flame is
 * held on, and the side that chars first shrinks most.
 */
const CHAR_CURL = 6

/**
 * How steep the char has to be across a spring — as the squared byte
 * difference over four texels — before it counts as a burn front passing.
 * 16 over four texels is four bytes a texel; a real front is ten times that,
 * and the residue a cooling field leaves behind is well under it.
 */
const FRONT_GRADIENT = 16 * 16

/**
 * How much heavier soaked paper is: at full saturation, `1 + WET_MASS` times
 * dry. Paper holds a few times its own weight in water; three is where a
 * soaked sheet stops being carried by the air and starts to hang.
 */
const WET_MASS = 2

/**
 * Reads a `DamageSource` into one sheet's `ClothSim`: char into rest length
 * and rest curvature, saturation into mass, and missing paper out of the
 * solve altogether.
 *
 * Paper that is gone leaves the solve in two ways at once. Every constraint
 * touching it breaks, so it neither holds up nor pulls on what is left — a
 * sheet whose bottom half burnt away stops swinging from the weight of
 * nothing. And it loses its mass, so gravity and the air leave it alone too.
 *
 * What it does NOT do is fall. A gone particle is still a vertex, and the
 * triangles between it and the paper beside it are still drawn wherever the
 * paper is: let it drop and the burnt edge is dragged down after it in
 * streaks. So the ones next to live paper are carried along with it
 * ({@link follow}), and the ones in the middle of a hole stay where they
 * were, where nothing can see them.
 *
 * The limit, stated once: a sheet cannot come apart along a cut narrower than
 * a cloth cell. A constraint breaks only where a PARTICLE is gone, never
 * because the paper between two live ones is — breaking there would split
 * the sheet across a row of triangles that a fixed-topology mesh can only
 * draw stretched. A cut that thin separates the picture and not the paper;
 * really splitting a sheet takes a second mesh (see the fx plan).
 */
export class DamageCoupling {
  private readonly sim: ClothSim
  private source: DamageSource | null = null
  private version = -1
  private size = 0
  /** Each particle's texel, laid out for `size`. */
  private particleTexel = new Int32Array(0)
  /** Gone, per particle, as of the last read. */
  private readonly gone: Uint8Array
  /** The gone particles with live paper beside them. See {@link follow}. */
  private followers: number[] = []
  /**
   * Per bend spring, how squarely it lies ACROSS the burn front, 0..1 — and
   * remembered once it has been.
   *
   * A burnt edge rolls about an axis along the front, like a scroll; it does
   * not dish into a bowl. Measured with the curl in every bend spring alike: a
   * burnt band settled into a saddle, its corners forward and its middle BACK
   * (+0.07, −0.06), because a surface cannot curve two ways at once without
   * stretching and paper does not stretch. Curled across the front only, the
   * same band rolled toward the viewer along its whole edge (+0.13).
   *
   * "Across the front" is the direction the char is changing fastest in, at
   * the moment the front passes. It has to be remembered: once the front has
   * gone by, the char behind it is uniform and says nothing about direction,
   * but the paper stays rolled the way it rolled.
   */
  private readonly curlWeight: Float32Array

  constructor(sim: ClothSim) {
    this.sim = sim
    this.gone = new Uint8Array(sim.count)
    this.curlWeight = new Float32Array(sim.constraintCount)
  }

  /**
   * Bring the sim's levers up to date with `source`. Call before stepping.
   *
   * Returns whether anything was read. Free when the source has not changed,
   * and a null source hands every lever back at its default.
   */
  update(source: DamageSource | null | undefined): boolean {
    const next = source ?? null
    if (next === this.source && (next === null || next.version === this.version)) return false
    // A different source is a different sheet's history — a fresh sheet has
    // not rolled any way yet.
    if (next !== this.source) this.curlWeight.fill(0)
    this.source = next
    if (!next) {
      this.reset()
      return true
    }
    if (next.size !== this.size) this.layout(next.size)
    this.version = next.version
    this.read(next.pixels)
    this.sim.wake()
    return true
  }

  /**
   * Carry the gone particles at the edge of a hole along with the paper beside
   * them. Call after stepping.
   *
   * Each one goes where its live neighbours say it would be if the grid were
   * laid out flat around them — their positions plus its rest offset from
   * each, averaged. The triangles that straddle the burnt edge then keep
   * roughly their shape instead of stretching back to wherever the particle
   * was when it burnt. Only a band of a single particle's width, with live
   * paper pulling it both ways, is left averaging between them.
   */
  follow(): void {
    if (this.followers.length === 0) return
    const { gone, sim } = this
    const p = sim.positions
    const { cols, rows } = sim
    const cellX = cols > 1 ? sim.width / (cols - 1) : 0
    const cellY = rows > 1 ? sim.height / (rows - 1) : 0
    for (const g of this.followers) {
      const r = (g / cols) | 0
      const c = g % cols
      let sx = 0
      let sy = 0
      let sz = 0
      let n = 0
      for (let dr = -1; dr <= 1; dr++) {
        const nr = r + dr
        if (nr < 0 || nr >= rows) continue
        for (let dc = -1; dc <= 1; dc++) {
          const nc = c + dc
          if ((dr === 0 && dc === 0) || nc < 0 || nc >= cols) continue
          const j = nr * cols + nc
          if (gone[j]) continue
          const j3 = j * 3
          // Rows run down the sheet, so a neighbour a row BELOW sits lower,
          // and this particle a cell above it.
          sx += p[j3]! - dc * cellX
          sy += p[j3 + 1]! + dr * cellY
          sz += p[j3 + 2]!
          n++
        }
      }
      if (n === 0) continue
      const g3 = g * 3
      p[g3] = sx / n
      p[g3 + 1] = sy / n
      p[g3 + 2] = sz / n
    }
  }

  /** Map each particle to its texel. The damage grid's row 0 is v = 0, the sheet's BOTTOM. */
  private layout(size: number): void {
    const { cols, rows, count } = this.sim
    const last = size - 1
    this.size = size
    this.particleTexel = new Int32Array(count)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const u = cols > 1 ? c / (cols - 1) : 0.5
        // The cloth's row 0 is the TOP.
        const v = rows > 1 ? 1 - r / (rows - 1) : 0.5
        this.particleTexel[r * cols + c] = Math.round(v * last) * size + Math.round(u * last)
      }
    }
  }

  private read(pixels: Uint8Array): void {
    const { sim, gone, particleTexel, curlWeight, size } = this
    const {
      invMass,
      restLength,
      naturalLength,
      restBend,
      broken,
      constraintA,
      constraintB,
      constraintKind,
      constraintMiddle,
    } = sim

    for (let i = 0; i < sim.count; i++) {
      const t = particleTexel[i]! * 4
      const isGone = pixels[t + PRESENCE]! < GONE_BELOW
      gone[i] = isGone ? 1 : 0
      // Exactly 1 at a dry texel — an undamaged sheet must stay bit-identical
      // to one with no source at all.
      invMass[i] = isGone ? 0 : 1 / (1 + (WET_MASS * pixels[t + SATURATION]!) / 255)
    }

    for (let k = 0; k < sim.constraintCount; k++) {
      const a = constraintA[k]!
      const b = constraintB[k]!
      // A bend spring over a gone particle would bridge the hole, holding the
      // two sides together through paper that is not there.
      const m = constraintMiddle[k]!
      if (gone[a] || gone[b] || (m >= 0 && gone[m])) {
        broken[k] = 1
        continue
      }
      broken[k] = 0
      let charSum = pixels[particleTexel[a]! * 4 + CHAR]! + pixels[particleTexel[b]! * 4 + CHAR]!
      let samples = 2
      if (m >= 0) {
        charSum += pixels[particleTexel[m]! * 4 + CHAR]!
        samples = 3
      }
      const char = charSum / (samples * 255)
      // Exactly the natural length, and exactly no bend, at char 0.
      restLength[k] = naturalLength[k]! * (1 - CHAR_SHRINK * char)
      if (constraintKind[k] === 2) {
        // Is a front passing here, and does this spring run across it? The
        // char gradient at the spring's middle, by central difference.
        const t = particleTexel[m]!
        const x = t % size
        const y = (t / size) | 0
        const gx =
          pixels[(y * size + Math.min(size - 1, x + 2)) * 4 + CHAR]! -
          pixels[(y * size + Math.max(0, x - 2)) * 4 + CHAR]!
        const gy =
          pixels[(Math.min(size - 1, y + 2) * size + x) * 4 + CHAR]! -
          pixels[(Math.max(0, y - 2) * size + x) * 4 + CHAR]!
        const steep = gx * gx + gy * gy
        if (steep > FRONT_GRADIENT) {
          // A spring along a row spans two columns; one down a column, two rows.
          const across = (b - a === 2 ? gx * gx : gy * gy) / steep
          if (across > curlWeight[k]!) curlWeight[k] = across
        }
        // A curvature as the sagitta of this spring's span: κL²/8.
        const span = naturalLength[k]!
        restBend[k] = (CHAR_CURL * char * curlWeight[k]! * span * span) / 8
      }
    }

    const followers: number[] = []
    const { cols, rows } = sim
    for (let i = 0; i < sim.count; i++) {
      if (!gone[i]) continue
      const r = (i / cols) | 0
      const c = i % cols
      let beside = false
      for (let dr = -1; dr <= 1 && !beside; dr++) {
        const nr = r + dr
        if (nr < 0 || nr >= rows) continue
        for (let dc = -1; dc <= 1; dc++) {
          const nc = c + dc
          if (nc < 0 || nc >= cols) continue
          if (!gone[nr * cols + nc]) {
            beside = true
            break
          }
        }
      }
      if (beside) followers.push(i)
    }
    this.followers = followers
  }

  private reset(): void {
    const { sim } = this
    sim.invMass.fill(1)
    sim.restBend.fill(0)
    sim.broken.fill(0)
    sim.restLength.set(sim.naturalLength)
    this.gone.fill(0)
    this.curlWeight.fill(0)
    this.followers = []
    this.version = -1
    sim.wake()
  }
}
