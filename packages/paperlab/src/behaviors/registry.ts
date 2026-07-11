import type { Behavior } from './types'
import { peel } from './peel'
import { unroll } from './unroll'
import { flip } from './flip'

const registry = new Map<string, Behavior<any>>()

/** Community behaviors register here; built-ins are pre-registered. */
export function registerBehavior(behavior: Behavior<any>): void {
  registry.set(behavior.id, behavior)
}

export function getBehavior(id: string): Behavior<any> {
  const b = registry.get(id)
  if (!b) {
    throw new Error(
      `[paperlab] Unknown behavior "${id}". Registered: ${[...registry.keys()].join(', ')}`,
    )
  }
  return b
}

export function listBehaviors(): string[] {
  return [...registry.keys()]
}

registerBehavior(peel)
registerBehavior(unroll)
registerBehavior(flip)
