import type { AnyOptions } from '../deformers/types'
import type { Behavior } from './types'
import { peel } from './peel'
import { unroll } from './unroll'
import { flip } from './flip'
import { letterFold } from './letter-fold'
import { hang } from './hang'
import { fly } from './fly'
import { fall } from './fall'
import { carry } from './carry'
import { flight } from './flight'
import { crumpleBehavior } from './crumple'
import { settle } from './settle'
import { ribbon } from './ribbon'

const registry = new Map<string, Behavior<AnyOptions>>()

/** Community behaviors register here; built-ins are pre-registered. */
export function registerBehavior(behavior: Behavior<AnyOptions>): void {
  registry.set(behavior.id, behavior)
}

export function getBehavior(id: string): Behavior<AnyOptions> {
  const b = registry.get(id)
  if (!b) {
    throw new Error(`[paperlab] Unknown behavior "${id}". Registered: ${[...registry.keys()].join(', ')}`)
  }
  return b
}

export function listBehaviors(): string[] {
  return [...registry.keys()]
}

registerBehavior(peel)
registerBehavior(unroll)
registerBehavior(flip)
registerBehavior(letterFold)
registerBehavior(hang)
registerBehavior(fly)
registerBehavior(fall)
registerBehavior(carry)
registerBehavior(flight)
registerBehavior(crumpleBehavior)
registerBehavior(settle)
registerBehavior(ribbon)
