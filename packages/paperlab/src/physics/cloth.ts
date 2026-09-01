export type PinMode = 'top-edge' | 'top-corners' | 'corner' | 'none'

export interface ClothParams {
  /** Bend-spring strength: 1 = crisp paper, 0 = silk. Fabric mode falls out for free. */
  stiffness: number
  gravity: number
  wind: number
  /** Local-space y of the ground plane; particles settle onto it. */
  floor: number
}

interface Constraint {
  a: number
  b: number
  rest: number
  /** 0 = structural, 1 = shear, 2 = bend (scaled by stiffness at solve time). */
  kind: 0 | 1 | 2
}

const FIXED_DT = 1 / 120
const SOLVER_ITERATIONS = 5
const SLEEP_EPSILON = 1e-6
const SLEEP_FRAMES = 45

/**
 * Verlet mass-spring grid on the sheet's own vertices — structural + shear +
 * bend springs, pins as the interface, wind as a force field, fixed timestep
 * with substeps, sleep when kinetic energy is negligible.
 *
 * Constraint (enforced in the schema): cloth OWNS vertex positions — a paper
 * runs a behavior (deformer stack) OR cloth, never both. Pure JS, no three
 * dependency: the PaperMesh adapter copies `positions` into the geometry.
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
  private readonly constraints: Constraint[] = []
  private params: ClothParams
  private time = 0
  private accumulator = 0
  private stillFrames = 0
  private grabbedIndex = -1
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
    const link = (a: number, b: number, kind: 0 | 1 | 2) => {
      const dx = this.positions[a * 3]! - this.positions[b * 3]!
      const dy = this.positions[a * 3 + 1]! - this.positions[b * 3 + 1]!
      this.constraints.push({ a, b, rest: Math.hypot(dx, dy), kind })
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
   * Take hold of one particle by index.
   *
   * Separate from {@link grabNearest} because the particle a hand grabbed is
   * not always the particle nearest the point it touched: with a deformer
   * running over the simulation, what the pointer hit was a RENDERED vertex,
   * and the vertex it hit is the particle of the same index — the stack maps
   * a point to a point and never reorders them.
   */
  grab(index: number): number {
    this.grabbedIndex = index >= 0 && index < this.count ? index : -1
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
    this.grabbedIndex = best
    this.wake()
    return best
  }

  moveGrab(x: number, y: number, z: number): void {
    if (this.grabbedIndex < 0) return
    const i3 = this.grabbedIndex * 3
    this.positions[i3] = x
    this.positions[i3 + 1] = y
    this.positions[i3 + 2] = z
    this.prev[i3] = x
    this.prev[i3 + 1] = y
    this.prev[i3 + 2] = z
    this.wake()
  }

  release(): void {
    this.grabbedIndex = -1
  }

  step(delta: number): void {
    if (this.asleep) return
    this.accumulator = Math.min(this.accumulator + delta, FIXED_DT * 4)
    while (this.accumulator >= FIXED_DT) {
      this.substep(FIXED_DT)
      this.accumulator -= FIXED_DT
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
      if (this.pinned[i] || i === this.grabbedIndex) {
        if (this.pinned[i]) {
          p[i3] = this.pinTargets[i3]!
          p[i3 + 1] = this.pinTargets[i3 + 1]!
          p[i3 + 2] = this.pinTargets[i3 + 2]!
        }
        this.prev[i3] = p[i3]!
        this.prev[i3 + 1] = p[i3 + 1]!
        this.prev[i3 + 2] = p[i3 + 2]!
        continue
      }
      const x = p[i3]!
      const y = p[i3 + 1]!
      const z = p[i3 + 2]!
      // Gusty wind: coherent noise over time and position, pushing along +z
      // with a sideways component.
      const gust = wind * (0.55 + 0.45 * Math.sin(this.time * 1.7 + x * 2.1 + y * 1.3)) * 0.9
      const ax = gust * 0.25
      const az = gust
      const vx = (x - this.prev[i3]!) * damping
      const vy = (y - this.prev[i3 + 1]!) * damping
      const vz = (z - this.prev[i3 + 2]!) * damping
      this.prev[i3] = x
      this.prev[i3 + 1] = y
      this.prev[i3 + 2] = z
      p[i3] = x + vx + ax * dt2
      p[i3 + 1] = y + vy - gravity * 3.2 * dt2
      p[i3 + 2] = z + vz + az * dt2
      maxTravel = Math.max(maxTravel, vx * vx + vy * vy + vz * vz)
    }

    for (let iter = 0; iter < SOLVER_ITERATIONS; iter++) {
      for (const c of this.constraints) {
        const k = c.kind === 2 ? 0.25 + stiffness * 0.7 : c.kind === 1 ? 0.85 : 1
        const a3 = c.a * 3
        const b3 = c.b * 3
        const dx = p[b3]! - p[a3]!
        const dy = p[b3 + 1]! - p[a3 + 1]!
        const dz = p[b3 + 2]! - p[a3 + 2]!
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (dist === 0) continue
        const diff = ((dist - c.rest) / dist) * 0.5 * k
        const aPinned = this.pinned[c.a] || c.a === this.grabbedIndex
        const bPinned = this.pinned[c.b] || c.b === this.grabbedIndex
        if (aPinned && bPinned) continue
        const aw = aPinned ? 0 : bPinned ? 2 : 1
        const bw = bPinned ? 0 : aPinned ? 2 : 1
        p[a3] = p[a3]! + dx * diff * aw
        p[a3 + 1] = p[a3 + 1]! + dy * diff * aw
        p[a3 + 2] = p[a3 + 2]! + dz * diff * aw
        p[b3] = p[b3]! - dx * diff * bw
        p[b3 + 1] = p[b3 + 1]! - dy * diff * bw
        p[b3 + 2] = p[b3 + 2]! - dz * diff * bw
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
