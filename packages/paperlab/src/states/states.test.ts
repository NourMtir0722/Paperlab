import { describe, expect, it, vi } from 'vitest'
import { gsap } from 'gsap'
import { paperConfigSchema, type PaperConfig } from '../config/schema'
import {
  PaperStateMachine,
  flattenNumeric,
  resolveStateConfig,
  stateEventTransitions,
  stripStates,
} from './machine'
import { getPreset } from '../config/presets'

const stamp = (): PaperConfig => getPreset('postage-stamp')

const behaviorProgress = (config: PaperConfig): number =>
  (config.behavior as { progress: number }).progress

describe('states schema', () => {
  it('states serialize inside the preset and round-trip', () => {
    const config = stamp()
    expect(config.states).toBeDefined()
    expect(config.states!.states.hover!.overrides).toEqual({ behavior: { progress: 0.22 } })
    const reparsed = paperConfigSchema.parse(JSON.parse(JSON.stringify(config)))
    expect(reparsed).toEqual(config)
  })

  it('fills transition defaults (0.35s / power2.out)', () => {
    const config = paperConfigSchema.parse({
      states: { states: { hover: { overrides: {} } } },
    })
    expect(config.states!.states.hover!.transition).toEqual({ duration: 0.35, ease: 'power2.out' })
    expect(config.states!.initial).toBe('rest')
  })

  it('rejects unknown state names but allows the custom: escape hatch', () => {
    expect(() =>
      paperConfigSchema.parse({ states: { states: { gigantic: { overrides: {} } } } }),
    ).toThrow()
    expect(() =>
      paperConfigSchema.parse({ states: { states: { 'custom:stamped': { overrides: {} } } } }),
    ).not.toThrow()
  })

  it('rejects overrides that are not valid schema paths (schema-enforced)', () => {
    expect(() =>
      paperConfigSchema.parse({
        states: { states: { hover: { overrides: { stock: 'papyrus' } } } },
      }),
    ).toThrow(/hover/)
    // A behavior override on a paper without a behavior has no `type` → invalid.
    expect(() =>
      paperConfigSchema.parse({
        states: { states: { hover: { overrides: { behavior: { progress: 0.5 } } } } },
      }),
    ).toThrow()
  })

  it('rejects nested state machines and non-emit actions', () => {
    expect(() =>
      paperConfigSchema.parse({
        states: { states: { hover: { overrides: { states: { states: {} } } } } },
      }),
    ).toThrow(/nested/)
    expect(() =>
      paperConfigSchema.parse({
        states: { states: { placed: { overrides: {}, onEnter: ['launch:rocket'] } } },
      }),
    ).toThrow()
    expect(() =>
      paperConfigSchema.parse({
        states: { states: { placed: { overrides: {}, onEnter: ['emit:postmark'] } } },
      }),
    ).not.toThrow()
  })
})

describe('resolveStateConfig', () => {
  it('a state is base + overrides — never a separate preset', () => {
    const config = stamp()
    const hover = resolveStateConfig(config, 'hover')
    expect(behaviorProgress(hover)).toBe(0.22)
    // Everything not overridden is the base, verbatim.
    expect(hover.stock).toBe(config.stock)
    expect(hover.surface).toEqual(config.surface)
    expect(hover.states).toBeUndefined()
  })

  it('unrecorded states resolve to the base', () => {
    const config = stamp()
    expect(resolveStateConfig(config, 'rest')).toEqual(stripStates(config))
    expect(resolveStateConfig(config, 'picked')).toEqual(stripStates(config))
  })
})

describe('flattenNumeric', () => {
  it('flattens numeric leaves with dot paths, arrays included', () => {
    const flat = flattenNumeric({ a: 1, b: { c: 2, d: 'x' }, e: [3, 'y', { f: 4 }] })
    expect(flat).toEqual({ a: 1, 'b.c': 2, 'e.0': 3, 'e.2.f': 4 })
  })
})

