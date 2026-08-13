import * as THREE from 'three'
import type { DeformerContext, DeformerInstance, SheetDims } from './types'
import { getDeformer } from './registry'

// Preallocated scratch — deformer loops are allocation-free.
const scratchPos = new THREE.Vector3()
const scratchUv = new THREE.Vector2()

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
  const active = stack.filter((i) => i.enabled !== false)

  for (let v = 0; v < position.count; v++) {
    const i3 = v * 3
    scratchPos.set(basePositions[i3]!, basePositions[i3 + 1]!, basePositions[i3 + 2]!)
    scratchUv.set(uv.getX(v), uv.getY(v))
    for (const instance of active) {
      getDeformer(instance.type).displace(scratchPos, scratchUv, instance.options, ctx)
    }
    array[i3] = scratchPos.x
    array[i3 + 1] = scratchPos.y
    array[i3 + 2] = scratchPos.z
  }

  position.needsUpdate = true
  geometry.computeVertexNormals()
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

/** The densest grid any deformer in the stack REQUIRES to work at all. */
export function stackMinSegments(stack: DeformerInstance[]): number {
  let min = 2
  for (const instance of stack) {
    const req = getDeformer(instance.type).geometry?.minSegments ?? 2
    if (req > min) min = req
  }
  return min
}

/**
 * The densest grid any deformer in the stack WANTS, given the options it is
 * actually carrying — what `segments: 'auto'` resolves to.
 *
 * Disabled instances are skipped, exactly as `applyDeformerStack` skips them:
 * a deformer that is not displacing anything has no opinion about the grid.
 * (`stackMinSegments` does not skip them, and that difference is deliberate —
 * a floor is about what the stack could do, a target about what it is doing.)
 *
 * A deformer with no `autoSegments` falls back to its floor, which is the
 * right answer for one whose cost does not move with its options.
 */
export function stackAutoSegments(stack: DeformerInstance[], sheet: SheetDims): number {
  let want = 0
  for (const instance of stack) {
    if (instance.enabled === false) continue
    const deformer = getDeformer(instance.type)
    const geometry = deformer.geometry
    if (!geometry) continue
    const req = geometry.autoSegments
      ? geometry.autoSegments(instance.options, sheet)
      : (geometry.minSegments ?? 0)
    if (req > want) want = req
  }
  return want
}
