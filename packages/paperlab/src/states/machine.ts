import { gsap } from 'gsap'
import { mergeConfig } from '../config/merge'
import {
  paperConfigSchema,
  paperStatesSchema,
  stateDefSchema,
  type PaperConfig,
  type StateName,
} from '../config/schema'

/**
 * The interaction-state engine. A state is a set of parameter overrides on
 * the base preset — never a separate preset. The machine
 * resolves each state to a full config (base + overrides), keeps ONE live
 * tween target of flattened numeric leaves, and always tweens FROM CURRENT
 * VALUES: a pointer that enters/leaves rapidly retargets the same tween
 * values instead of stacking or snapping.
 *
 * Delivery split (GSAP owns values, useFrame owns uploads):
 * GSAP animates the STABLE `flat` object in place; per-tick values are polled
 * off `liveConfig` by the consumer's frame loop, never pushed through React.
 * `onChange` fires only on STRUCTURAL boundaries (a transition's start and
 * settle, a state swap, a rebase) so the React tree re-renders a handful of
 * times per interaction instead of once per frame.
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
 * The merge re-parses so a structural override (a behavior swapped to
 * `{ type: 'carry' }`) comes back with every default filled.
 */
export function resolveStateConfig(base: PaperConfig, state: string): PaperConfig {
  const def = base.states?.states[state]
  const flat = stripStates(base)
  if (!def || Object.keys(def.overrides).length === 0) return flat
  return paperConfigSchema.parse(mergeConfig(flat as Record<string, unknown>, def.overrides))
}

/** Drop `undefined` leaves at every depth, and any object left empty by that. */
function pruneUndefined(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue
    const pruned = pruneUndefined(v)
    const isEmptyObject =
      pruned !== null &&
      typeof pruned === 'object' &&
      !Array.isArray(pruned) &&
      Object.keys(pruned).length === 0
    if (!isEmptyObject) out[key] = pruned
  }
  return out
}

/**
 * Record a patch into ONE state's override diff (Figma's overridden
 * affordance), returning a new base config with that state updated — the base
 * params and every other state stay untouched. This is how an authoring tool
 * writes while a state chip is active. `undefined` values are dropped at every
 * depth: an override can only SET a base param, never remove one. Re-parsing
 * runs the schema's per-state validation, so an override that wouldn't merge
 * cleanly throws here.
 */
