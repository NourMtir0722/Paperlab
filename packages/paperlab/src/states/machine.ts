import { gsap } from 'gsap'
import { mergeConfig } from '../config/merge'
import type { PaperConfig, StateName } from '../config/schema'

/**
 * The interaction-state engine. A state is a set of parameter overrides on
 * the base preset — never a separate preset (spec M6 §1.1). The machine
 * resolves each state to a full config (base + overrides), keeps ONE live
 * tween target of flattened numeric leaves, and always tweens FROM CURRENT
 * VALUES: a pointer that enters/leaves rapidly retargets the same tween
 * values instead of stacking or snapping.
 */

/** Built-in trigger events (v1 — user-defined wiring is parked for editor v2). */
export type StateEvent = 'enter' | 'leave' | 'down' | 'up' | 'pick' | 'place' | 'return'

/** The fixed v1 transition table: pointer flow + pick/drop flow. */
export const stateEventTransitions: Record<string, Partial<Record<StateEvent, StateName>>> = {
  rest: { enter: 'hover' },
  hover: { leave: 'rest', down: 'pressed' },
  pressed: { up: 'hover', pick: 'picked' },
  picked: { place: 'placed', return: 'rest' },
  placed: {},
}

const DEFAULT_TRANSITION = { duration: 0.35, ease: 'power2.out' }

/** The base config with `states` stripped — what a state resolves against. */
export function stripStates(config: PaperConfig): PaperConfig {
  if (!config.states) return config
  const { states: _states, ...rest } = config
  return rest as PaperConfig
}

/**
 * Resolve a state name to its full config: base + that state's overrides.
 * States without a recorded def (e.g. an untouched 'rest') are the base.
 */
export function resolveStateConfig(base: PaperConfig, state: string): PaperConfig {
  const def = base.states?.states[state]
  const flat = stripStates(base)
  if (!def || Object.keys(def.overrides).length === 0) return flat
  return mergeConfig(flat as Record<string, unknown>, def.overrides) as PaperConfig
}

// ── Numeric flattening (dot paths, array indices included) ──────────────────

export function flattenNumeric(
  value: unknown,
  prefix = '',
  out: Record<string, number> = {},
): Record<string, number> {
  if (typeof value === 'number') {
    if (prefix) out[prefix] = value
    return out
  }
  if (value !== null && typeof value === 'object') {
    const entries = Array.isArray(value)
      ? value.map((v, i) => [String(i), v] as const)
      : Object.entries(value)
    for (const [key, v] of entries) {
      flattenNumeric(v, prefix ? `${prefix}.${key}` : key, out)
    }
  }
  return out
}