describe('PaperStateMachine', () => {
  it('walks the fixed v1 trigger table', () => {
    const machine = new PaperStateMachine(stamp(), { instant: true })
    expect(machine.state).toBe('rest')
    expect(machine.send('enter')).toBe('hover')
    expect(machine.send('down')).toBe('pressed')
    expect(machine.send('up')).toBe('hover')
    expect(machine.send('down')).toBe('pressed')
    expect(machine.send('pick')).toBe('picked')
    expect(machine.send('place')).toBe('placed')
    // Placed is terminal for triggers.
    expect(machine.send('enter')).toBeNull()
    machine.dispose()
  })

  it('picked releases either into placed or back to rest', () => {
    const machine = new PaperStateMachine(stamp(), { instant: true })
    machine.goto('picked')
    expect(machine.send('return')).toBe('rest')
    machine.dispose()
  })

  it('instant transitions apply overrides immediately (reduced motion)', () => {
    const seen: Array<[string, number]> = []
    const machine = new PaperStateMachine(stamp(), {
      instant: true,
      onChange: (c, s) => seen.push([s, behaviorProgress(c)]),
    })
    machine.send('enter')
    expect(machine.state).toBe('hover')
    expect(behaviorProgress(machine.config)).toBe(0.22)
    expect(seen.at(-1)).toEqual(['hover', 0.22])
    machine.dispose()
  })

  it('rapid hover on/off never stacks tweens and never snaps', () => {
    const machine = new PaperStateMachine(stamp(), {})
    for (let i = 0; i < 20; i++) {
      machine.send(i % 2 === 0 ? 'enter' : 'leave')
      const tweens = gsap.getTweensOf(
        (machine as unknown as { flat: Record<string, number> }).flat,
      )
      expect(tweens.length).toBeLessThanOrEqual(1)
      // The live value stays in the tweened range — no snapping to endpoints.
      const p = behaviorProgress(machine.config)
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThanOrEqual(0.22)
    }
    machine.dispose()
  })

  it('tweens FROM CURRENT VALUES, not from a cached state', () => {
    const machine = new PaperStateMachine(stamp(), {})
    machine.send('enter') // rest → hover, tween starts at 0
    const tween = machine.activeTween!
    expect(tween).toBeTruthy()
    tween.progress(0.5) // advance synchronously to mid-flight
    const midway = behaviorProgress(machine.config)
    expect(midway).toBeGreaterThan(0)
    expect(midway).toBeLessThan(0.22)
    machine.send('leave') // retarget mid-flight
    // The new tween starts where the old one left off.
    expect(behaviorProgress(machine.config)).toBeCloseTo(midway, 6)
    machine.dispose()
  })

  it('fires onEnter emit actions after arriving', () => {
    const onAction = vi.fn()
    const config = paperConfigSchema.parse({
      behavior: { type: 'peel', progress: 0 },
      states: {
        states: {
          placed: { overrides: {}, onEnter: ['emit:postmark'] },
        },
      },
    })
    const machine = new PaperStateMachine(config, { instant: true, onAction })
    machine.goto('placed')
    expect(onAction).toHaveBeenCalledWith('postmark', 'placed')
    machine.dispose()
  })

  it('rebase keeps the current state and live values (torn-perforation mid-pick)', () => {
    const machine = new PaperStateMachine(stamp(), { instant: true })
    machine.goto('picked')
    const patched = paperConfigSchema.parse({
      ...stamp(),
      surface: {
        ...stamp().surface,
        perforation: { edges: 'all', state: { top: 'torn' } },
      },
    })
    machine.rebase(patched)
    expect(machine.state).toBe('picked')
    expect(machine.config.surface.perforation!.state.top).toBe('torn')
    machine.dispose()
  })

  it('content swaps between states are structural (no interpolation)', () => {
    const config = paperConfigSchema.parse({
      content: { type: 'text', text: 'before' },
      states: {
        states: {
          'custom:stamped': { overrides: { content: { type: 'text', text: 'after' } } },
        },
      },
    })
    const machine = new PaperStateMachine(config, {})
    machine.goto('custom:stamped')
    expect((machine.config.content as { text: string }).text).toBe('after')
    machine.dispose()
  })

  it('exposes the pick threshold with its default', () => {
    expect(new PaperStateMachine(stamp(), {}).pickThreshold).toBe(0.08)
    const plain = paperConfigSchema.parse({ states: { states: {} } })
    expect(new PaperStateMachine(plain, {}).pickThreshold).toBe(0.1)
  })

  it('the trigger table matches the spec', () => {
    expect(stateEventTransitions).toEqual({
      rest: { enter: 'hover' },
      hover: { leave: 'rest', down: 'pressed' },
      pressed: { up: 'hover', pick: 'picked' },
      picked: { place: 'placed', return: 'rest' },
      placed: {},
    })
  })
})
