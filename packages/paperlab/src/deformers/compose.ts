import * as THREE from 'three'
import { computeSheetNormals } from '../core/normals'
import { axialSegments, type SegmentPair } from '../core/tessellation'
import type { AnyOptions, Deformer, DeformerContext, DeformerInstance, SheetDims } from './types'
import { getDeformer } from './registry'

// Preallocated scratch — deformer loops are allocation-free.
const scratchPos = new THREE.Vector3()
const scratchUv = new THREE.Vector2()

/**
 * The resolved stack, reused across frames: two parallel arrays rather than a
 * list of objects, refilled in place. `applyDeformerStack` runs every frame
 * for any animated sheet, and a `filter()` plus a registry lookup per vertex
 * is a per-frame allocation and 16k map probes for an answer that only
 * changes when the stack does.
 */
const activeFns: ((out: THREE.Vector3, uv: THREE.Vector2, o: AnyOptions, ctx: DeformerContext) => void)[] = []
const activeOptions: AnyOptions[] = []

/**
 * Run an ordered deformer stack over a sheet geometry: each vertex starts
 * from its flat base position and flows through every enabled deformer in
 * order. Writes positions in place and recomputes normals.
 */
export function applyDeformerStack(
  geometry: THREE.BufferGeometry,
  basePositions: Float32Array,
  stack: DeformerInstance[],
  ctx: DeformerContext,
): void {
  const position = geometry.attributes.position as THREE.BufferAttribute
  const uv = geometry.attributes.uv as THREE.BufferAttribute
  const array = position.array as Float32Array
  const uvArray = uv.array as Float32Array
  const count = position.count

  activeFns.length = 0
  activeOptions.length = 0
  for (const instance of stack) {
    if (instance.enabled === false) continue
    activeFns.push(getDeformer(instance.type).displace)
    activeOptions.push(instance.options)
  }

  // One deformer over every vertex, then the next — rather than every
  // deformer over one vertex, then the next. A deformer only ever reads and
  // writes the vertex it was handed, so sweeping the sheet per deformer is
  // the same composition in a different order, and it puts ONE function
  // behind the inner call site instead of the whole stack. It also costs an
  // extra pass over the position array per deformer, which is sequential and
  // measures as nothing beside what the call site buys.
  array.set(basePositions)
  for (let k = 0; k < activeFns.length; k++) {
    const displace = activeFns[k]!
    const options = activeOptions[k]
    for (let v = 0; v < count; v++) {
      const i3 = v * 3
      const i2 = v * 2
      scratchPos.set(array[i3]!, array[i3 + 1]!, array[i3 + 2]!)
      scratchUv.set(uvArray[i2]!, uvArray[i2 + 1]!)
      displace(scratchPos, scratchUv, options, ctx)
      array[i3] = scratchPos.x
      array[i3 + 1] = scratchPos.y
      array[i3 + 2] = scratchPos.z
    }
  }

  position.needsUpdate = true
  computeSheetNormals(geometry)
}

/** A single point through the stack — used for handle anchors and tests. */
export function displacePoint(
  point: THREE.Vector3,
  uvX: number,
  uvY: number,
  stack: DeformerInstance[],
  ctx: DeformerContext,
): THREE.Vector3 {
  scratchUv.set(uvX, uvY)
  for (const instance of stack) {
    if (instance.enabled === false) continue
    getDeformer(instance.type).displace(point, scratchUv, instance.options, ctx)
  }
  return point
}

/**
 * The densest grid any deformer in the stack REQUIRES to work at all, per
 * axis — the componentwise max of every entry's floor projected onto the
 * sheet's own X and Y by the direction that entry curves in.
 */
export function stackMinSegments(stack: DeformerInstance[], sheet: SheetDims): SegmentPair {
  const out: SegmentPair = [2, 2]
  for (const instance of stack) {
    const deformer = getDeformer(instance.type)
    const floor = deformer.geometry?.minSegments
    if (!floor) continue
    take(out, deformer, instance.options, sheet, floor)
  }
  return out
}

/**
 * The densest grid any deformer in the stack WANTS, given the options it is
 * actually carrying — what `segments: 'auto'` resolves to, per axis.
 *
 * Disabled instances are skipped, exactly as `applyDeformerStack` skips them:
 * a deformer that is not displacing anything has no opinion about the grid.
 * (`stackMinSegments` does not skip them, and that difference is deliberate —
 * a floor is about what the stack could do, a target about what it is doing.)
 *
 * A deformer with no `autoSegments` falls back to its floor, which is the
 * right answer for one whose cost does not move with its options.
 */
export function stackAutoSegments(stack: DeformerInstance[], sheet: SheetDims): SegmentPair {
  const out: SegmentPair = [0, 0]
  for (const instance of stack) {
    if (instance.enabled === false) continue
    const deformer = getDeformer(instance.type)
    const geometry = deformer.geometry
    if (!geometry) continue
    const want = geometry.autoSegments
      ? geometry.autoSegments(instance.options, sheet)
      : (geometry.minSegments ?? 0)
    take(out, deformer, instance.options, sheet, want)
  }
  return out
}

/** Project one demand onto the two axes and keep it if it raises either. */
function take(
  out: SegmentPair,
  deformer: Deformer<AnyOptions>,
  options: AnyOptions,
  sheet: SheetDims,
  demand: number,
): void {
  // A community deformer whose `axis` cannot answer for these options — or
  // one that has none — falls back to spreading the demand over both axes,
  // which is the conservative half of the choice: it over-subdivides rather
  // than under-subdividing something that is actually bending.
  const declared = deformer.geometry?.axis?.(options, sheet)
  const angle = typeof declared === 'number' && Number.isFinite(declared) ? declared : null
  const [x, y] = axialSegments(sheet, angle, demand)
  if (x > out[0]) out[0] = x
  if (y > out[1]) out[1] = y
}
