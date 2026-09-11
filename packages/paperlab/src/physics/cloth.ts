export type PinMode = 'top-edge' | 'top-corners' | 'corner' | 'none'

export interface ClothParams {
  /** Bend-spring strength: 1 = crisp paper, 0 = silk. Fabric mode falls out for free. */
  stiffness: number
  gravity: number
  wind: number
  /** Local-space y of the ground plane; particles settle onto it. */
  floor: number
}

const FIXED_DT = 1 / 120
const SOLVER_ITERATIONS = 5

/**
 * How much of the wind reaches a sheet turned edge-on to it.
 *
 * Zero would be the textbook answer and the wrong one: a sheet hanging exactly
 * along the wind would then hang perfectly still forever, because the one
 * thing that could break the symmetry is the wind it is not feeling. Real air
 * is turbulent and finds it. Small enough that a sheet still visibly turns its
 * face to the wind, large enough that it never stalls.
 */
const AERO_TURBULENCE = 0.15

/**
 * How much of the sheet a hand takes hold of, in world units.
 *
 * A grab used to move exactly ONE particle, which is a pin and not a pinch:
 * the sheet came to a point under the cursor and the rest of it hung off that
 * singularity, which is the look every cheap cloth demo has. Fingers hold a
 * patch about a centimetre across, and against a sheet whose width is one
 * world unit — call it A4 — that is about 0.05.
 *
 * Clamped at both ends where it is used. Below a cell and a half it collapses
 * back to the single particle it is replacing however fine the grid is; above
 * a fifth of the sheet a hand would be holding most of a small one.
 */
const GRAB_RADIUS = 0.05

const SLEEP_EPSILON = 1e-6
const SLEEP_FRAMES = 45

/**
 * How the hold falls off across that patch: 1 at the centre, 0 at the rim.
 *
 * Not a hard patch. Pinning a disc of particles rigidly is as wrong as pinning
 * one, in the other direction — the sheet gets a stiff coin in the middle of
 * it that gravity cannot bend. A falloff means the centre is held, the rim is
 * free, and everything between is partly both, which is what the pad of a
 * finger actually does to paper.
 *
 * Smoothstep rather than linear so the weight arrives at the rim with zero
 * slope; a kink in the weight is a visible crease in the drape.
 */
function grabFalloff(distance: number, radius: number): number {
  const t = Math.min(1, Math.max(0, distance / radius))
  const s = 1 - t
  return s * s * (3 - 2 * s)
}

/**
 * Verlet mass-spring grid on the sheet's own vertices — structural + shear +
 * bend springs, pins as the interface, wind as a force field, fixed timestep
 * with substeps, sleep when kinetic energy is negligible.
 *
 * Cloth solves the particles and hands them on: `PaperMesh` runs the deformer
 * stack over `positions`, so a behavior composes with the sim rather than
 * replacing it (pinned by `cloth-hosts-a-shape.test.ts`). Only the STRIP owns
 * its vertices outright — its rows are chain nodes, not the sheet's grid.
 * Pure JS, no three dependency.
 */
