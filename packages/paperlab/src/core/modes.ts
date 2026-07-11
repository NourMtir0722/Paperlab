export type PaperMode = 'hero' | 'field'
export type PaperModeRequest = PaperMode | 'auto'

export interface ModeContext {
  interactive: boolean
  physics: string
  count: number
}

/**
 * Hero mode: deformer stack runs in JS on the CPU, writing BufferGeometry
 * positions (correct raycasting, shadows, physics, handle drags).
 * Field mode: composed GLSL vertex chunks, instanced (galleries, 10+ sheets).
 * The same preset JSON drives both.
 */
export function resolveMode(requested: PaperModeRequest, ctx: ModeContext): PaperMode {
  if (requested !== 'auto') return requested
  if (ctx.interactive || ctx.physics !== 'none' || ctx.count <= 10) return 'hero'
  return 'field'
}
