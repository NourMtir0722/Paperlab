import { z } from 'zod'
import { lightingNames } from '../config/schema'
import { walkPathSchema } from './path'
import { shotSchema } from './camera'
import { figureSchema } from './gait'

/**
 * A stage serializes like everything else here: one object that fully
 * describes the walk, who walks it, where the camera stands, and how the
 * space is lit. Same rule as the paper schema — a feature that can't
 * serialize into this waits.
 */

export const stageSourceSchema = z.object({
  /** The bright void the walk resolves toward. Without it the vanishing point is a hole. */
  enabled: z.boolean().default(true),
  color: z.string().default('#fff4e2'),
  /** How far past the end of the walk it stands, world units. */
  beyond: z.number().min(0).max(80).default(10),
  /**
   * A cyclorama around the whole stage, graded from the source colour at the
   * horizon to near-dark overhead. The source plane only faces down the walk,
   * so without this every shot that isn't axial — `wide` especially — looks
   * out at a black void where the room should be.
   */
  surround: z.boolean().default(true),
  /** Colour overhead. The horizon takes the source's own colour. */
  zenith: z.string().default('#241c17'),
  /** Size, as a multiple of the PAPER height — it only has to out-fill the frame. */
  spread: z.number().min(1).max(60).default(5),
})

export const stageGroundSchema = z.object({
  /** The floor. Without something to catch the shadows there is no ground and no scale. */
  enabled: z.boolean().default(true),
  color: z.string().default('#0e0b09'),
})

export const stageSchema = z.object({
  path: walkPathSchema.default({}),
  shot: shotSchema.default({}),
  figure: figureSchema.default({}),
  /** Stage mode is built for `nave`; the others are all front-lit. */
  lighting: z.enum(lightingNames).default('nave'),
  showFigure: z.boolean().default(true),
  source: stageSourceSchema.default({}),
  ground: stageGroundSchema.default({}),
})

export type StageConfig = z.infer<typeof stageSchema>
export type StageConfigInput = z.input<typeof stageSchema>