export class ClothSim {
  readonly cols: number
  readonly rows: number
  readonly count: number
  /** The sheet this grid was laid out on. Read by {@link adopt}. */
  readonly width: number
  readonly height: number
  readonly positions: Float32Array
  private readonly prev: Float32Array
  private readonly pinned: Uint8Array
  private readonly pinTargets: Float32Array
  /**
   * The constraints, one typed array per field rather than one object each.
   *
   * Because the effects layer has to vary them across the sheet, and an
   * object with a fixed `rest` cannot be varied cheaply. Paper that chars
   * SHRINKS — that is what curls it toward the flame, not softening — which
   * is a shorter rest length on exactly the constraints the heat reached.
   * Burnt-through paper has to stop pulling on what is left, which is a
   * broken flag. A wet corner is floppier than the dry sheet above it, which
   * is a per-constraint stiffness. None of that is in this file; this file
   * only makes it possible, and at the defaults below the solve is
   * bit-identical to the object version it replaces.
   */
  readonly constraintCount: number
  readonly constraintA: Uint32Array
  readonly constraintB: Uint32Array
  /** 0 = structural, 1 = shear, 2 = bend (scaled by `stiffness` at solve time). */
  readonly constraintKind: Uint8Array
  /**
   * The length each constraint is laid out at. Never changes; the reference
   * to shrink from.
   *
   * Float64, not Float32, and that is measured rather than cautious: with
   * single-precision rest lengths every one of them rounded, and the first
   * typed-array version of this solve disagreed with the object version it
   * replaced in 476–711 of 714 coordinates after five seconds. The object
   * version held a JS number, which is a double.
   */
  readonly naturalLength: Float64Array
  /** The length it pulls toward now. `naturalLength` until something shrinks or stretches it. */
  readonly restLength: Float64Array
  /** A multiplier on the constraint's own strength. 1 is the paper as built. */
  readonly constraintStiffness: Float64Array
  /** Non-zero where the paper between two particles is gone. Skipped by the solve. */
  readonly broken: Uint8Array
  /**
   * How easily each particle is moved, 0..1: one over its mass, relative to
   * dry paper.
   *
   * Mass matters in exactly two places here, and both are wired, because a
   * "heavier" that touched neither would be another knob that does nothing.
   * Gravity is an acceleration, so weight alone does not make wet paper fall
   * differently. What does: the air pushes a heavy particle less (the aero
   * term is divided by mass), and the constraint solve moves a heavy particle
   * less than a light one it is tied to. Zero is infinite mass: static, moved by nothing — not the air, not the solve, and not gravity either.
   */
  readonly invMass: Float32Array
  /**
   * How far the middle of each BEND spring sits off the line between its ends
   * when relaxed, along the sheet's normal — a signed rest curvature, as a
   * sagitta in world units. Ignored on every other kind of constraint.
   *
   * Positive curls the paper toward its FRONT, the face a flat sheet turns to
   * +z — which puts the middle of each span that far BEHIND its ends. Paper
   * curling toward you is hollow on the side you see; the first cut of this
   * had the middle in front, which is a dome, and a dome's rim goes the other
   * way.
   *
   * The only lever here with a sign, and the sign is why it exists. A bend
   * spring is a distance, and a distance cannot tell paper curled toward you
   * from paper curled away: shorten it and the sheet buckles, but which way
   * is a coin toss, and gravity can flip it through later. Measured on the
   * first version, which pushed hot paper toward the front along its normal
   * and left the char to hold it — the curl held while the heat did and
   * snapped through to the BACK the moment the front had passed. Charred
   * paper stays curled toward the side that burnt because that side shrank
   * more: a curvature built into the material, which is what this is.
   *
   * Solved as a couple — the middle moves one way, the two ends half as far
   * the other — so it bends the sheet and never pushes it anywhere. A push
   * cannot do this job: it moves paper, and a uniformly curled sheet in still
   * air has no business going anywhere.
   */
  readonly restBend: Float64Array
  /** For each bend spring, the particle between its ends; -1 for every other kind. */
  readonly constraintMiddle: Int32Array
  private params: ClothParams
  private time = 0
  private accumulator = 0
  private stillFrames = 0
  private grabbedIndex = -1
  /**
   * A normal per particle, refreshed once a frame.
   *
   * The sim needs these for one thing only — how much wind each part of the
   * sheet is actually catching — and it needs its OWN rather than the mesh's,
   * because the mesh's are computed after the fact by the adapter and a
   * deformer may be running over the top of them by then. Once a frame rather
   * than once a substep: paper does not turn far in eight milliseconds, and
   * this is the only part of the step that is not a constraint solve.
   */
  private readonly normals: Float32Array
  /**
   * How hard each particle is held, 0..1. Zero for all but the handful under
   * a hand, so it doubles as the inverse mass the constraint solver wants:
   * a particle is as immovable as it is held.
   */
  private readonly grabWeights: Float32Array
  /** Just the held ones, so nothing iterates the whole sheet to find six. */
  private grabbed: number[] = []
  /** Each held particle's offset from the one under the cursor, at grab time. */
  private grabOffsets: Float32Array = new Float32Array(0)
  /** Where the hand was at the start of the last step, and how fast it moved. */
  private readonly grabAt = new Float32Array(3)
  private readonly grabWas = new Float32Array(3)
  private readonly grabVelocity = new Float32Array(3)
  /** True when the sim has settled and steps are skipped. */
  asleep = false

