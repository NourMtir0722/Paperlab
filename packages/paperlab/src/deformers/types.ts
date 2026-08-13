import type * as THREE from 'three'
import type { z } from 'zod'

export interface SheetDims {
  width: number
  height: number
}

/**
 * The options type of a registry entry whose concrete shape is unknowable at
 * the storage site. The registries are heterogeneous — every behavior,
 * deformer and layout declares its own options — and this is the only top type
 * that admits all of them. `unknown` collapses `keyof O & string` (a
 * behavior's `progressParam`) to `never`, and `Record<string, unknown>` is
 * rejected in both directions: an entry's own `stack`/`pose` demands its own
 * keys, and an interface-declared options type has no implicit index
 * signature. Narrowing this would close the registries to the community
 * extensions they exist for.
 */
// biome-ignore lint/suspicious/noExplicitAny: the registries are heterogeneous — see above.
export type AnyOptions = any

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
  glsl?: {
    chunk: string
    uniforms(o: O): Record<string, unknown>
    /**
     * The option whose uniform scales with a field instance's per-sheet
     * `bias` (0 = flat, 1 = exactly as configured), letting one instanced
     * draw call bend every sheet differently. Deformers whose strength has
     * no linear form omit this and ignore bias — `roll` is arc-length-exact,
     * so a "half roll" is a shorter roll, not a scaled one.
     */
    strength?: keyof O & string
  }
  geometry?: { minSegments?: number }
  /** Time-driven: stacks containing this deformer re-deform every frame. */
  animated?: boolean
}

/** One entry of a paper's deformer stack, as stored in a preset. */
export interface DeformerInstance<O = Record<string, unknown>> {
  type: string
  options: O
  enabled?: boolean
}
