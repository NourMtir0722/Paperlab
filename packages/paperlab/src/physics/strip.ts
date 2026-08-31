import { rollRadius, windAngle } from '../deformers/roll'

/**
 * A strip of paper paying off a roll, and the pile it makes when it lands.
 *
 * The one simulation in the library with a DRIVING BODY. Cloth is a passive
 * grid that gravity and wind act on; this is a kinematic roll that the host
 * turns, extruding paper into a chain that is then left to fall. Scroll the
 * page, the roll spins, paper pays out, and it buckles into an accordion on
 * the floor. The pile is the point — everything else here exists to make it
 * possible.
 */
export interface StripParams {
  /**
   * The host's scroll position, in world units of paper it would like to see.
   * MONOTONIC and unbounded — bind it to `scrollY * k`, not to a 0..1
   * progress. The sim differentiates it, so only the delta between frames is
   * read and the absolute value never matters.
   */
  scroll: number
  /** How tightly the paper is wound: thin layers and many turns, or few and fat. */
  tightness: number
  /** Radius of the cardboard tube. The roll never pays out past it. */
  core: number
  /** Paper already hanging before the first scroll — a roll always has a leaf out. */
  tail: number
  /** Spacing of the perforations, in world units. One sheet's worth of strip. */
  perforation: number
  /** How much a perforation remembers being folded. 0 = a fresh roll, 1 = a used one. */
  crease: number
  /** Bend stiffness of the paper between perforations. 1 = card, 0 = cloth. */
  stiffness: number
  /** Broadside air drag. Paper is light and wide; this is what makes it float down. */
  drag: number
  gravity: number
  /** How far below the roll the paper lands. A distance, not a signed y. */
  floor: number
  /** How long the roll coasts after the scroll stops. 0 = stops dead, 1 = free-spinning. */
  inertia: number
}

const FIXED_DT = 1 / 120
/** Paper is inextensible; it takes more iterations than cloth to hold that. */
const SOLVER_ITERATIONS = 8
const SLEEP_EPSILON = 1e-7
const SLEEP_FRAMES = 45

/** Layer gap at `tightness` 0 and 1 — visible thickness, not a real 60µm ply. */
const LOOSE = 0.055
const TIGHT = 0.012

/**
 * Chain nodes per perforated panel.
 *
 * The floor is about four — below that a panel is a straight line and cannot
 * buckle. The number is far above that floor because the ROLL, not the pile,
 * sets the requirement: the same nodes that fold on the floor are the ones
 * drawing the spiral, and a wound turn is only as round as the nodes spanning
 * it. At five to a panel a full roll is a visible sixteen-sided polygon and
 * the innermost turn is drawn with FOUR nodes at 85° a step, which is coarse
 * enough that the chords cut clean through the neighbouring wrap and the
 * spiral comes apart into a sawtooth. See {@link safeSpiralRadius}.
 *
 * Affordable: the preset's chain is 198 nodes and costs 0.13 ms a frame,
 * under a hundredth of a 60fps budget. The chain is one-dimensional, so
 * resolution here is cheap in a way a cloth grid's never is.
 */
const NODES_PER_PANEL = 16
/** Verlet nodes are two vertices each; this is the geometry budget, not the physics one. */
const MAX_NODES = 440
const MIN_NODES = 8

/**
 * The bend constraint's constants were tuned at this spacing. Panels are
 * jointed every `segment`, so a finer chain has proportionally more joints
 * bending the same panel — without scaling by this, raising the resolution
 * for the roll's sake would quietly turn every panel to cloth.
 */
const REFERENCE_SEGMENT = 0.0375

/**
 * Arc span the broadside/along-length split is measured over, in world units.
 *
 * Deliberately a DISTANCE rather than "the two neighbouring nodes". The split
 * decides how much of a node's motion the air resists, so a tangent estimated
 * from whatever happens to be adjacent makes drag a function of the node
 * count: a coarse chain reads a bend as travel along its own length and
 * barely damps it, a fine one reads the same bend as broadside and damps it
 * hard. Measured over a fixed span the answer is the same at any resolution,
 * which is what lets the roll's tessellation be raised without re-tuning
 * every drag constant beneath it.
 */
const TANGENT_SPAN = 0.09

/** Share of a pull's unmet reach the roll gives up per substep. */
const PULL_STIFFNESS = 0.35

/**
 * Solver iterations that also push overlapping folds apart.
 *
 * Self-collision used to run once, after the constraint loop had finished,
 * which is too late to matter in a pile: separating two folds moves them off
 * their rest lengths, and with no iterations left to restore those the next
 * substep pulled them straight back through each other. Interleaving the last
 * few passes lets length and separation settle together, which is the only
 * way a heap holds its own height.
 */
const COLLIDING_ITERATIONS = 4

/** How much of a segment overlap is resolved per collision pass. */
const COLLISION_RELAXATION = 0.35