  constructor(cols: number, rows: number, width: number, height: number, pins: PinMode, params: ClothParams) {
    this.cols = cols
    this.rows = rows
    this.count = cols * rows
    this.width = width
    this.height = height
    this.params = { ...params }
    this.positions = new Float32Array(this.count * 3)
    this.prev = new Float32Array(this.count * 3)
    this.pinned = new Uint8Array(this.count)
    this.pinTargets = new Float32Array(this.count * 3)
    this.grabWeights = new Float32Array(this.count)
    this.normals = new Float32Array(this.count * 3)
    // Flat, facing the camera, until the first step measures otherwise.
    for (let i = 0; i < this.count; i++) this.normals[i * 3 + 2] = 1

    // Grid matches PlaneGeometry vertex order: row-major, top row first,
    // x left→right, y top→bottom (from +h/2 down).
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i3 = (r * cols + c) * 3
        this.positions[i3] = (c / (cols - 1) - 0.5) * width
        this.positions[i3 + 1] = (0.5 - r / (rows - 1)) * height
        this.positions[i3 + 2] = 0
      }
    }
    this.prev.set(this.positions)

    const idx = (r: number, c: number) => r * cols + c
    const links: number[] = []
    const link = (a: number, b: number, kind: 0 | 1 | 2) => {
      links.push(a, b, kind)
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (c + 1 < cols) link(idx(r, c), idx(r, c + 1), 0)
        if (r + 1 < rows) link(idx(r, c), idx(r + 1, c), 0)
        if (c + 1 < cols && r + 1 < rows) {
          link(idx(r, c), idx(r + 1, c + 1), 1)
          link(idx(r, c + 1), idx(r + 1, c), 1)
        }
        if (c + 2 < cols) link(idx(r, c), idx(r, c + 2), 2)
        if (r + 2 < rows) link(idx(r, c), idx(r + 2, c), 2)
      }
    }

    const m = links.length / 3
    this.constraintCount = m
    this.constraintA = new Uint32Array(m)
    this.constraintB = new Uint32Array(m)
    this.constraintKind = new Uint8Array(m)
    this.naturalLength = new Float64Array(m)
    this.restLength = new Float64Array(m)
    this.constraintStiffness = new Float64Array(m).fill(1)
    this.broken = new Uint8Array(m)
    this.restBend = new Float64Array(m)
    this.constraintMiddle = new Int32Array(m).fill(-1)
    for (let k = 0; k < m; k++) {
      const a = links[k * 3]!
      const b = links[k * 3 + 1]!
      this.constraintA[k] = a
      this.constraintB[k] = b
      this.constraintKind[k] = links[k * 3 + 2]!
      // A bend spring runs two cells straight along a row or a column, so the
      // particle it bends around is the one halfway between, by index too.
      if (this.constraintKind[k] === 2) this.constraintMiddle[k] = (a + b) / 2
      const dx = this.positions[a * 3]! - this.positions[b * 3]!
      const dy = this.positions[a * 3 + 1]! - this.positions[b * 3 + 1]!
      const rest = Math.hypot(dx, dy)
      this.naturalLength[k] = rest
      this.restLength[k] = rest
    }
    this.invMass = new Float32Array(this.count).fill(1)

    // Pins hold their rest-pose position.
    const pin = (r: number, c: number) => {
      const i = idx(r, c)
      this.pinned[i] = 1
      this.pinTargets.set(this.positions.subarray(i * 3, i * 3 + 3), i * 3)
    }
    if (pins === 'top-edge') for (let c = 0; c < cols; c++) pin(0, c)
    if (pins === 'top-corners') {
      pin(0, 0)
      pin(0, cols - 1)
    }
    if (pins === 'corner') pin(0, 0)
  }

  /**
   * Carry a previous sim's drape across a rebuild.
   *
   * Sheet dimensions are a GEOMETRY dependency, so changing them builds a new
   * mesh and a new sim, and a new sim starts flat — which means a draped sheet
   * snaps rigid the instant it is resized. Nothing about the physics requires
   * that; it is only that nobody had carried the state over.
   *
   * What carries is the FREE particles, scaled by how much the sheet grew:
   * the constraints' rest lengths are laid out afresh at the new size, so
   * scaling the drape by the same ratio leaves every constraint exactly as
   * violated as it was and the sim simply continues. Pinned particles keep
   * the new layout's own rest positions instead — a pin holds a CORNER, and
   * the corner is where the resized sheet says it is.
   *
   * Refused in one case only: a different grid, because there is no
   * correspondence between the two sets of particles and the nearest thing to
   * one would be a guess. Everything else carries — a resize, a change of
   * pins, a deformer appearing on top. The sheet's state belongs to the sheet,
   * and none of those is a reason to have never fallen.
   *
   * That matters most for the one that is not a resize at all: a shape
   * arriving over a simulation rebuilds the mesh (the stack has its own
   * opinion about tessellation) without touching a single thing the physics
   * knows about. Resetting there would mean the sheet snapped flat the instant
   * you tried to fold the sheet you were holding, which is the whole point of
   * being able to.
   *
   * Returns whether it took.
   */
  adopt(previous: ClothSim | null | undefined): boolean {
    if (!previous || previous.cols !== this.cols || previous.rows !== this.rows) return false
    const sx = previous.width > 0 ? this.width / previous.width : 1
    const sy = previous.height > 0 ? this.height / previous.height : 1
    // Depth has no dimension of its own to scale by. The mean keeps a
    // uniform resize uniform, which is the case worth getting exactly right.
    const sz = (sx + sy) / 2
    for (let i = 0; i < this.count; i++) {
      if (this.pinned[i]) continue
      const i3 = i * 3
      this.positions[i3] = previous.positions[i3]! * sx
      this.positions[i3 + 1] = previous.positions[i3 + 1]! * sy
      this.positions[i3 + 2] = previous.positions[i3 + 2]! * sz
      // Velocity is the gap between the two, and verlet keeps it there. Carry
      // it too, or the sheet arrives at its new size perfectly still.
      this.prev[i3] = previous.prev[i3]! * sx
      this.prev[i3 + 1] = previous.prev[i3 + 1]! * sy
      this.prev[i3 + 2] = previous.prev[i3 + 2]! * sz
    }
    this.wake()
    return true
  }

  setParams(params: Partial<ClothParams>): void {
    // Called every frame while cloth renders — plain numeric compare, no JSON.
    let changed = false
    for (const key of ['stiffness', 'gravity', 'wind', 'floor'] as const) {
      const value = params[key]
      if (value !== undefined && value !== this.params[key]) {
        this.params[key] = value
        changed = true
      }
    }
    if (changed) this.wake()
  }

  wake(): void {
    this.asleep = false
    this.stillFrames = 0
  }

  /**
   * Take hold of the sheet at one particle.
   *
   * Separate from {@link grabNearest} because the particle a hand grabbed is
   * not always the particle nearest the point it touched: with a deformer
   * running over the simulation, what the pointer hit was a RENDERED vertex,
   * and the vertex it hit is the particle of the same index — the stack maps
   * a point to a point and never reorders them.
   *
   * What is taken hold of is a PATCH around that particle, not the particle
   * alone — see {@link GRAB_RADIUS}. The patch is measured across the GRID
   * rather than through space, because a hand holds a piece of the sheet and
   * keeps holding the same piece: measured through space, a fold that brought
   * a far corner near the fingers would silently add it to the grip.
   */
  grab(index: number): number {
    this.grabbedIndex = index >= 0 && index < this.count ? index : -1
    this.grabWeights.fill(0)
    this.grabbed = []
    if (this.grabbedIndex < 0) {
      this.grabOffsets = new Float32Array(0)
      this.wake()
      return -1
    }

    // Cell size on each axis, so the patch is round in the sheet's material
    // and not in its index space — the grid is only square when the sheet is.
    const cellX = this.cols > 1 ? this.width / (this.cols - 1) : this.width
    const cellY = this.rows > 1 ? this.height / (this.rows - 1) : this.height
    const cell = Math.max(cellX, cellY, 1e-6)
    const radius = Math.min(
      Math.max(GRAB_RADIUS, cell * 1.5),
      Math.max(cell, Math.min(this.width, this.height) * 0.2),
    )

    const centreRow = Math.floor(this.grabbedIndex / this.cols)
    const centreCol = this.grabbedIndex % this.cols
    const spanRows = Math.ceil(radius / cellY)
    const spanCols = Math.ceil(radius / cellX)
    const offsets: number[] = []
    const anchor = this.grabbedIndex * 3
    for (let r = centreRow - spanRows; r <= centreRow + spanRows; r++) {
      if (r < 0 || r >= this.rows) continue
      for (let c = centreCol - spanCols; c <= centreCol + spanCols; c++) {
        if (c < 0 || c >= this.cols) continue
        const i = r * this.cols + c
        // A pin is already held, and a particle with no mass to move is paper
        // that is not there — a pinch on a burnt-through hole closes on air.
        if (this.pinned[i] || this.invMass[i]! <= 0) continue
        const distance = Math.hypot((c - centreCol) * cellX, (r - centreRow) * cellY)
        const weight = i === this.grabbedIndex ? 1 : grabFalloff(distance, radius)
        if (weight <= 0) continue
        this.grabWeights[i] = weight
        this.grabbed.push(i)
        // Where this one sits relative to the fingers RIGHT NOW. The patch
        // travels rigidly: a pinch drags the paper, it does not iron it.
        const i3 = i * 3
        offsets.push(
          this.positions[i3]! - this.positions[anchor]!,
          this.positions[i3 + 1]! - this.positions[anchor + 1]!,
          this.positions[i3 + 2]! - this.positions[anchor + 2]!,
        )
      }
    }
    // A pinch that closed on nothing is not a grab, and must not report
    // itself as one: a hole wider than the patch, or a patch entirely pinned,
    // leaves no particle to hold. `grabNearest`'s callers read the return to
    // decide whether anything was caught (see `StripSim`'s, and the comment
    // on it), so saying yes here would be a grab that moves nothing and never
    // lets go.
    if (this.grabbed.length === 0) {
      this.grabbedIndex = -1
      this.grabOffsets = new Float32Array(0)
      this.wake()
      return -1
    }
    this.grabOffsets = Float32Array.from(offsets)
    this.grabAt.set(this.positions.subarray(anchor, anchor + 3))
    this.grabWas.set(this.grabAt)
    this.grabVelocity.fill(0)
    this.wake()
    return this.grabbedIndex
  }

  /** Nearest particle to a local-space point — the grab interface. */
  grabNearest(x: number, y: number, z: number): number {
    let best = -1
    let bestDist = Infinity
    for (let i = 0; i < this.count; i++) {
      const dx = this.positions[i * 3]! - x
      const dy = this.positions[i * 3 + 1]! - y
      const dz = this.positions[i * 3 + 2]! - z
      const d = dx * dx + dy * dy + dz * dz
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
    return this.grab(best)
  }

  /** How hard one particle is being held, 0..1 — for tests and for the adapter. */
  grabWeightAt(index: number): number {
    return this.grabWeights[index] ?? 0
  }

  /** Where the fingers are now. The patch follows, each particle by its weight. */
  moveGrab(x: number, y: number, z: number): void {
    if (this.grabbedIndex < 0) return
    this.grabAt[0] = x
    this.grabAt[1] = y
    this.grabAt[2] = z
    this.wake()
  }

  /**
   * Let go — and let go at SPEED.
   *
   * This used to drop the paper dead. Every held particle had its previous
   * position overwritten with its current one on the way past, and in a verlet
   * integrator the gap between those two IS the velocity, so a sheet whipped
   * across the frame and released came to a perfect standstill and then fell
   * straight down. Whatever you did with your hand, the paper had never heard
   * of it.
   *
   * The hand's velocity is measured per second (see {@link step}) and spent
   * here, converted into the one-substep gap the integrator reads it back out
   * of. Measured per second rather than per frame because a frame is not a
   * fixed length and a substep is: throwing the same sheet at the same speed
   * must not depend on what the frame rate happened to be.
   */
  release(): void {
    for (const i of this.grabbed) {
      const i3 = i * 3
      const held = this.grabWeights[i]!
      this.prev[i3] = this.positions[i3]! - this.grabVelocity[0]! * FIXED_DT * held
      this.prev[i3 + 1] = this.positions[i3 + 1]! - this.grabVelocity[1]! * FIXED_DT * held
      this.prev[i3 + 2] = this.positions[i3 + 2]! - this.grabVelocity[2]! * FIXED_DT * held
    }
    this.grabbedIndex = -1
    this.grabbed = []
    this.grabWeights.fill(0)
    this.grabVelocity.fill(0)
    this.wake()
  }

  step(delta: number): void {
    if (this.asleep) return
    // How fast the hand is travelling, in world units a second. Measured here
    // and not in `moveGrab`, which has no clock and is called once per frame
    // at whatever rate the frames happen to arrive; `release` spends it.
    if (this.grabbedIndex >= 0 && delta > 0) {
      for (let axis = 0; axis < 3; axis++) {
        this.grabVelocity[axis] = (this.grabAt[axis]! - this.grabWas[axis]!) / delta
      }
      this.grabWas.set(this.grabAt)
    }
    this.updateNormals()
    this.accumulator = Math.min(this.accumulator + delta, FIXED_DT * 4)
    while (this.accumulator >= FIXED_DT) {
      this.substep(FIXED_DT)
      this.accumulator -= FIXED_DT
    }
  }

  /**
   * Which way each part of the sheet is facing, by central difference across
   * the grid.
   *
   * Clamped at the edges rather than wrapped or skipped: an edge particle
   * takes the one-sided difference, which is the same normal its neighbour
   * has, and an edge with no normal is an edge the wind cannot push.
   *
   * Which SIDE the normal points at is deliberately not worried about. The
   * force below is `n (n·v)`, a quadratic form, and that is unchanged by
   * flipping n — which is exactly right for paper, a surface with no front as
   * far as the air is concerned.
   */
  private updateNormals(): void {
    const p = this.positions
    const n = this.normals
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const left = (r * this.cols + (c > 0 ? c - 1 : c)) * 3
        const right = (r * this.cols + (c < this.cols - 1 ? c + 1 : c)) * 3
        const up = ((r > 0 ? r - 1 : r) * this.cols + c) * 3
        const down = ((r < this.rows - 1 ? r + 1 : r) * this.cols + c) * 3
        const ux = p[right]! - p[left]!
        const uy = p[right + 1]! - p[left + 1]!
        const uz = p[right + 2]! - p[left + 2]!
        // Row 0 is the top of the sheet, so this one runs down it.
        const vx = p[down]! - p[up]!
        const vy = p[down + 1]! - p[up + 1]!
        const vz = p[down + 2]! - p[up + 2]!
        const nx = vy * uz - vz * uy
        const ny = vz * ux - vx * uz
        const nz = vx * uy - vy * ux
        const length = Math.sqrt(nx * nx + ny * ny + nz * nz)
        const i3 = (r * this.cols + c) * 3
        if (length > 1e-12) {
          n[i3] = nx / length
          n[i3 + 1] = ny / length
          n[i3 + 2] = nz / length
        } else {
          // Degenerate: a pinched or fully collapsed patch. Leave the last
          // honest answer rather than inventing one.
          n[i3] = 0
          n[i3 + 1] = 0
          n[i3 + 2] = 0
        }
      }
    }
  }

  private substep(dt: number): void {
    const { gravity, wind, stiffness, floor } = this.params
    const p = this.positions
    const damping = 0.985
    const dt2 = dt * dt
    this.time += dt

    let maxTravel = 0
    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3
      if (this.pinned[i]) {
        p[i3] = this.pinTargets[i3]!
        p[i3 + 1] = this.pinTargets[i3 + 1]!
        p[i3 + 2] = this.pinTargets[i3 + 2]!
        this.prev[i3] = p[i3]!
        this.prev[i3 + 1] = p[i3 + 1]!
        this.prev[i3 + 2] = p[i3 + 2]!
        continue
      }
      const x = p[i3]!
      const y = p[i3 + 1]!
      const z = p[i3 + 2]!
      const vx = (x - this.prev[i3]!) * damping
      const vy = (y - this.prev[i3 + 1]!) * damping
      const vz = (z - this.prev[i3 + 2]!) * damping

      // Gusty wind: coherent noise over time and position, blowing along +z
      // with a sideways component.
      const gust = wind * (0.55 + 0.45 * Math.sin(this.time * 1.7 + x * 2.1 + y * 1.3)) * 0.9
      // What the sheet CATCHES, which is not the same as what is blowing.
      //
      // The wind used to be a uniform shove along +z: every particle got the
      // same push whichever way its patch of paper happened to be facing. So a
      // sheet edge-on to the wind bellied out exactly as hard as one square to
      // it, a folded flap was pushed the same way as the face it was folded
      // behind, and nothing ever turned to the wind — which is the single most
      // recognisable thing paper does in air.
      //
      // The force on a thin surface is the air it intercepts, and that is the
      // component of the RELATIVE wind along the surface normal, pushed back
      // out along that normal: `n (n · (w − v))`.
      //
      // Relative is what earns the term its keep twice over. A sheet already
      // travelling with the wind stops being pushed by it, so a blown sheet
      // settles at a speed instead of accelerating away. And with no wind at
      // all the same expression is air RESISTANCE — which is why it is not
      // behind a test for whether it is windy. Paper's whole character in air
      // is that it does not fall like a stone, and it only does not because a
      // sheet falling face-down catches the air it is falling through while
      // one falling edge-down knifes past it. That fell out of this for free
      // and used to be missing entirely.
      //
      // Velocities here are per substep; the wind is per second, so the
      // particle's has to be converted before the two can be subtracted.
      const relX = gust * 0.25 - vx / dt
      const relY = -vy / dt
      const relZ = gust - vz / dt
      const nx = this.normals[i3]!
      const ny = this.normals[i3 + 1]!
      const nz = this.normals[i3 + 2]!
      const facing = nx * relX + ny * relY + nz * relZ
      // The turbulent residue keeps a sheet lying along the wind from stalling
      // in it forever; a still room has no turbulence to add.
      const ax = nx * facing * (1 - AERO_TURBULENCE) + gust * 0.25 * AERO_TURBULENCE
      const ay = ny * facing * (1 - AERO_TURBULENCE)
      const az = nz * facing * (1 - AERO_TURBULENCE) + gust * AERO_TURBULENCE
      // The air's push is a force, so it moves a heavy particle less. Gravity
      // is an acceleration and does not care — see `invMass`.
      const im = this.invMass[i]!
      // Zero inverse mass is infinite mass, and nothing moves it — gravity
      // included. The convention every solver shares, and the one a caller
      // reaching for "hold this particle still" will assume. `prev` is synced
      // so it leaves the moment it was frozen carrying no velocity.
      if (im <= 0) {
        this.prev[i3] = x
        this.prev[i3 + 1] = y
        this.prev[i3 + 2] = z
        continue
      }
      this.prev[i3] = x
      this.prev[i3 + 1] = y
      this.prev[i3 + 2] = z
      p[i3] = x + vx + ax * im * dt2
      p[i3 + 1] = y + vy + (ay * im - gravity * 3.2) * dt2
      p[i3 + 2] = z + vz + az * im * dt2
      maxTravel = Math.max(maxTravel, vx * vx + vy * vy + vz * vz)
    }

    // The hand. Held particles are integrated like any other and THEN drawn
    // toward where the fingers put them, by however hard each one is held —
    // so the centre of the pinch arrives exactly and the rim of it only
    // leans that way, still falling under gravity while it does.
    //
    // Their `prev` is deliberately left alone. It is the only record of how
    // fast the hand is moving them, and overwriting it is what used to make
    // a thrown sheet leave at a standstill; see `release`.
    for (let k = 0; k < this.grabbed.length; k++) {
      const i = this.grabbed[k]!
      const i3 = i * 3
      const k3 = k * 3
      const held = this.grabWeights[i]!
      for (let axis = 0; axis < 3; axis++) {
        const target = this.grabAt[axis]! + this.grabOffsets[k3 + axis]!
        p[i3 + axis] = p[i3 + axis]! + (target - p[i3 + axis]!) * held
      }
    }

    const {
      constraintA,
      constraintB,
      constraintKind,
      restLength,
      constraintStiffness,
      broken,
      invMass,
      restBend,
      constraintMiddle,
      normals,
    } = this
    const bend = 0.25 + stiffness * 0.7
    for (let iter = 0; iter < SOLVER_ITERATIONS; iter++) {
      for (let c = 0; c < this.constraintCount; c++) {
        // Paper that is not there any more does not hold anything up.
        if (broken[c]) continue
        const kind = constraintKind[c]!
        const k = (kind === 2 ? bend : kind === 1 ? 0.85 : 1) * constraintStiffness[c]!
        const ia = constraintA[c]!
        const ib = constraintB[c]!
        const a3 = ia * 3
        const b3 = ib * 3
        const dx = p[b3]! - p[a3]!
        const dy = p[b3 + 1]! - p[a3 + 1]!
        const dz = p[b3 + 2]! - p[a3 + 2]!
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (dist === 0) continue
        // Inverse mass: 0 is immovable, 1 is free, and a particle under the
        // soft edge of a grab is honestly somewhere between. The old 0/1/2
        // weights were this same split for the two cases it could express;
        // the ratio reproduces them exactly and covers the rest.
        const ma = this.pinned[ia] ? 0 : invMass[ia]! * (1 - this.grabWeights[ia]!)
        const mb = this.pinned[ib] ? 0 : invMass[ib]! * (1 - this.grabWeights[ib]!)
        const total = ma + mb
        if (total <= 0) continue
        const diff = ((dist - restLength[c]!) / dist / total) * k
        const aw = ma
        const bw = mb
        p[a3] = p[a3]! + dx * diff * aw
        p[a3 + 1] = p[a3 + 1]! + dy * diff * aw
        p[a3 + 2] = p[a3 + 2]! + dz * diff * aw
        p[b3] = p[b3]! - dx * diff * bw
        p[b3 + 1] = p[b3 + 1]! - dy * diff * bw
        p[b3 + 2] = p[b3 + 2]! - dz * diff * bw

        // The signed half of a bend — see `restBend`. After the distance, so
        // the spring's length decides how far the paper bends and this only
        // which way. Behind a test, so an uncurled sheet runs exactly the
        // arithmetic it always has.
        const sag = restBend[c]!
        if (sag !== 0) {
          const im = constraintMiddle[c]!
          const m3 = im * 3
          const nx = normals[m3]!
          const ny = normals[m3 + 1]!
          const nz = normals[m3 + 2]!
          const offset =
            (p[m3]! - (p[a3]! + p[b3]!) / 2) * nx +
            (p[m3 + 1]! - (p[a3 + 1]! + p[b3 + 1]!) / 2) * ny +
            (p[m3 + 2]! - (p[a3 + 2]! + p[b3 + 2]!) / 2) * nz
          const mm = this.pinned[im] ? 0 : invMass[im]! * (1 - this.grabWeights[im]!)
          const weight = mm + (ma + mb) / 4
          if (weight > 0) {
            // The middle belongs `sag` BEHIND its ends — see `restBend`.
            const lambda = ((-sag - offset) / weight) * k
            const along = lambda * mm
            const back = lambda / 2
            p[m3] = p[m3]! + nx * along
            p[m3 + 1] = p[m3 + 1]! + ny * along
            p[m3 + 2] = p[m3 + 2]! + nz * along
            p[a3] = p[a3]! - nx * back * ma
            p[a3 + 1] = p[a3 + 1]! - ny * back * ma
            p[a3 + 2] = p[a3 + 2]! - nz * back * ma
            p[b3] = p[b3]! - nx * back * mb
            p[b3 + 1] = p[b3 + 1]! - ny * back * mb
            p[b3 + 2] = p[b3 + 2]! - nz * back * mb
          }
        }
      }
    }

    // Ground plane with friction.
    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3
      if (p[i3 + 1]! < floor) {
        p[i3 + 1] = floor
        this.prev[i3] = this.prev[i3]! + (p[i3]! - this.prev[i3]!) * 0.5
        this.prev[i3 + 2] = this.prev[i3 + 2]! + (p[i3 + 2]! - this.prev[i3 + 2]!) * 0.5
      }
    }

    // Sleep bookkeeping: wind keeps the sheet awake by design.
    if (wind === 0 && this.grabbedIndex < 0) {
      if (maxTravel < SLEEP_EPSILON) {
        if (++this.stillFrames > SLEEP_FRAMES) this.asleep = true
      } else {
        this.stillFrames = 0
      }
    }
  }
}
