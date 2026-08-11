import { getBehavior } from '../behaviors/registry'
import { resolveDeformerStack } from '../deformers/registry'
import type { PaperConfig } from '../config/schema'
import type { DeformerInstance } from '../deformers/types'

/**
 * The deformer stack one field group renders, at a given behavior progress.
 *
 * A raw `deformers` array is the Advanced fork of a behavior and wins over
 * one — the same precedence the hero path's `buildStack` applies. Field mode
 * once read `behavior` only, so a preset shaped by `deformers` (the way to
 * say "this print has a permanent bow") silently rendered flat.
 */
export function fieldShapeStack(config: PaperConfig, progress: number): DeformerInstance[] {
  if (config.deformers) return resolveDeformerStack(config.deformers)
  if (!config.behavior) return []
  const behavior = getBehavior(config.behavior.type)
  const options = { ...config.behavior, [behavior.progressParam]: progress }
  return behavior.stack(options, config.sheet)
}