/**
 * Tightest radius this chain can wind to without the spiral cutting through
 * itself.
 *
 * A wrap is drawn as a polygon of `segment`-long chords, and a chord of
 * length `s` on a circle of radius `r` dips `s²/8r` inside it. Once that dip
 * exceeds half the gap between wraps, the chord crosses into the wrap
 * beneath — so `s²/8r < t/2`, and the spiral must stop at `s²/4t`.
 *
 * Sizing a roll with {@link rollRadius} lands the innermost wrap exactly on
 * the core, so a well-proportioned roll never reaches this. It is here
 * because `core`, `tightness` and the sheet's length are independent numbers
 * a caller may set to anything, and "wound tighter than it can be drawn" has
 * to degrade to a smooth tight coil rather than to a starburst.
 */
function safeSpiralRadius(segment: number, thickness: number): number {
  return thickness > 0 ? (segment * segment) / (4 * thickness) : 0
}

export function layerThickness(tightness: number): number {
  return LOOSE - Math.min(1, Math.max(0, tightness)) * (LOOSE - TIGHT)
}

/**
 * How many nodes a strip of this length wants. Exported because the MESH has
 * to be built before the sim is — the geometry is a 2×N quad strip and its
 * row count has to agree with the chain exactly.
 */
export function stripNodeCount(length: number, perforation: number): number {
  const seg = Math.max(perforation, 1e-3) / NODES_PER_PANEL
  return Math.min(MAX_NODES, Math.max(MIN_NODES, Math.round(length / seg) + 1))
}

/**
 * The longest strip this chain can still draw properly, for a given
 * perforation spacing.
 *
 * {@link stripNodeCount} is CAPPED, and the cap does not fail loudly: past it
 * the node count stops growing, so `segment` (which is `length / (count - 1)`)
 * grows instead, and every constant that was tuned per node quietly changes
 * meaning. The first thing to break is the roll — a longer chord on the same
 * radius dips further inside the wrap beneath it, so the spiral heads for the
 * {@link safeSpiralRadius} threshold and comes apart into a starburst.
 *
 * Exported because it is a UI limit as much as a physics one: a length slider
 * that runs past this hands the user a roll that visibly falls apart, and the
 * editor has no other way to know where the ceiling is. The constants that set
 * it live here, so the derivation does too.
 */
export function maxStripLength(perforation: number): number {
  const seg = Math.max(perforation, 1e-3) / NODES_PER_PANEL
  // count = round(L/seg) + 1 must stay <= MAX_NODES, and `round` gives half a
  // step of slack before the cap actually binds.
  return (MAX_NODES - 1 - 0.5) * seg
}

/**
 * Verlet chain in the y–z plane, extruded from a kinematic roll.
 *
 * **The chain does not grow.** Nodes are never spawned or destroyed; they are
 * RECLASSIFIED. Every node exists from the first frame, and the ones that
 * have not been paid out yet are placed analytically on the roll's spiral
 * each substep while the rest run free. The boundary between the two walks
 * along the chain as paper feeds.
 *
 * That is worth the paragraph because the obvious implementation — spawn a
 * particle at the anchor as `L` grows — needs a resizing vertex buffer, has
 * to invent a velocity for each new particle, and pops visibly at the seam.
 * Here the buffer is fixed, rewind is the same code path run backwards, and
 * the tangential velocity the spec asks new paper to inherit falls out for
 * free: a node released from the spiral was already being moved along it, so
 * its Verlet velocity is the roll's surface velocity on the frame it lets go.
 *
 * **It simulates two dimensions, not three.** The strip hangs in y, folds in
 * z, and keeps its full width in x with no twist. Toilet paper piles in the
 * plane it unrolls in, so the third axis buys almost nothing visually and
 * costs the thing that actually matters — self-collision stays a 2D query,
 * which is what lets the folds stack instead of passing through each other.
 */
export class StripSim {
  /** Chain length. Node 0 is the deepest wrap; node `count-1` is the free tip. */
  readonly count: number
  /** Rest spacing between neighbours, in world units. */
  readonly segment: number
  /** Node centreline, y/z interleaved. x is implicit: the strip never twists. */
  private readonly pos: Float64Array
  private readonly prev: Float64Array
  /** Arc distance from the tip, per node. */
  private readonly arc: Float64Array
  /** 1 where a perforation hinges, and the sign of the crease it remembers. */
  private readonly perforated: Int8Array

  /** Bend gain correction for this chain's node spacing. See {@link REFERENCE_SEGMENT}. */
  private readonly bendScale: number
  /** Half-width, in nodes, of the window the drag tangent is measured over. */
  private readonly tangentNodes: number
  private readonly halfWidth: number
  private readonly totalLength: number
  /**
   * Paper that can never be paid out, because its inner end is glued to the
   * tube — which is true of every roll you have ever used.
   *
   * Without it the roll pays out to nothing, `firstFreeIndex` reaches 0, and
   * every node the roll was made of becomes free paper and falls: the whole
   * roll drops off its holder and lands flat on the pile. One wrap held back
   * leaves a cylinder at the core radius on the holder, which is what an
   * empty roll looks like and the closest this library can get to drawing a
   * cardboard tube out of the one sheet it has.
   */
  private tubeStub: number
  private params: StripParams

  /** Paid-out length: how much paper is off the roll. */
  private paid: number
  /** Angular velocity of the roll, rad/s. The thing that coasts. */
  private omega = 0
  /**
   * Whether anything has turned the roll yet — a scroll delta or a hand.
   *
   * `tail` is the opening pose, and editing it should re-pose the roll; but
   * once the host has scrolled, `paid` is the simulation's own state and
   * re-posing would yank the paper back out of the pile.
   */
  private driven = false
  private lastScroll: number
  private primed = false

