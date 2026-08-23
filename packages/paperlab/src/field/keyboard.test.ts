import { describe, expect, it, vi } from 'vitest'
import { fieldKeyboardStep } from './keyboardMirror'
import type { FieldA11yController } from './interactiveField'
import { PaperStateMachine } from '../states/machine'
import { paperConfigSchema, type PaperConfig } from '../config/schema'

/**
 * The keyboard flow, end to end across the two seams that were broken:
 * key → field controller → state machine. There is no DOM/R3F renderer in this
 * suite, so we drive the pure `fieldKeyboardStep` against a controller wired to
 * a REAL PaperStateMachine (exactly what InteractiveField's a11y controller
 * does). This proves the keyboard path reaches 'picked'/'placed' and fires the
 * placed emit — the whole point of the finding-#1 fix.
 */

/** A stamp-like config: picked swaps to carry, placed emits a postmark. */
const stampConfig = (): PaperConfig =>
  paperConfigSchema.parse({
    behavior: { type: 'peel', progress: 0 },
    states: {
      states: {
        hover: { overrides: { behavior: { progress: 0.22 } } },
        pressed: { overrides: { behavior: { progress: 0.5 } } },
        picked: { overrides: { behavior: { type: 'carry', grab: 'top-left' } } },
        placed: { overrides: {}, onEnter: ['emit:postmark'] },
      },
    },
  })

/** The seam InteractiveField provides — here backed by a real machine. */
function machineController(
  machine: PaperStateMachine,
  zones: string[],
  spy?: { placed?: (zone: string) => void },
): FieldA11yController {
  return {
    pick: () => machine.pickProgrammatic(),
    placeAtZone: (_slot, zoneId) => {
      spy?.placed?.(zoneId)
      machine.placeProgrammatic()
    },
    cancel: () => {
      machine.returnProgrammatic()
    },
    zoneIds: () => zones,
    slotState: () => machine.state,
  }
}

describe('keyboard field flow: key → controller → machine', () => {
  it('focus → Enter picks → arrows move zones → Enter places (emit fires)', () => {
    const onAction = vi.fn()
    const machine = new PaperStateMachine(stampConfig(), { instant: true, onAction })
    let placedZone: string | null = null
    const ctl = machineController(machine, ['envelope', 'trash'], {
      placed: (z) => (placedZone = z),
    })

    // Focus paper 0, press Enter → the machine actually reaches 'picked'.
    let step = fieldKeyboardStep(null, 0, 'Enter', ctl)
    expect(step.handled).toBe(true)
    expect(step.carry).toEqual({ slot: 0, zoneIndex: 0 })
    expect(machine.state).toBe('picked')
    expect(machine.config.behavior!.type).toBe('carry') // picked override applied

    // Arrow between zones (with wraparound).
    step = fieldKeyboardStep(step.carry, 0, 'ArrowRight', ctl)
    expect(step.carry).toEqual({ slot: 0, zoneIndex: 1 })
    step = fieldKeyboardStep(step.carry, 0, 'ArrowRight', ctl)
    expect(step.carry!.zoneIndex).toBe(0) // wrapped past the end
    step = fieldKeyboardStep(step.carry, 0, 'ArrowLeft', ctl)
    expect(step.carry!.zoneIndex).toBe(1) // wrapped back to the last

    // Enter places on the focused zone; the placed emit chain fires.
    step = fieldKeyboardStep(step.carry, 0, 'Enter', ctl)
    expect(step.carry).toBeNull()
    expect(placedZone).toBe('trash')
    expect(machine.state).toBe('placed')
    expect(onAction).toHaveBeenCalledWith('postmark', 'placed')
  })

  it('Escape cancels a pick and returns the paper to rest', () => {
    const machine = new PaperStateMachine(stampConfig(), { instant: true })
    const ctl = machineController(machine, ['envelope'])
    const step = fieldKeyboardStep(null, 2, 'Enter', ctl)
    expect(machine.state).toBe('picked')
    const back = fieldKeyboardStep(step.carry, 2, 'Escape', ctl)
    expect(back.carry).toBeNull()
    expect(machine.state).toBe('rest')
  })

  it('ignores unmapped keys and keys aimed at a paper that is not the one aloft', () => {
    const machine = new PaperStateMachine(stampConfig(), { instant: true })
    const ctl = machineController(machine, ['envelope'])
    // A stray key while idle: not handled, still idle.
    expect(fieldKeyboardStep(null, 0, 'a', ctl)).toEqual({ carry: null, handled: false })
    expect(machine.state).toBe('rest')
    // Enter aimed at slot 1 while slot 0 is aloft: ignored (wrong paper).
    const carry = { slot: 0, zoneIndex: 0 }
    expect(fieldKeyboardStep(carry, 1, 'Enter', ctl)).toEqual({ carry, handled: false })
  })
})