function setPath(target: Record<string, unknown>, path: string, value: number): void {
  const keys = path.split('.')
  let node: Record<string, unknown> = target
  for (let i = 0; i < keys.length - 1; i++) {
    const next = node[keys[i]!]
    if (next === null || typeof next !== 'object') return // structure changed under us
    node = next as Record<string, unknown>
  }
  node[keys[keys.length - 1]!] = value
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

// ── The machine ──────────────────────────────────────────────────────────────

export interface PaperStateMachineOptions {
  /** Reduced motion: every transition applies instantly (duration 0). */
  instant?: boolean
  /** Fires on every animation tick and structural swap with the live config. */
  onChange?: (config: PaperConfig, state: string) => void
  /** `onEnter` actions — v1 is 'emit:<event>' only; fires after arrival. */
  onAction?: (event: string, state: string) => void
}

export class PaperStateMachine {
  state: string
  private base: PaperConfig
  private readonly opts: PaperStateMachineOptions
  /** Structural target of the current state; numeric leaves live in `flat`. */
  private structure: PaperConfig
  /** The single live tween target — flattened numeric leaves of the config. */
  private flat: Record<string, number>
  private tween: gsap.core.Tween | null = null
  private resolved = new Map<string, PaperConfig>()

  constructor(base: PaperConfig, opts: PaperStateMachineOptions = {}) {
    this.base = base
    this.opts = opts
    this.state = base.states?.initial ?? 'rest'
    const target = this.resolve(this.state)
    this.structure = clone(target)
    this.flat = flattenNumeric(target)
  }

  /** World-units drag distance that flips pressed → picked. */
  get pickThreshold(): number {
    return this.base.states?.pickThreshold ?? 0.1
  }

  /** The live config: current-state structure with tweened numerics applied. */
  get config(): PaperConfig {
    const out = clone(this.structure) as unknown as Record<string, unknown>
    for (const [path, value] of Object.entries(this.flat)) setPath(out, path, value)
    return out as unknown as PaperConfig
  }

  /** Exposed for tests: the in-flight transition tween, if any. */
  get activeTween(): gsap.core.Tween | null {
    return this.tween
  }

  /** Fire a built-in trigger; returns the new state or null if it doesn't apply. */
  send(event: StateEvent): string | null {
    const next = stateEventTransitions[this.state]?.[event]
    if (!next || next === this.state) return null
    this.goto(next)
    return next
  }

  /** Transition to a state (escape hatch for custom states; `send` for triggers). */
  goto(state: string, opts?: { instant?: boolean }): void {
    const def = this.base.states?.states[state]
    const target = this.resolve(state)
    this.state = state

    const targetFlat = flattenNumeric(target)
    // Structure swaps immediately (content/stock changes don't interpolate);
    // numeric leaves keep their CURRENT values and tween to the target.
    this.structure = clone(target)
    const changed: Record<string, number> = {}
    const nextFlat: Record<string, number> = {}
    for (const [path, value] of Object.entries(targetFlat)) {
      const current = this.flat[path]
      // Paths new to this structure appear at their target value — there is
      // no current value to tween from.
      nextFlat[path] = current ?? value
      if (current !== undefined && current !== value) changed[path] = value
    }
    this.flat = nextFlat

    const duration = this.opts.instant || opts?.instant ? 0 : (def?.transition.duration ?? DEFAULT_TRANSITION.duration)
    const ease = def?.transition.ease ?? DEFAULT_TRANSITION.ease

    // One tween, ever — kill the previous instead of stacking. Values pick up
    // exactly where the killed tween left them (this.flat is the target).
    this.tween?.kill()
    this.tween = null

    const arrive = () => {
      for (const [path, value] of Object.entries(changed)) this.flat[path] = value
      this.emit()
      for (const action of def?.onEnter ?? []) {
        if (action.startsWith('emit:')) this.opts.onAction?.(action.slice(5), state)
      }
    }

    if (duration === 0 || Object.keys(changed).length === 0) {
      arrive()
      return
    }
    this.tween = gsap.to(this.flat, {
      ...changed,
      duration,
      ease,
      onUpdate: () => this.emit(),
      onComplete: () => {
        this.tween = null
        arrive()
      },
    })
  }

  /**
   * Swap the base config without resetting the machine — parameter edits and
   * runtime patches (torn perforation on detach) keep the current state and
   * live values instead of snapping back to `initial`.
   */
  rebase(base: PaperConfig): void {
    this.base = base
    this.resolved.clear()
    const target = this.resolve(this.state)
    this.structure = clone(target)
    const targetFlat = flattenNumeric(target)
    const nextFlat: Record<string, number> = {}
    for (const [path, value] of Object.entries(targetFlat)) {
      nextFlat[path] = this.tween && path in this.flat ? this.flat[path]! : value
    }
    this.flat = nextFlat
    if (!this.tween) this.emit()
  }

  dispose(): void {
    this.tween?.kill()
    this.tween = null
  }

  private resolve(state: string): PaperConfig {
    let config = this.resolved.get(state)
    if (!config) {
      config = resolveStateConfig(this.base, state)
      this.resolved.set(state, config)
    }
    return config
  }

  private emit(): void {
    this.opts.onChange?.(this.config, this.state)
  }
}