  /** Node held by the pointer, or -1. Kinematic while held, like a wound node. */
  private grabbed = -1
  private grabY = 0
  private grabZ = 0

  private stillFrames = 0
  private accumulator = 0
  private time = 0
  asleep = false

  // Spatial hash for self-collision. Sized once, refilled in place — the
  // per-substep collision pass allocates nothing.
  private readonly cellOf: Int32Array
  private readonly bucketStart: Int32Array
  private readonly bucketItems: Int32Array
  private readonly bucketFill: Int32Array
  private readonly tableSize: number

  constructor(length: number, width: number, params: StripParams) {
    this.params = { ...params }
    this.totalLength = length
    this.halfWidth = width / 2
    this.count = stripNodeCount(length, params.perforation)
    this.segment = length / (this.count - 1)
    this.bendScale = Math.min(1, this.segment / REFERENCE_SEGMENT)
    this.tangentNodes = Math.max(1, Math.round(TANGENT_SPAN / this.segment))

    this.pos = new Float64Array(this.count * 2)
    this.prev = new Float64Array(this.count * 2)
    this.arc = new Float64Array(this.count)
    this.perforated = new Int8Array(this.count)

    for (let i = 0; i < this.count; i++) {
      this.arc[i] = (this.count - 1 - i) * this.segment
    }
    // A perforation sits wherever the arc distance from the tip crosses a
    // multiple of the spacing. The sign alternates so the pile accordions
    // instead of curling one way forever.
    const spacing = Math.max(params.perforation, this.segment * 2)
    for (let i = 0; i < this.count - 1; i++) {
      const here = Math.floor(this.arc[i]! / spacing)
      const next = Math.floor(this.arc[i + 1]! / spacing)
      if (here !== next) this.perforated[i] = here % 2 === 0 ? 1 : -1
    }

    this.tableSize = 1 << Math.ceil(Math.log2(Math.max(16, this.count * 2)))
    this.cellOf = new Int32Array(this.count)
    this.bucketStart = new Int32Array(this.tableSize + 1)
    this.bucketItems = new Int32Array(this.count)
    this.bucketFill = new Int32Array(this.tableSize)

    this.tubeStub = this.stubFor(params.core)
    this.paid = Math.min(params.tail, this.usableLength)
    this.lastScroll = params.scroll
    this.layOut()
  }

  /**
   * Local-space y the pile builds on, after centring. A host placing a
   * shadow catcher or a contact shadow needs this; it cannot derive it,
   * because the composition is offset to sit on the origin.
   */
  get floorY(): number {
    return -this.params.floor + this.centreOffset
  }

  /**
   * How far the whole composition is lifted so that it straddles the origin.
   *
   * The roll's axis is the sim's origin, which would park a long drop
   * entirely below the frame — `<Paper>` and the editor both look at the
   * origin through about two world units, and neither fits a camera to the
   * content. `unroll` learned the same lesson and left a note about it: a
   * composition anchored anywhere but the origin needs a bespoke camera at
   * every call site.
   *
   * Measured against the FULL radius rather than the current one, so it is a
   * constant for a given config. Deriving it from the live radius would drift
   * the entire pile upward as the roll ran down.
   */
  private get centreOffset(): number {
    return (this.params.floor - this.outerRadius) / 2
  }

  /**
   * The same centring, along the axis the pile actually grows in.
   *
   * Everything here is built around the DROP LINE — the z the paper leaves
   * the roll at — and that line is not the origin and does not stay put. It
   * starts at 0 on a full roll and travels back to `core - outerRadius` as
   * the roll runs down (see {@link tangentZ}), because the spiral's centre is
   * fixed and the tangent point walks in toward it. The pile builds around
   * wherever the line has been, so a composition that ignores this is offset
   * by half that travel before a single fold has landed, and z is DEPTH —
   * the axis a fixed head-on camera has the least room in.
   *
   * A constant for a given config, for the reason {@link centreOffset} is:
   * derived from the live radius it would slide the whole composition
   * backwards as the roll emptied, which reads far worse than sitting still
   * slightly off centre. Centring the line's travel splits the difference
   * between a full roll and an empty one.
   */
  private get centreShift(): number {
    return (this.outerRadius - this.params.core) / 2
  }

  /** Outer radius of what is still wound. Shrinks to `core` as the roll empties. */
  get radius(): number {
    return rollRadius(this.totalLength - this.paid, this.params.core, layerThickness(this.params.tightness))
  }

  /** Radius of the full roll. Fixes the spiral's centre, which must not move. */
  private get outerRadius(): number {
    return rollRadius(this.totalLength, this.params.core, layerThickness(this.params.tightness))
  }

  /**
   * The wrap that never leaves: one full turn around the core, but never so
   * much of a short sheet that there is nothing left to unroll.
   *
   * A method rather than a constant because `core` is a live control. It was
   * a constructor-time `readonly`, which meant dragging `core` moved the
   * radius the spiral is drawn at while `usableLength` and the end stop kept
   * answering for the old tube — the roll would run past its own floor, or
   * stop short of it, depending on which way the slider went.
   */
  private stubFor(core: number): number {
    return Math.min(Math.PI * 2 * core, this.totalLength * 0.3)
  }

