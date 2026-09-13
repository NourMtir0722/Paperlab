import type { DamageField } from './field'
import type { SurfaceLocator } from './fire'
import { flameAnchors, flamePuff, type FlameAnchor } from './flames'

/**
 * How many flames the summary is taken over: the 32 `FxFireLight` was tuned
 * with, so the light it gives off is the light it always gave off.
 */
const FLAMES = 32

/** The most places the fire is gathered in at once — one light each, later. */
export const FIRE_CLUSTERS = 4

/**
 * How near a flame has to stand to a cluster's tallest to be part of it,
 * world units: 25 mm of A4. About the spread of one of `flameAnchors`'
 * clusters of tongues, and well under the gap between two of them.
 */
const CLUSTER_REACH = 25 / 210

/** One place the fire is gathered: a knot of tongues on the rim. */
export interface FireCluster {
  /** Where it burns, weighted toward its taller tongues. World space. */
  x: number
  y: number
  z: number
  /** Its tongues' mean height, world units. */
  height: number
  /** Its tallest tongue. */
  tallest: number
  /** How far its tongues have puffed up right now — `flamePuff`, averaged. */
  flicker: number
  /** How many tongues it holds. */
  count: number
}

/**
 * The fire, measured once a frame, for everything that answers it.
 *
 * The light, the haze, the grade, the camera and the sound all ask the same
 * question of a burn — where is it, how big, how is it flickering — and each
 * used to ask `flameAnchors` for itself. That is a scan of the whole field
 * per asker per frame, and six askers would each be a little differently
 * wrong about the same fire. So they share this: {@link fireStateOf} hands
 * every one of them the same summary, worked out the first time any of them
 * asks in a frame.
 *
 * "The first time in a frame" is the one thing to know. Everything that reads
 * it in one frame sees the fire as it stood when the first of them asked, so
 * a reader that runs before the burn has stepped sees last step's fire, and
 * so does every reader after it. They agree with each other, which is the
 * point; a frame is 16 ms, and none of them can see the difference.
 */
export class FireState {
  /** The flames it was taken over. Only the first {@link count} are current. */
  readonly anchors: FlameAnchor[] = []
  count = 0
  /** Where the fire is, as a whole: its flames' mean. Zero with none. */
  x = 0
  y = 0
  z = 0
  /** Its flames' mean height. */
  height = 0
  /** Its flames' mean puff. */
  flicker = 0
  /** Where it is gathered. Only the first {@link clusterCount} are current. */
  readonly clusters: FireCluster[] = []
  clusterCount = 0

  private frame = Number.NaN
  private readonly order: number[] = []
  private readonly root = new Float64Array(FIRE_CLUSTERS * 3)
  private readonly weight = new Float64Array(FIRE_CLUSTERS)

  constructor(
    readonly field: DamageField,
    readonly locate: SurfaceLocator,
  ) {}

  /**
   * Bring it up to date for `frame` — any number that is the same for every
   * reader in one frame and different in the next; R3F's `clock.elapsedTime`
   * is the one in hand. Free the second time it is asked in a frame.
   */
  update(frame: number): this {
    if (frame === this.frame) return this
    this.frame = frame
    const { field, anchors } = this
    const n = flameAnchors(field, this.locate, FLAMES, anchors)
    this.count = n
    let x = 0
    let y = 0
    let z = 0
    let h = 0
    let flicker = 0
    for (let i = 0; i < n; i++) {
      const f = anchors[i]!
      x += f.x
      y += f.y
      z += f.z
      h += f.height
      flicker += flamePuff(f.seed, field.time)
    }
    if (n > 0) {
      x /= n
      y /= n
      z /= n
      h /= n
      flicker /= n
    }
    this.x = x
    this.y = y
    this.z = z
    this.height = h
    this.flicker = flicker
    this.gather()
    return this
  }

  /**
   * Group the flames into at most {@link FIRE_CLUSTERS} clusters.
   *
   * Tallest first, so each cluster is named by its tallest tongue and stands
   * where that one stands: a flame joins the nearest cluster within
   * {@link CLUSTER_REACH} of it, or starts one while there is room, or joins
   * the nearest once there is not. Pure arithmetic over the flames, so the
   * same burn gathers the same way every time.
   */
  private gather(): void {
    const anchors = this.anchors
    const clusters = this.clusters
    const order = this.order
    const root = this.root
    const weight = this.weight
    const n = this.count
    order.length = 0
    for (let i = 0; i < n; i++) order.push(i)
    order.sort((i, j) => anchors[j]!.height - anchors[i]!.height || i - j)
    let k = 0
    for (const i of order) {
      const f = anchors[i]!
      let best = -1
      let near = Number.POSITIVE_INFINITY
      for (let c = 0; c < k; c++) {
        const d = Math.hypot(f.x - root[c * 3]!, f.y - root[c * 3 + 1]!, f.z - root[c * 3 + 2]!)
        if (d < near) {
          near = d
          best = c
        }
      }
      if (best < 0 || (near > CLUSTER_REACH && k < FIRE_CLUSTERS)) {
        best = k++
        root[best * 3] = f.x
        root[best * 3 + 1] = f.y
        root[best * 3 + 2] = f.z
        weight[best] = 0
        let cluster = clusters[best]
        if (!cluster) {
          cluster = { x: 0, y: 0, z: 0, height: 0, tallest: 0, flicker: 0, count: 0 }
          clusters[best] = cluster
        }
        cluster.x = 0
        cluster.y = 0
        cluster.z = 0
        cluster.height = 0
        cluster.tallest = f.height
        cluster.flicker = 0
        cluster.count = 0
      }
      const cluster = clusters[best]!
      const w = f.height
      cluster.x += f.x * w
      cluster.y += f.y * w
      cluster.z += f.z * w
      weight[best] = weight[best]! + w
      cluster.height += f.height
      cluster.flicker += flamePuff(f.seed, this.field.time)
      cluster.count++
    }
    for (let c = 0; c < k; c++) {
      const cluster = clusters[c]!
      const w = weight[c]!
      if (w > 0) {
        cluster.x /= w
        cluster.y /= w
        cluster.z /= w
      } else {
        cluster.x = root[c * 3]!
        cluster.y = root[c * 3 + 1]!
        cluster.z = root[c * 3 + 2]!
      }
      cluster.height /= cluster.count
      cluster.flicker /= cluster.count
    }
    this.clusterCount = k
  }
}

const shared = new WeakMap<DamageField, WeakMap<SurfaceLocator, FireState>>()

/**
 * The one {@link FireState} for this field seen through this locator — the
 * same object for every reader that asks with the same pair, which is what
 * lets them share a frame's work.
 */
export function fireStateOf(field: DamageField, locate: SurfaceLocator): FireState {
  let byLocator = shared.get(field)
  if (!byLocator) {
    byLocator = new WeakMap()
    shared.set(field, byLocator)
  }
  let state = byLocator.get(locate)
  if (!state) {
    state = new FireState(field, locate)
    byLocator.set(locate, state)
  }
  return state
}
