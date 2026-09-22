import * as THREE from 'three'
import type { LiftOptions } from '../deformers/lift'
import { displacePoint } from '../deformers/compose'
import type { DeformerContext, DeformerInstance, SheetDims } from '../deformers/types'
import { sampleWrap, shellPoint, type Wrap } from './wrap'

/** How far the sticker sits off the surface — enough never to fight it for a pixel. */
export const STICKER_GAP = 0.0025
/** The skin it leaves, a hair above the skin it is drawn over. */
const REVEAL_GAP = 0.0006
/** Height above the surface at which a point counts as no longer stuck. */
const LIFTED = 0.012

/** Glue strands: columns along the front, rows of them into the gap. */
const STRAND_COLUMNS = 96
const STRAND_LAYERS = 3

const scratchP = new THREE.Vector3()
const scratchN = new THREE.Vector3()
const scratchQ = new THREE.Vector3()
const scratchT = new THREE.Vector3()
/** How far a freed sheet travels on the wind before it is gone, in world units. */
const FLY_DISTANCE = 2.8
/** How high it rises on the way. */
const FLY_RISE = 1.1
/** How far it first springs off the surface, along the normal, before the wind has it. */
const FLY_CLEAR = 0.18

const flyC = new THREE.Vector3()
const flyA = new THREE.Vector3()
const flyB = new THREE.Vector3()
const flyN = new THREE.Vector3()
const flyT = new THREE.Vector3()
const flyS = new THREE.Vector3()
const flyUp = new THREE.Vector3()
const flySide = new THREE.Vector3()
const flyD = new THREE.Vector3()
const flyAxis = new THREE.Vector3()
const hostQ = new THREE.Quaternion()
const hostQInv = new THREE.Quaternion()
const flyQ = new THREE.Quaternion()
const spinQ = new THREE.Quaternion()
const flutterQ = new THREE.Quaternion()
const scratchA = new Float32Array(3)
const scratchB = new Float32Array(3)

/**
 * Everything a mounted sheet needs besides itself: the lay-up, and the two
 * things that exist only because the sheet is stuck to something.
 *
 * - The REVEAL — the patch of skin the sheet has come off, drawn cleaner and
 *   glossier than the skin round it, so a viewer sees proof it was stuck. It
 *   is laid up once, and the frame only moves the line where the sheet has
 *   lifted.
 * - The GLUE — strands of adhesive stretched across the gap at the peel
 *   front while the glue is under tension. Each strand joins a point of the
 *   sheet to the place on the skin that point was stuck to, which is the
 *   only honest thing a glue strand can be.
 *
 * Plain objects, not components: the frame loop that moves the sheet moves
 * these in the same pass, from the same stack, so they cannot be a frame
 * apart from it.
 */
export class MountRig {
  readonly reveal: THREE.BufferGeometry
  readonly strands: THREE.BufferGeometry
  readonly revealUniforms = {
    uDir: { value: new THREE.Vector2(1, 0) },
    uFront: { value: -1e6 },
    uRelease: { value: 0 },
    uSheet: { value: new THREE.Vector2(1, 1) },
  }
  readonly strandUniforms = {
    uTension: { value: 0 },
  }
  /** This frame's peel, if the stack has one — read by `shell` for the hinge. */
  private lift: LiftOptions | null = null
  private dirX = 1
  private dirY = 0
  private front = -1e6

  constructor(
    readonly wrap: Wrap,
    readonly sheet: SheetDims,
  ) {
    this.revealUniforms.uSheet.value.set(sheet.width, sheet.height)

    const reveal = new THREE.PlaneGeometry(sheet.width, sheet.height, 64, 64)
    const pos = reveal.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      scratchQ.set(pos.getX(i), pos.getY(i), 0)
      shellPoint(wrap, scratchQ, REVEAL_GAP)
      pos.setXYZ(i, scratchQ.x, scratchQ.y, scratchQ.z)
    }
    reveal.computeVertexNormals()
    this.reveal = reveal