  /** Paper that can actually leave the roll — everything but the glued stub. */
  private get usableLength(): number {
    return this.totalLength - this.tubeStub
  }

  /** How much paper is left to give. `0` is down to the tube, `1` is untouched. */
  get remaining(): number {
    return 1 - this.paid / this.usableLength
  }

  /**
   * Where the paper leaves the roll: the frontmost point of the current
   * outer wrap. The spiral's CENTRE is fixed (a lesson the `roll` deformer
   * paid for — see its notes), so as the roll runs down the tangent point
   * travels back toward the holder and the strip hangs closer to it. That
   * drift is real and worth keeping.
   */
  private get tangentZ(): number {
    return this.radius - this.outerRadius
  }

  /** Place every node: the wound ones on the spiral, the free ones straight down. */
  private layOut(): void {
    const firstFree = this.firstFreeIndex()
    for (let i = 0; i < this.count; i++) {
      const p = i * 2
      if (i < firstFree) {
        this.spiralPoint(this.arc[i]! - this.paid, p, this.pos)
      } else {
        this.pos[p] = -(this.paid - this.arc[i]!)
        this.pos[p + 1] = this.tangentZ
      }
    }
    this.prev.set(this.pos)
  }

  /** First node that has come off the roll. Everything below it is kinematic. */
  private firstFreeIndex(): number {
    // arc[i] <= paid means node i has been paid out. arc decreases with i.
    const free = Math.ceil(this.count - 1 - this.paid / this.segment)
    return Math.min(this.count - 1, Math.max(0, free))
  }

  /**
   * Position of a point `wound` along the spiral from the tangent point,
   * written into `out` at offset `o`.
   *
   * Angle 0 is the tangent point at the front of the roll; winding runs up
   * over the top, which is the "over" hang. The radius falls by one layer
   * per turn, so the wraps are concentric and exactly a thickness apart.
   */
  private spiralPoint(wound: number, o: number, out: Float64Array): void {
    const r0 = this.radius
    const thickness = layerThickness(this.params.tightness)
    const k = thickness / (Math.PI * 2)
    const phi = windAngle(Math.max(0, wound), r0, k)
    const floor = Math.max(this.params.core, safeSpiralRadius(this.segment, thickness))
    const r = Math.max(floor, r0 - k * phi)
    out[o] = r * Math.sin(phi)
    out[o + 1] = -this.outerRadius + r * Math.cos(phi)
  }

  setParams(params: Partial<StripParams>): void {
    let changed = false
    const tailBefore = this.params.tail
    for (const key of [
      'scroll',
      'tightness',
      'core',
      'tail',
      'crease',
      'stiffness',
      'drag',
      'gravity',
      'floor',
      'inertia',
    ] as const) {
      const value = params[key]
      if (value !== undefined && value !== this.params[key]) {
        this.params[key] = value
        changed = true
      }
    }
    // `perforation` is structural — it sets the node count and the hinge map,
    // so it cannot be patched in place. PaperMesh rebuilds the sim on it.

    // Two params own derived state, and both are live sliders in the editor.
    // Patching `this.params` alone left that state answering for the old
    // value: `core` sizes the glued stub, and `tail` IS the paid-out length
    // on a roll nobody has scrolled yet, so without this a tail drag did
    // nothing at all and a core drag desynced the end stop from the spiral.
    if (params.core !== undefined) {
      this.tubeStub = this.stubFor(params.core)
      // A bigger stub can leave less usable paper than is already out.
      this.paid = Math.min(this.paid, this.usableLength)
    }
    if (params.tail !== undefined && tailBefore !== this.params.tail) {
      // Only while the roll is still sitting at its opening pose. Once the
      // host has scrolled, `paid` is the simulation's own state and a tail
      // edit must not yank the paper back.
      if (!this.driven) {
        this.paid = Math.min(this.params.tail, this.usableLength)
        this.layOut()
      }
    }
    if (changed) this.wake()
  }

  wake(): void {
    this.asleep = false
    this.stillFrames = 0
  }