export function recordStateOverride(
  config: PaperConfig,
  stateName: string,
  patch: Record<string, unknown>,
): PaperConfig {
  const cleaned = pruneUndefined(patch) as Record<string, unknown>
  const states = config.states ?? paperStatesSchema.parse({})
  const def = states.states[stateName] ?? stateDefSchema.parse({})
  const overrides = mergeConfig(def.overrides, cleaned) as Record<string, unknown>
  return paperConfigSchema.parse({
    ...config,
    states: {
      ...states,
      states: { ...states.states, [stateName]: { ...def, overrides } },
    },
  })
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

/** Apply the flat numeric leaves onto a config object in place (no allocation). */
function applyFlat(target: Record<string, unknown>, flat: Record<string, number>): void {
  for (const path in flat) setPath(target, path, flat[path]!)
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

// ── The machine ──────────────────────────────────────────────────────────────

export interface PaperStateMachineOptions {
  /** Reduced motion: every transition applies instantly (duration 0). */
  instant?: boolean
  /**
   * Fires on STRUCTURAL boundaries only — a transition's start and settle, a
   * state swap, a rebase — with an immutable config snapshot. NOT per tick;
   * per-frame numeric values are polled off `liveConfig`.
   */
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
  /**
   * The single live tween target — flattened numeric leaves of the config.
   * STABLE IDENTITY for the machine's lifetime: `goto`/`rebase` mutate it in
   * place (add/remove/keep keys) and never reassign, so an in-flight GSAP
   * tween keeps animating the same object across a rebase instead of freezing.
   */
  private readonly flat: Record<string, number> = {}
  /** Mutable working config, polled by the consumer's frame loop via `liveConfig`. */
  private live: PaperConfig
  private tween: gsap.core.Tween | null = null
  private resolved = new Map<string, PaperConfig>()

  constructor(base: PaperConfig, opts: PaperStateMachineOptions = {}) {
    this.base = base
    this.opts = opts
    this.state = base.states?.initial ?? 'rest'
    const target = this.resolve(this.state)
    this.structure = clone(target)
    this.live = clone(target)
    Object.assign(this.flat, flattenNumeric(target))
  }

  /** World-units drag distance that flips pressed → picked. */
  get pickThreshold(): number {
    return this.base.states?.pickThreshold ?? 0.1
  }

  /**
   * The live config — the mutable working object with the current tween values
   * applied in place. Cheap (no allocation); meant to be polled every frame.
   * Never hand this to React; use `structuralConfig()` for an immutable snapshot.
   */
  get liveConfig(): PaperConfig {
    applyFlat(this.live as unknown as Record<string, unknown>, this.flat)
    return this.live
  }

  /** Back-compat alias for `liveConfig` (tests, imperative reads). */
  get config(): PaperConfig {
    return this.liveConfig
  }

  /** True while a transition tween is in flight — consumers gate frame work on it. */
  get transitioning(): boolean {
    return this.tween !== null
  }

  /** Exposed for tests: the in-flight transition tween, if any. */
  get activeTween(): gsap.core.Tween | null {
    return this.tween
  }

  /** An immutable structural snapshot for React consumers (never the live object). */
  structuralConfig(): PaperConfig {
    const out = clone(this.structure) as unknown as Record<string, unknown>
    applyFlat(out, this.flat)
    return out as unknown as PaperConfig
  }

  /** Fire a built-in trigger; returns the new state or null if it doesn't apply. */
  send(event: StateEvent): string | null {
    const next = stateEventTransitions[this.state]?.[event]
    if (!next || next === this.state) return null
    this.goto(next)
    return next
  }

  /**
   * Drive to 'picked' through the legal chain (rest→hover→pressed→picked),
   * each hop instant so EVERY side effect fires (behavior override, backing
   * silhouette, onChange state reports, placed onEnter chain). This is the
   * keyboard/a11y entry point — it never produced pointer hover/press events,
   * so raw `send('pick')` from 'rest' was a no-op. Returns true if it landed.
   */
  pickProgrammatic(): boolean {
    for (const event of ['enter', 'down', 'pick'] as StateEvent[]) {
      const next = stateEventTransitions[this.state]?.[event]
      if (next && next !== this.state) this.goto(next, { instant: true })
    }
    return this.state === 'picked'
  }

  /** Instant, legal place (picked → placed) so onEnter/emit fires. */
  placeProgrammatic(): boolean {
    return this.driveInstant('place')
  }

  /** Instant, legal return (picked → rest). */
  returnProgrammatic(): boolean {
    return this.driveInstant('return')
  }

  private driveInstant(event: StateEvent): boolean {
    const next = stateEventTransitions[this.state]?.[event]
    if (!next || next === this.state) return false
    this.goto(next, { instant: true })
    return true
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
    this.live = clone(target)
    const changed: Record<string, number> = {}
    // Mutate `flat` in place (stable identity): drop stale keys, keep live
    // values for shared paths, seed new paths at their target.
    for (const path in this.flat) {
      if (!(path in targetFlat)) delete this.flat[path]
    }
    for (const [path, value] of Object.entries(targetFlat)) {
      const current = this.flat[path]
      // Paths new to this structure appear at their target value — there is
      // no current value to tween from.
      if (current === undefined) this.flat[path] = value
      else if (current !== value) changed[path] = value
    }

    const duration =
      this.opts.instant || opts?.instant ? 0 : (def?.transition.duration ?? DEFAULT_TRANSITION.duration)
    const ease = def?.transition.ease ?? DEFAULT_TRANSITION.ease

    // One tween, ever — kill the previous instead of stacking. Values pick up
    // exactly where the killed tween left them (this.flat is the target).
    this.tween?.kill()
    this.tween = null

    const arrive = () => {
      for (const [path, value] of Object.entries(changed)) this.flat[path] = value
      this.emitStructure()
      for (const action of def?.onEnter ?? []) {
        if (action.startsWith('emit:')) this.opts.onAction?.(action.slice(5), state)
      }
    }

    if (duration === 0 || Object.keys(changed).length === 0) {
      arrive()
      return
    }
    // Structural boundary #1: the start of the transition (React sees the new
    // state and structure). Ticks below never emit — GSAP mutates `flat`, the
    // consumer polls `liveConfig`; #2 is the settle in `arrive`.
    this.emitStructure()
    this.tween = gsap.to(this.flat, {
      ...changed,
      duration,
      ease,
      onComplete: () => {
        this.tween = null
        arrive()
      },
    })
  }

  /**
   * Swap the base config without resetting the machine — parameter edits and
   * runtime patches (torn perforation on detach) keep the current state and
   * live values instead of snapping back to `initial`. An in-flight tween is
   * left running on the SAME `flat` object, so the transition continues
   * smoothly to its target across the rebase (no freeze, no snap).
   */
  rebase(base: PaperConfig): void {
    this.base = base
    this.resolved.clear()
    const target = this.resolve(this.state)
    this.structure = clone(target)
    this.live = clone(target)
    const targetFlat = flattenNumeric(target)
    // In-place, identity-preserving: drop stale keys, seed genuinely new paths
    // at target, keep every existing (possibly mid-tween) value untouched.
    for (const path in this.flat) {
      if (!(path in targetFlat)) delete this.flat[path]
    }
    for (const [path, value] of Object.entries(targetFlat)) {
      if (!(path in this.flat)) this.flat[path] = value
    }
    // Structural change (e.g. perforation flipped to torn) → re-render the
    // structure; the tween keeps animating `flat`, so values never snap.
    this.emitStructure()
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

  private emitStructure(): void {
    this.opts.onChange?.(this.structuralConfig(), this.state)
  }
}
