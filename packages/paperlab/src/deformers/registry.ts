import type { Deformer } from './types'
import { roll } from './roll'
import { curl } from './curl'
import { bend } from './bend'
import { fold } from './fold'

const registry = new Map<string, Deformer<any>>()

/** Community deformers register here; built-ins are pre-registered. */
export function registerDeformer(deformer: Deformer<any>): void {
  registry.set(deformer.id, deformer)
}

export function getDeformer(id: string): Deformer<any> {
  const d = registry.get(id)
  if (!d) {
    throw new Error(
      `[paperlab] Unknown deformer "${id}". Registered: ${[...registry.keys()].join(', ')}`,
    )
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
