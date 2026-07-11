import type { z } from 'zod'
import type { DeformerInstance, SheetDims } from '../deformers/types'

/** A draggable 3D grab point; drags write back to behavior params. */
export interface HandleSpec<O = any> {
  id: string
  /** UV-space (0..1) anchor of the grab point on the flat sheet. */
  anchor(o: O, sheet: SheetDims): [number, number]
  /** Map a pointer position in sheet-local XY to option updates. */
  drag(local: { x: number; y: number }, o: O, sheet: SheetDims): Partial<O>
}

/**
 * A behavior is a named, curated bundle: a deformer stack + a parameter
 * mapping + optional idle loop + handles for direct manipulation. Designers
 * see 3–5 human-named params ('tightness', not 'cylinderRadius'); the stack
 * underneath is an Advanced disclosure. New behaviors are the community
 * on-ramp: ~50 lines over existing deformers.
 */
export interface Behavior<O = any> {
  id: string
  label: string
  defaults: O
  optionsSchema: z.ZodType<O, z.ZodTypeDef, unknown>
  /** Expand human params to the underlying deformer stack. */
  stack(o: O, sheet: SheetDims): DeformerInstance[]
  /** Transient, time-varying option overrides (idle motion). Never persisted. */
  loop?(o: O, t: number): Partial<O>
  handles?: HandleSpec<O>[]
  /** The option the transport scrubber drives. */
  progressParam: keyof O & string
  /** Seconds for a full 0→1 play, and how play repeats. */
  duration: number
  loopMode: 'yoyo' | 'restart'
}
