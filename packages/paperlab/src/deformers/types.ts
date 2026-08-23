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
 * lands with field mode — golden-vector parity tests will enforce identical results.
 */
export interface Deformer<O = Record<string, unknown>> {
  id: string
  label: string
  defaults: O
  optionsSchema: z.ZodType<O, z.ZodTypeDef, unknown>
  /** Mutate `out` (sheet-local space; flat sheet is the XY plane facing +Z). */
  displace(out: THREE.Vector3, uv: THREE.Vector2, o: O, ctx: DeformerContext): void
  /** GPU path — arrives with field mode. */
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
  geometry?: {
    /**
     * Correctness floor: the density below which this deformer stops working,
     * whatever the options. Never lowered by anything.
     *
     * Counted along `axis`, exactly as `autoSegments` is — a floor is a claim
     * about the direction the deformer works IN, and spending it on the other
     * axis too was subdividing sheets in the one direction they stay flat.
     */
    minSegments?: number
    /**
     * Quality target for `segments: 'auto'` — how much subdivision THESE
     * options need to read as a surface rather than as facets. Depends on the
     * options because it has to: a gentle bend and a tight roll want an order
     * of magnitude apart from the same deformer. See `core/tessellation.ts`
     * for the sagitta argument the implementations share.
     *
     * Counted ALONG `axis` — the direction the deformer actually curves —
     * not across the sheet's long edge. `axialSegments` does the projection.
     *
     * Omit it and `'auto'` falls back to `minSegments`, which is the honest
     * answer for a deformer whose cost does not vary with its options.
     */
    autoSegments?(options: O, sheet: SheetDims): number
    /**
     * Which way this deformer curves, in the sheet's own plane, degrees —
     * the same convention `angle` uses everywhere else (0 across x, 90 up y).
     *
     * Both counts above are measured along it, so it is what turns a demand
     * into a GRID. Without it the demand has to be spread over both axes by
     * aspect ratio, which for a banner draped in folds across its width means
     * resolving those folds at a fraction of what they asked for while
     * subdividing the drop — where nothing bends — to the same density.
     *
     * Return `null`, or omit this, for a deformer with no single direction:
     * `crumple`'s creases run every way at once, and the aspect spread is the
     * honest answer for that.
     */
    axis?(options: O, sheet: SheetDims): number | null
  }
  /** Time-driven: stacks containing this deformer re-deform every frame. */
  animated?: boolean
}

/** One entry of a paper's deformer stack, as stored in a preset. */
export interface DeformerInstance<O = Record<string, unknown>> {
  type: string
  options: O
  enabled?: boolean
}
