import type * as THREE from 'three'
import type { z } from 'zod'

export interface SheetDims {
  width: number
  height: number
}

export interface DeformerContext {
  /** Seconds since the paper mounted. */
  t: number
  sheet: SheetDims
}

/**
 * A deformer is a pure vertex-mapping function. The JS implementation is the
 * CPU path (hero mode) and must be allocation-free in the loop: it mutates
 * `out` in place. The mirrored GLSL implementation (GPU path, field mode)
 * lands in M4 — golden-vector parity tests will enforce identical results.
 */
export interface Deformer<O = Record<string, unknown>> {
  id: string
  label: string
  defaults: O
  optionsSchema: z.ZodType<O, z.ZodTypeDef, unknown>
  /** Mutate `out` (sheet-local space; flat sheet is the XY plane facing +Z). */
  displace(out: THREE.Vector3, uv: THREE.Vector2, o: O, ctx: DeformerContext): void
  /** GPU path — arrives with field mode (M4). */
  glsl?: { chunk: string; uniforms(o: O): Record<string, unknown> }
  geometry?: { minSegments?: number }
}

/** One entry of a paper's deformer stack, as stored in a preset. */
export interface DeformerInstance<O = Record<string, unknown>> {
  type: string
  options: O
  enabled?: boolean
}