    const count = STRAND_COLUMNS * STRAND_LAYERS * 2
    const strands = new THREE.BufferGeometry()
    strands.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    strands.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    strands.setAttribute('aStickerUv', new THREE.BufferAttribute(new Float32Array(count * 2), 2))
    // x: position along the front, 0..1; y: 0 at the skin, 1 at the sheet; z: layer.
    const strand = new Float32Array(count * 3)
    const index: number[] = []
    for (let k = 0; k < STRAND_LAYERS; k++) {
      for (let c = 0; c < STRAND_COLUMNS; c++) {
        const v = (k * STRAND_COLUMNS + c) * 2
        strand.set([c / (STRAND_COLUMNS - 1), 0, k], v * 3)
        strand.set([c / (STRAND_COLUMNS - 1), 1, k], (v + 1) * 3)
        if (c < STRAND_COLUMNS - 1) index.push(v, v + 2, v + 1, v + 1, v + 2, v + 3)
      }
    }
    strands.setAttribute('aStrand', new THREE.BufferAttribute(strand, 3))
    strands.setIndex(index)
    this.strands = strands
  }

  /**
   * Carry the sheet's flat positions onto the surface, in place, and record
   * how stuck each vertex is — the `aAttach` the press shading reads.
   *
   * Stuck paper is shell-mapped: its height goes along the normal where it
   * lies, so it hugs every curve. Paper a peel has LIFTED is not, and the
   * difference is the whole look of a peel on a curved object. Shell-mapped,
   * a flap held up off a lemon would bend round the fruit at height —
   * inflating as it went, like a balloon of sticker — when a sheet of vinyl
   * pulled off a curve goes straight. So a lifted point is placed RIGIDLY,
   * in the surface frame at the point of the peel front it left the surface
   * from: the bend and the flap keep exactly the shape the peel gave them,
   * swung to the angle the skin has at that front. A curve the flap no longer
   * touches is a curve it no longer follows.
   *
   * `base` is the flat rest pose, which is what says where each point was
   * stuck and therefore which point of the front it hinges from.
   */
  shell(
    positions: Float32Array,
    base: Float32Array,
    attach: Float32Array | null,
    count: number,
    gap = STICKER_GAP,
  ): void {
    const lift = this.lift
    for (let v = 0; v < count; v++) {
      const i3 = v * 3
      const z = positions[i3 + 2]!
      if (attach) {
        const t = Math.min(1, Math.max(0, z / LIFTED))
        attach[v] = 1 - t * t * (3 - 2 * t)
      }
      if (lift) {
        const e = base[i3]! * this.dirX + base[i3 + 1]! * this.dirY
        const s = this.front - e
        if (s > 0 || lift.release > 0) {
          this.hinge(base[i3]! + this.dirX * s, base[i3 + 1]! + this.dirY * s, positions, i3, gap)
          continue
        }
      }
      sampleWrap(this.wrap, positions[i3]!, positions[i3 + 1]!, scratchP, scratchN)
      const h = z + gap
      positions[i3] = scratchP.x + scratchN.x * h
      positions[i3 + 1] = scratchP.y + scratchN.y * h
      positions[i3 + 2] = scratchP.z + scratchN.z * h
    }
  }

  /**
   * Place a lifted point rigidly in the surface frame at the hinge `(hx, hy)`
   * — a point on the peel front, in flat space. The point's offset from the
   * hinge in the flat solution becomes the same offset along the surface's
   * own direction of peel there, and its height becomes height along the
   * normal there.
   */
  private hinge(hx: number, hy: number, out: Float32Array, i3: number, gap: number): void {
    const wrap = this.wrap
    sampleWrap(wrap, hx, hy, scratchP, scratchN)
    // The peel direction as it runs on the surface at the hinge.
    const step = 0.01
    sampleWrap(wrap, hx + this.dirX * step, hy + this.dirY * step, scratchQ, scratchT)
    let tx = scratchQ.x - scratchP.x
    let ty = scratchQ.y - scratchP.y
    let tz = scratchQ.z - scratchP.z
    const dn = tx * scratchN.x + ty * scratchN.y + tz * scratchN.z
    tx -= scratchN.x * dn
    ty -= scratchN.y * dn
    tz -= scratchN.z * dn
    const tl = Math.hypot(tx, ty, tz) || 1
    tx /= tl
    ty /= tl
    tz /= tl
    // Along the peel in the flat solution, and above the surface.
    const along = (out[i3]! - hx) * this.dirX + (out[i3 + 1]! - hy) * this.dirY
    const h = out[i3 + 2]! + gap
    out[i3] = scratchP.x + tx * along + scratchN.x * h
    out[i3 + 1] = scratchP.y + ty * along + scratchN.y * h
    out[i3 + 2] = scratchP.z + tz * along + scratchN.z * h
  }

  /** One lifted-or-stuck point through the same mapping as the mesh — handles, strands. */
  place(bx: number, by: number, point: THREE.Vector3): void {
    scratchA[0] = point.x
    scratchA[1] = point.y
    scratchA[2] = point.z
    scratchB[0] = bx
    scratchB[1] = by
    scratchB[2] = 0
    this.shell(scratchA, scratchB, null, 1)
    point.set(scratchA[0]!, scratchA[1]!, scratchA[2]!)
  }

  /** Move the reveal line and the glue to where this frame's peel has them. */
  update(stack: DeformerInstance[] | null, ctx: DeformerContext): void {
    const lift = findLift(stack)
    this.lift = lift
    const reveal = this.revealUniforms
    const strands = this.strandUniforms
    if (!lift) {
      // A behavior that is not a peel still lifts paper; count anything well
      // off the surface as gone and leave the rest stuck. Without a lift to
      // read, the line cannot be placed, so the patch stays hidden.
      reveal.uFront.value = -1e6
      reveal.uRelease.value = 0
      strands.uTension.value = 0
      return
    }
    const a = (lift.angle * Math.PI) / 180
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    const half = (Math.abs(dx) * this.sheet.width + Math.abs(dy) * this.sheet.height) / 2
    const f = -half + lift.front * 2 * half
    this.dirX = dx
    this.dirY = dy
    this.front = f
    reveal.uDir.value.set(dx, dy)
    reveal.uFront.value = f
    reveal.uRelease.value = lift.release

    const tension = lift.front > 0 && lift.release <= 0 ? lift.tension : 0
    strands.uTension.value = tension
    if (tension < 0.02) return

    // The front, as a line across the sheet; the strands hang off it.
    const px = -dy
    const py = dx
    const span = (Math.abs(px) * this.sheet.width + Math.abs(py) * this.sheet.height) / 2
    const r = lift.radius * (1 - 0.35 * tension)
    const pos = this.strands.attributes.position as THREE.BufferAttribute
    const nrm = this.strands.attributes.normal as THREE.BufferAttribute
    const uv = this.strands.attributes.aStickerUv as THREE.BufferAttribute
    const P = pos.array as Float32Array
    const N = nrm.array as Float32Array
    const U = uv.array as Float32Array
    for (let k = 0; k < STRAND_LAYERS; k++) {
      // Deeper into the gap for each layer: the ones nearest the front are
      // short and many, the ones further back long and about to snap.
      const sigma = r * (0.3 + 0.45 * k)
      for (let c = 0; c < STRAND_COLUMNS; c++) {
        const t = -span + (2 * span * c) / (STRAND_COLUMNS - 1)
        const x = dx * (f - sigma) + px * t
        const y = dy * (f - sigma) + py * t
        const u = x / this.sheet.width + 0.5
        const w = y / this.sheet.height + 0.5
        const v = (k * STRAND_COLUMNS + c) * 2
        // The skin, where this point of the sheet was stuck.
        sampleWrap(this.wrap, x, y, scratchP, scratchN)
        put3(P, v * 3, scratchP)
        put3(N, v * 3, scratchN)
        // The sheet, where that point is now.
        scratchQ.set(x, y, 0)
        displacePoint(scratchQ, u, w, stack!, ctx)
        this.place(x, y, scratchQ)
        put3(P, (v + 1) * 3, scratchQ)
        put3(N, (v + 1) * 3, scratchN)
        U[v * 2] = u
        U[v * 2 + 1] = w
        U[v * 2 + 2] = u
        U[v * 2 + 3] = w
      }
    }
    pos.needsUpdate = true
    nrm.needsUpdate = true
    uv.needsUpdate = true
    this.strands.computeBoundingSphere()
  }

  /**
   * Carry a freed sheet away on the air, in place: `f` is how far through
   * the flight it is, 0 to 1. At 1 it is out of the shot, and the caller
   * stops drawing it.
   *
   * It springs off the surface along its own normal first, so it clears the
   * object it was stuck to, then the air takes it: out to one side, rising,
   * fluttering about the way it travels and turning over as it goes. The side
   * is the one the sticker was already on, so a sticker on the left of the
   * object leaves to the left and never flies back through it. One dead
   * centre takes its side from `seed`.
   *
   * Rigid, because a sticker off a lemon keeps the lemon's curve, and in the
   * WORLD, because the air does not care how the object leans. A pure
   * function of `f` like everything else a behavior drives: scrub back and
   * it flies back and sticks down.
   */
  fly(
    positions: Float32Array,
    count: number,
    columns: number,
    f: number,
    host: THREE.Matrix4,
    seed: number,
  ): void {
    if (f <= 0 || count < 3) return
    // Where it is and which way it faces as it lets go.
    flyC.set(0, 0, 0)
    for (let v = 0; v < count; v++) {
      flyC.x += positions[v * 3]!
      flyC.y += positions[v * 3 + 1]!
      flyC.z += positions[v * 3 + 2]!
    }
    flyC.multiplyScalar(1 / count)
    const last = count - 1
    flyA.fromArray(positions, (columns - 1) * 3).sub(flyB.fromArray(positions, 0))
    flyB.fromArray(positions, (last - columns + 1) * 3).sub(flyN.fromArray(positions, 0))
    // The grid runs +x along a row and -y down the columns, so this is the
    // BACK's normal; the face points the other way.
    flyN.crossVectors(flyA, flyB).normalize().negate()

    host.decompose(flyT, hostQ, flyS)
    hostQInv.copy(hostQ).invert()
    flyUp.set(0, 1, 0).applyQuaternion(hostQInv)
    // Which side of the object it is on, as the camera sees it.
    const worldX = flyA.copy(flyC).applyMatrix4(host).x - flyT.x
    const side = Math.abs(worldX) > 0.02 ? Math.sign(worldX) : seed % 2 === 0 ? 1 : -1
    flySide.set(side, 0, 0).applyQuaternion(hostQInv)

    // Off the surface fast, then the wind: slow to take it, then carrying it.
    const clear = 1 - (1 - Math.min(1, f * 3)) ** 3
    // Slow enough that the first half of it is still in the shot.
    const carry = f * f
    const gust = (seed % 3) * 0.15
    // A little back toward the camera as it clears, so it does not sweep
    // across the object's face on its way out.
    const out = Math.max(0, flyN.dot(flyA.set(0, 0, 1).applyQuaternion(hostQInv)))
    flyD
      .copy(flyN)
      .multiplyScalar(FLY_CLEAR * clear * (0.6 + 0.4 * out))
      .addScaledVector(flySide, FLY_DISTANCE * carry)
      .addScaledVector(
        flyUp,
        FLY_RISE * (1 + gust) * (f * 0.7 + carry * 0.3) + Math.sin(f * Math.PI * 4) * 0.05 * (1 - f),
      )

    // Flutter about the way it travels, dying down as it gets going, and
    // turn over about a tilted axis, faster the further it has gone.
    flyAxis.copy(flySide).addScaledVector(flyUp, 0.3).normalize()
    flutterQ.setFromAxisAngle(flyAxis, Math.sin(f * Math.PI * 5 + seed) * 0.6 * Math.min(1, f * 4))
    flyAxis.copy(flyUp).addScaledVector(flySide, 0.5).normalize()
    spinQ.setFromAxisAngle(flyAxis, side * (1.2 + (seed % 4) * 0.25) * Math.PI * carry)
    flyQ.copy(spinQ).multiply(flutterQ)

    for (let v = 0; v < count; v++) {
      const i3 = v * 3
      flyA.fromArray(positions, i3).sub(flyC).applyQuaternion(flyQ).add(flyC).add(flyD)
      positions[i3] = flyA.x
      positions[i3 + 1] = flyA.y
      positions[i3 + 2] = flyA.z
    }
  }

  dispose(): void {
    this.reveal.dispose()
    this.strands.dispose()
  }
}

function put3(out: Float32Array, at: number, v: THREE.Vector3): void {
  out[at] = v.x
  out[at + 1] = v.y
  out[at + 2] = v.z
}

function findLift(stack: DeformerInstance[] | null): LiftOptions | null {
  if (!stack) return null
  for (const instance of stack) {
    if (instance.type === 'lift' && instance.enabled !== false)
      return instance.options as unknown as LiftOptions
  }
  return null
}
