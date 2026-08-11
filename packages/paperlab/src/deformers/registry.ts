import { z } from 'zod'
import type { Deformer, DeformerInstance } from './types'
import { roll } from './roll'
import { curl } from './curl'
import { bend } from './bend'
import { fold } from './fold'
import { wave } from './wave'
import { drape } from './drape'

const registry = new Map<string, Deformer<any>>()

/** Community deformers register here; built-ins are pre-registered. */
export function registerDeformer(deformer: Deformer<any>): void {
  registry.set(deformer.id, deformer)
}

export function getDeformer(id: string): Deformer<any> {
  const d = registry.get(id)
  if (!d) {
    throw new Error(`[paperlab] Unknown deformer "${id}". Registered: ${[...registry.keys()].join(', ')}`)
  }
  return d
}

export function listDeformers(): string[] {
  return [...registry.keys()]
}

registerDeformer(roll)
registerDeformer(curl)
registerDeformer(bend)
registerDeformer(fold)
registerDeformer(wave)
registerDeformer(drape)

/**
 * Resolve a raw `deformers` stack — the Advanced fork of a behavior — into
 * instances safe to render.
 *
 * The escape hatch used to pass its options straight through, so a preset
 * naming an option that doesn't exist (`frequency` where wave wants
 * `wavelength`) reached the GLSL builder as `undefined` and died there with
 * a message about `.length`, or reached the CPU path and quietly produced
 * NaN vertices. Parsing through each deformer's own schema turns that into
 * the validation error it always was, and fills in defaults for whatever a
 * hand-written preset left out.
 *
 * Disabled entries keep their slot: the GLSL uniform namespace is indexed by
 * position, so dropping one here would rename every uniform after it.
 */
export function resolveDeformerStack(
  raw: { type: string; options?: Record<string, unknown>; enabled?: boolean }[],
): DeformerInstance[] {
  return raw.map((instance, i) => {
    const deformer = getDeformer(instance.type)
    // Strict: an unknown key here is almost always a typo for a real option,
    // and silently dropping it means the preset renders wrong with no clue
    // why. Every built-in schema is a plain object; anything exotic a
    // community deformer brings is parsed as it comes.
    const schema =
      deformer.optionsSchema instanceof z.ZodObject ? deformer.optionsSchema.strict() : deformer.optionsSchema
    const parsed = schema.safeParse(instance.options ?? {})
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw new Error(
        `[paperlab] deformers[${i}] ("${instance.type}"): ${
          issue ? `${issue.path.join('.') || 'options'} — ${issue.message}` : 'invalid options'
        }`,
      )
    }
    return {
      type: instance.type,
      options: parsed.data as Record<string, unknown>,
      enabled: instance.enabled,
    }
  })
}

/** True if any enabled instance re-deforms every frame (wave etc.). */
export function stackIsAnimated(stack: { type: string; enabled?: boolean }[]): boolean {
  return stack.some((i) => i.enabled !== false && registry.get(i.type)?.animated)
}
