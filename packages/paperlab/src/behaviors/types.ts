import type { z } from 'zod'
import type { AnyOptions, DeformerInstance, SheetDims } from '../deformers/types'
import type { AeroPose } from '../physics/aero'

/** A draggable 3D grab point; drags write back to behavior params. */
export interface HandleSpec<O = AnyOptions> {
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
export interface Behavior<O = AnyOptions> {
  id: string
  label: string
  defaults: O
  optionsSchema: z.ZodType<O, z.ZodTypeDef, unknown>
  /** Expand human params to the underlying deformer stack. */
  stack(o: O, sheet: SheetDims): DeformerInstance[]
  /** Transient, time-varying option overrides (idle motion). Never persisted. */
  loop?(o: O, t: number): Partial<O>
  /**
   * Whole-sheet motion written into `pose` each frame (allocation-free),
   * composed after any idle preset's transform. Must be a pure function of
   * (options, t) — the field applies it per instance with a time offset, so
   * it has to be deterministic (flight's travel-across-the-scene).
   */
  transform?(o: O, t: number, pose: AeroPose): void
  handles?: HandleSpec<O>[]
  /** The option the transport scrubber drives. */
  progressParam: keyof O & string
  /** Seconds for a full 0→1 play, and how play repeats. */
  duration: number
  loopMode: 'yoyo' | 'restart'
}