  /**
   * Take hold of the paper at a point, in the same y–z the vertex buffer is
   * written in — mesh-local coordinates, the lift already applied. Returns the
   * node caught, or -1 when there is no free paper to catch.
   *
   * Speaking the buffer's coordinates rather than the solver's is the whole
   * contract here: a caller has a raycast hit on the mesh and nothing else,
   * and the centring lift is an internal detail it has no way to know.
   *
   * Only paper that has left the roll can be caught — a wound node belongs to
   * the spiral, and pinning one would be pinning the roll itself.
   */
  grabNearest(y: number, z: number): number {
    const firstFree = this.firstFreeIndex()
    const localY = y - this.centreOffset
    const localZ = z - this.centreShift
    let best = -1
    let bestDist = Infinity
    for (let i = firstFree; i < this.count; i++) {
      const dy = this.pos[i * 2]! - localY
      const dz = this.pos[i * 2 + 1]! - localZ
      const d = dy * dy + dz * dz
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
    this.grabbed = best
    this.grabY = localY
    this.grabZ = localZ
    this.wake()
    return best
  }

  moveGrab(y: number, z: number): void {
    if (this.grabbed < 0) return
    this.grabY = y - this.centreOffset
    this.grabZ = z - this.centreShift
    this.wake()
  }

  release(): void {
    this.grabbed = -1
  }

  /** Whether a pointer currently holds the paper. */
  get held(): boolean {
    return this.grabbed >= 0
  }

  step(delta: number): void {
    // A scroll delta must never be dropped just because the sim had gone to
    // sleep — the whole input path is "the number changed".
    if (this.params.scroll !== this.lastScroll) this.wake()
    if (this.asleep) return
    this.accumulator = Math.min(this.accumulator + delta, FIXED_DT * 4)
    while (this.accumulator >= FIXED_DT) {
      this.substep(FIXED_DT)
      this.accumulator -= FIXED_DT
    }
  }

  private substep(dt: number): void {
    this.time += dt
    this.driveRoll(dt)
    this.pullFeed(dt)
    this.integrate(dt)
    const firstFree = this.firstFreeIndex()
    this.pinWound(firstFree)
    for (let iter = 0; iter < SOLVER_ITERATIONS; iter++) {
      this.solveDistance(firstFree)
      this.solveBend(firstFree)
      if (iter >= SOLVER_ITERATIONS - COLLIDING_ITERATIONS) {
        this.solveSelfCollision(firstFree)
        this.solveFloor(firstFree)
      }
      this.pinWound(firstFree)
    }
    this.solveFloor(firstFree)
  }

  /**
   * Turn the roll. Scroll enters as an angle the roll OWES, which a leaky
   * integrator spends into angular velocity — so a steady scroll gives a
   * steady spin and a flick spikes and coasts down.
   *
   * `ΔL = R·Δθ` with the CURRENT radius, which is why the radius has to be
   * read inside the loop: a nearly-empty roll spins fast and gives up very
   * little paper for the same scroll, and that is the whole tell that a roll
   * is running out.
   */
  private driveRoll(dt: number): void {
    const scroll = this.params.scroll
    if (!this.primed) {
      // First frame: adopt the host's scroll origin rather than reading it as
      // one enormous delta and firing the whole roll off at once.
      this.lastScroll = scroll
      this.primed = true
    }
    // The host asks in world units of paper; the roll answers in radians. The
    // conversion is against the FULL radius, which is a constant — so one
    // scroll unit is about one unit of paper on a fresh roll, and less and
    // less as it empties.
    //
    // Dividing by the CURRENT radius instead is the obvious way to write this
    // and is wrong twice over: `ΔL = R·Δθ` multiplies the same radius straight
    // back, so it cancels and the roll pays out the same paper however full it
    // is — the exact tell this sim exists to show — and because the divisor
    // shrinks as the roll empties, the last of the paper leaves in a runaway
    // that slams into the end stop.
    const impulse = (scroll - this.lastScroll) / this.outerRadius
    this.lastScroll = scroll

    // The roll is a flywheel and a scroll delta is an ANGULAR IMPULSE on it,
    // not an angle the roll owes. A damped flywheel given impulse `J` turns
    // `J·tau` in total, so scaling the impulse by `1/tau` makes the paper a
    // given scroll pays out independent of how long the roll coasts —
    // `inertia` then buys the coast and nothing else, which is the only way
    // it is usable as a knob.
    //
    // Adding the impulse to a persistent `omega` WITHOUT that scaling is the
    // trap: the decay tail spends every increment ~tau/dt times over, so the
    // roll empties in a quarter-second whatever it is asked for.
    const tau = 0.012 + this.params.inertia * 0.55
    this.omega = this.omega * Math.exp(-dt / tau) + impulse / tau
    if (Math.abs(this.omega) < 1e-6) this.omega = 0

    // ΔL = R·Δθ at the CURRENT radius: a nearly-empty roll spins fast and
    // gives up very little paper, which is how a roll reads as running out.
    const next = this.paid + this.radius * this.omega * dt
    if (next !== this.paid) this.driven = true
    this.paid = Math.min(this.usableLength, Math.max(0, next))
    // Down to the tube (or fully rewound): the roll cannot keep turning.
    if (this.paid === 0 || this.paid === this.usableLength) this.omega = 0
  }

  /**
   * Take hold of the paper and pull, and the roll turns — the interaction the
   * real object is famous for.
   *
   * It is driven by TENSION rather than by mapping hand travel to an angle.
   * Paper does not stretch, so if the hand is further from the roll than there
   * is paper to reach it, the only way the constraint can be satisfied is for
   * the roll to give up more. That one rule gets the whole behaviour for free:
   * a slow pull feeds smoothly, a fast yank spins the roll and it carries on
   * after release, and pushing the paper back toward the roll does nothing at
   * all — which is exactly right, because slack does not rewind a roll. Only
   * scrolling up does.
   */
  private pullFeed(dt: number): void {
    if (this.grabbed < 0 || this.grabbed < this.firstFreeIndex()) return
    // How far the hand is from where the paper leaves the roll, against how
    // much paper there is between those two points.
    const reach = Math.hypot(this.grabY, this.grabZ - this.tangentZ)
    const available = this.paid - this.arc[this.grabbed]!
    const over = reach - available
    if (over <= 1e-6) return

    const feed = Math.min(over * PULL_STIFFNESS, this.usableLength - this.paid)
    if (feed <= 0) return
    this.paid += feed
    // Keep the flywheel in step with the hand, so letting go mid-pull leaves
    // the roll spinning at the speed it was actually being pulled at.
    this.omega = feed / (this.radius * dt)
  }

  /**
   * Verlet with ANISOTROPIC drag. A strip of paper barely notices the air
   * when it moves along its own length and is stopped almost dead when it
   * moves broadside, which is the difference between paper that floats down
   * and a rope that drops. Damping the velocity uniformly — the obvious
   * thing, and what cloth does — gets neither.
   */
  private integrate(dt: number): void {
    const { gravity, drag } = this.params
    const p = this.pos
    const dt2 = dt * dt
    const firstFree = this.firstFreeIndex()
    // Broadside drag is strong; along-length drag is nearly nothing.
    const across = Math.exp(-(0.6 + drag * 11) * dt)
    const along = Math.exp(-(0.4 + drag * 0.8) * dt)

    let travel = 0
    for (let i = firstFree; i < this.count; i++) {
      const o = i * 2
      if (i === this.grabbed) {
        // The hand owns this node. Its previous position is left alone, so
        // the chain feels the hand's velocity rather than a teleport.
        p[o] = this.grabY
        p[o + 1] = this.grabZ
        continue
      }
      const y = p[o]!
      const z = p[o + 1]!
      let vy = y - this.prev[o]!
      let vz = z - this.prev[o + 1]!

      // Segment tangent over a fixed arc span, clamped to what exists.
      const a = Math.max(firstFree, i - this.tangentNodes) * 2
      const b = Math.min(this.count - 1, i + this.tangentNodes) * 2
      let ty = p[b]! - p[a]!
      let tz = p[b + 1]! - p[a + 1]!
      const len = Math.hypot(ty, tz)
      if (len > 1e-9) {
        ty /= len
        tz /= len
        const vt = vy * ty + vz * tz
        // Normal component is whatever is left once the tangent one is out.
        const ny = vy - vt * ty
        const nz = vz - vt * tz
        vy = vt * ty * along + ny * across
        vz = vt * tz * along + nz * across
      }

      this.prev[o] = y
      this.prev[o + 1] = z
      // A vertical strip is in unstable equilibrium and will never pick a
      // side to fall toward. This is the nudge that lets it choose.
      const noise = Math.sin(this.time * 2.3 + i * 1.7) * 6e-5
      p[o] = y + vy - gravity * 3.2 * dt2
      p[o + 1] = z + vz + noise
      travel = Math.max(travel, vy * vy + vz * vz)
    }

    if (this.omega === 0 && this.grabbed < 0) {
      if (travel < SLEEP_EPSILON) {
        if (++this.stillFrames > SLEEP_FRAMES) this.asleep = true
      } else this.stillFrames = 0
    } else this.stillFrames = 0
  }

  /** Wound nodes are the roll's, not the solver's: rewrite them every pass. */
  private pinWound(firstFree: number): void {
    for (let i = 0; i < firstFree; i++) {
      this.spiralPoint(this.arc[i]! - this.paid, i * 2, this.pos)
    }
    // The first two free nodes leave along the tangent, so the strip comes
    // off the roll straight instead of kinking at the anchor.
    const tz = this.tangentZ
    for (let i = firstFree; i < Math.min(this.count, firstFree + 2); i++) {
      if (i === this.grabbed) continue
      const o = i * 2
      this.pos[o + 1] = this.pos[o + 1]! + (tz - this.pos[o + 1]!) * 0.5
    }
    if (this.grabbed >= firstFree) {
      this.pos[this.grabbed * 2] = this.grabY
      this.pos[this.grabbed * 2 + 1] = this.grabZ
    }
  }

  /** Paper does not stretch. Distance constraints run at full strength. */
  private solveDistance(firstFree: number): void {
    const p = this.pos
    const rest = this.segment
    for (let i = Math.max(0, firstFree - 1); i < this.count - 1; i++) {
      const a = i * 2
      const b = (i + 1) * 2
      const dy = p[b]! - p[a]!
      const dz = p[b + 1]! - p[a + 1]!
      const dist = Math.hypot(dy, dz)
      if (dist < 1e-9) continue
      const diff = ((dist - rest) / dist) * 0.5
      // A wound node is the roll's and a held one is the hand's; neither
      // moves, so its partner takes the whole correction.
      const aFixed = i < firstFree || i === this.grabbed
      const bFixed = i + 1 === this.grabbed
      if (aFixed && bFixed) continue
      const aw = aFixed ? 0 : bFixed ? 2 : 1
      const bw = bFixed ? 0 : aFixed ? 2 : 1
      p[a] = p[a]! + dy * diff * aw
      p[a + 1] = p[a + 1]! + dz * diff * aw
      p[b] = p[b]! - dy * diff * bw
      p[b + 1] = p[b + 1]! - dz * diff * bw
    }
  }

  /**
   * The bend constraint, and the reason this is not a rope preset.
   *
   * Every joint wants to be straight. A joint AT A PERFORATION wants it far
   * less, and may want a slight fold instead — those are the hinges the pile
   * folds at, and the alternating sign is what turns a heap into an
   * accordion. Uniform stiffness gives a coil; no stiffness gives a rope.
   */
  private solveBend(firstFree: number): void {
    const p = this.pos
    const { stiffness, crease } = this.params
    const start = Math.max(firstFree + 1, 1)
    for (let i = start; i < this.count - 1; i++) {
      const hinge = this.perforated[i]!
      // A perforation keeps a small fraction of the sheet's own stiffness.
      // Scaled by the node spacing so a panel bends the same however finely
      // the chain is cut: more joints over the same panel each do less.
      const k = (hinge !== 0 ? stiffness * 0.06 : stiffness) * 0.45 * this.bendScale
      if (k <= 0) continue
      const a = (i - 1) * 2
      const m = i * 2
      const b = (i + 1) * 2

      let ty = (p[a]! + p[b]!) * 0.5
      let tz = (p[a + 1]! + p[b + 1]!) * 0.5
      if (hinge !== 0 && crease > 0) {
        // A used roll remembers its creases: offset the rest position off the
        // chord, on the side this perforation folded to last time.
        let cy = p[b]! - p[a]!
        let cz = p[b + 1]! - p[a + 1]!
        const len = Math.hypot(cy, cz)
        if (len > 1e-9) {
          cy /= len
          cz /= len
          const bow = crease * this.segment * 0.35 * hinge
          ty += -cz * bow
          tz += cy * bow
        }
      }

      const dy = (ty - p[m]!) * k
      const dz = (tz - p[m + 1]!) * k
      if (i !== this.grabbed) {
        p[m] = p[m]! + dy
        p[m + 1] = p[m + 1]! + dz
      }
      // Push the neighbours the other way so bending cannot drag the chain.
      if (i - 1 >= firstFree && i - 1 !== this.grabbed) {
        p[a] = p[a]! - dy * 0.5
        p[a + 1] = p[a + 1]! - dz * 0.5
      }
      if (i + 1 !== this.grabbed) {
        p[b] = p[b]! - dy * 0.5
        p[b + 1] = p[b + 1]! - dz * 0.5
      }
    }
  }

  /**
   * Folds stack on each other instead of passing through. Without this the
   * pile collapses into a single flat line on the floor and there is nothing
   * to look at, which is the entire reason the preset exists.
   *
   * **Segment against segment, not node against node.** The obvious version
   * puts a sphere on every node and pushes overlapping pairs apart, and it
   * leaks: paper is thinner than the chain is finely cut — the layer gap here
   * is 0.027 against a node spacing of 0.037 — so those spheres do not touch
   * each other, and the chain is a string of beads with gaps between them
   * rather than a continuous tube. Another fold threads straight through a
   * gap, and once it is through, the point test pushes it out the far side
   * instead of back. It shows up exactly as a sheet edge buried in a surface.
   *
   * Testing the SEGMENTS closes the gaps, because a segment is the whole
   * length of paper between two nodes and not just its ends. The cost is a
   * closest-approach solve per candidate pair instead of a subtraction, which
   * is why the hash cell is sized to `segment + d`: a pair that can possibly
   * touch has its midpoints inside that, so a 3×3 neighbourhood is a complete
   * search rather than a hopeful one.
   *
   * Spatial hash over preallocated arrays, refilled by counting sort — no
   * allocation, and it does not degrade when the whole strip lands in one
   * cell, which is exactly what a pile IS.
   */
  private solveSelfCollision(firstFree: number): void {
    this.freeFrom = firstFree
    const p = this.pos
    const d = Math.max(layerThickness(this.params.tightness), 1e-4)
    const n = this.count
    const last = n - 2 // index of the final segment (i, i+1)
    if (last < firstFree + 2) return
    const cell = this.segment + d
    const inv = 1 / cell
    const table = this.tableSize
    const mask = table - 1

    const starts = this.bucketStart
    const items = this.bucketItems
    const placed = this.bucketFill
    starts.fill(0)
    placed.fill(0)

    // Hash each segment by its midpoint.
    for (let i = firstFree; i <= last; i++) {
      const my = (p[i * 2]! + p[(i + 1) * 2]!) * 0.5
      const mz = (p[i * 2 + 1]! + p[(i + 1) * 2 + 1]!) * 0.5
      const h = (((Math.floor(my * inv) * 92837111) ^ (Math.floor(mz * inv) * 689287499)) >>> 0) & mask
      this.cellOf[i] = h
      starts[h + 1]!++
    }
    for (let c = 0; c < table; c++) starts[c + 1]! += starts[c]!
    for (let i = firstFree; i <= last; i++) {
      const h = this.cellOf[i]!
      items[starts[h]! + placed[h]!++] = i
    }

    for (let i = firstFree; i <= last; i++) {
      const my = (p[i * 2]! + p[(i + 1) * 2]!) * 0.5
      const mz = (p[i * 2 + 1]! + p[(i + 1) * 2 + 1]!) * 0.5
      const cy = Math.floor(my * inv)
      const cz = Math.floor(mz * inv)
      for (let oy = -1; oy <= 1; oy++) {
        for (let oz = -1; oz <= 1; oz++) {
          const h = ((((cy + oy) * 92837111) ^ ((cz + oz) * 689287499)) >>> 0) & mask
          const end = starts[h + 1]!
          for (let e = starts[h]!; e < end; e++) {
            const j = items[e]!
            // Each pair once, and never segments that share a node or sit next
            // to one — those are held by the distance and bend constraints,
            // and separating them would only fight those.
            if (j >= i + 2) this.separate(i, j, d)
          }
        }
      }
    }
  }

  /**
   * Push segments `(i, i+1)` and `(j, j+1)` apart to `d`, if they are closer.
   *
   * Closest approach between two 2D segments, then the correction shared over
   * the four endpoints by how near each is to the touching point — so a fold
   * caught at its middle moves bodily, and one grazed at its tip barely
   * pivots. Wound and held nodes are the roll's and the hand's, so they take
   * none of it and their partner takes the lot.
   */
  private separate(i: number, j: number, d: number): void {
    const p = this.pos
    const a = i * 2
    const b = (i + 1) * 2
    const c = j * 2
    const e = (j + 1) * 2

    const uy = p[b]! - p[a]!
    const uz = p[b + 1]! - p[a + 1]!
    const vy = p[e]! - p[c]!
    const vz = p[e + 1]! - p[c + 1]!
    const wy = p[a]! - p[c]!
    const wz = p[a + 1]! - p[c + 1]!

    const uu = uy * uy + uz * uz
    const vv = vy * vy + vz * vz
    if (uu < 1e-12 || vv < 1e-12) return
    const uv = uy * vy + uz * vz
    const uw = uy * wy + uz * wz
    const vw = vy * wy + vz * wz

    const denom = uu * vv - uv * uv
    let s = denom > 1e-12 ? (uv * vw - vv * uw) / denom : 0
    s = s < 0 ? 0 : s > 1 ? 1 : s
    let t = (uv * s + vw) / vv
    if (t < 0) {
      t = 0
      s = -uw / uu
    } else if (t > 1) {
      t = 1
      s = (uv - uw) / uu
    }
    s = s < 0 ? 0 : s > 1 ? 1 : s

    let ny = p[c]! + vy * t - (p[a]! + uy * s)
    let nz = p[c + 1]! + vz * t - (p[a + 1]! + uz * s)
    let dist = Math.hypot(ny, nz)
    if (dist >= d) return
    if (dist < 1e-9) {
      // Exactly through each other: separate along this segment's own normal,
      // which is the only direction left that means anything.
      ny = -uz
      nz = uy
      dist = Math.hypot(ny, nz)
      if (dist < 1e-12) return
      ny = -ny
      nz = -nz
    }

    const push = ((d - dist) / dist) * COLLISION_RELAXATION
    const gy = ny * push
    const gz = nz * push
    // Normalized so the touching point itself moves the full correction.
    const ki = 0.5 / ((1 - s) * (1 - s) + s * s)
    const kj = 0.5 / ((1 - t) * (1 - t) + t * t)
    this.nudge(i, -gy * (1 - s) * ki, -gz * (1 - s) * ki)
    this.nudge(i + 1, -gy * s * ki, -gz * s * ki)
    this.nudge(j, gy * (1 - t) * kj, gz * (1 - t) * kj)
    this.nudge(j + 1, gy * t * kj, gz * t * kj)
  }

  /** First free node for the substep in flight — `nudge` runs in the innermost
   *  collision loop and must not recompute it per call. */
  private freeFrom = 0

  /** Move a node, unless the roll or the hand owns it. */
  private nudge(i: number, dy: number, dz: number): void {
    if (i === this.grabbed || i < this.freeFrom) return
    this.pos[i * 2] = this.pos[i * 2]! + dy
    this.pos[i * 2 + 1] = this.pos[i * 2 + 1]! + dz
  }

  /** Restitution 0, friction high. Paper lands and stays; it does not slide. */
  private solveFloor(firstFree: number): void {
    const p = this.pos
    // Sim-space: the floor is `floor` below the roll's axis. The centring
    // offset is applied on the way OUT, in writeInto, so the solver never has
    // to carry it.
    const floor = -this.params.floor
    for (let i = firstFree; i < this.count; i++) {
      const o = i * 2
      // A hand may hold paper anywhere, including below the ground line.
      if (i === this.grabbed || p[o]! >= floor) continue
      p[o] = floor
      // Kill the bounce outright, and almost all of the slide with it.
      this.prev[o] = floor
      this.prev[o + 1] = this.prev[o + 1]! + (p[o + 1]! - this.prev[o + 1]!) * 0.92
    }
  }

  /**
   * Write the chain into a 2×N quad strip, in PlaneGeometry vertex order:
   * row-major, top row first, x left→right. Row `i` is node `i`, so the
   * content texture runs down the strip and folds with it.
   */
  writeInto(out: Float32Array): void {
    const lift = this.centreOffset
    const shift = this.centreShift
    for (let i = 0; i < this.count; i++) {
      const o = i * 2
      const y = this.pos[o]! + lift
      const z = this.pos[o + 1]! + shift
      const v = i * 6
      out[v] = -this.halfWidth
      out[v + 1] = y
      out[v + 2] = z
      out[v + 3] = this.halfWidth
      out[v + 4] = y
      out[v + 5] = z
    }
  }
}
