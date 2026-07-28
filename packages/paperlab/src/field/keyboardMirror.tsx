import { useState } from 'react'
import { contentText } from '../a11y'
import { resolveConfig } from '../PaperMesh'
import type { FieldA11yController } from './interactiveField'
import type { FieldPaperSlot } from './slots'

/** Carry state of the hidden keyboard mirror: which paper is aloft, which zone is focused. */
export interface KeyboardCarry {
  slot: number
  zoneIndex: number
}

/** A keyboard step's decision: the next carry state and whether it consumed the key. */
export interface KeyboardStepResult {
  carry: KeyboardCarry | null
  handled: boolean
}

/**
 * The M6 §6 keyboard flow as a pure step (so it's testable without a DOM):
 * given the current carry state, the focused paper `slot`, and the pressed
 * `key`, it drives the field `controller` (pick → move between zones → place /
 * cancel) and returns the next carry state. All side effects go through
 * `controller`; the caller applies `carry` to its state and calls
 * `preventDefault()` when `handled` is true.
 */
export function fieldKeyboardStep(
  carry: KeyboardCarry | null,
  slot: number,
  key: string,
  controller: FieldA11yController,
): KeyboardStepResult {
  if (!carry) {
    // Not carrying: Enter/Space on a focused paper picks it up.
    if (key === 'Enter' || key === ' ') {
      return { carry: controller.pick(slot) ? { slot, zoneIndex: 0 } : null, handled: true }
    }
    return { carry, handled: false }
  }
  // Carrying: only the paper actually aloft responds.
  if (carry.slot !== slot) return { carry, handled: false }
  const zoneCount = Math.max(controller.zoneIds().length, 1)
  if (key === 'ArrowRight' || key === 'ArrowDown') {
    return { carry: { ...carry, zoneIndex: (carry.zoneIndex + 1) % zoneCount }, handled: true }
  }
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return {
      carry: { ...carry, zoneIndex: (carry.zoneIndex - 1 + zoneCount) % zoneCount },
      handled: true,
    }
  }
  if (key === 'Enter' || key === ' ') {
    const zone = controller.zoneIds()[carry.zoneIndex]
    if (zone) controller.placeAtZone(slot, zone)
    return { carry: null, handled: true }
  }
  if (key === 'Escape') {
    controller.cancel(slot)
    return { carry: null, handled: true }
  }
  return { carry, handled: false }
}

const mirrorHidden: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
}

/**
 * The hidden DOM mirror of an interactive field: each paper is a button.
 * Keyboard flow — focus a paper, Enter picks it, arrow keys move between
 * zones, Enter places, Escape returns it to its slot (spec M6 §6). The key
 * handling lives in the pure {@link fieldKeyboardStep} so it can be tested.
 */
export function FieldKeyboardMirror({
  papers,
  controller,
}: {
  papers: FieldPaperSlot[]
  controller: React.MutableRefObject<FieldA11yController | null>
}) {
  const [carrying, setCarrying] = useState<{ slot: number; zoneIndex: number } | null>(null)

  const paperLabel = (slot: FieldPaperSlot, i: number): string => {
    try {
      const config = resolveConfig({ preset: slot.preset })
      return `Paper ${i + 1}: ${contentText({ ...config, content: slot.content ?? config.content })}`
    } catch {
      return `Paper ${i + 1}`
    }
  }

  const onKeyDown = (i: number) => (e: React.KeyboardEvent) => {
    const ctl = controller.current
    if (!ctl) return
    const { carry, handled } = fieldKeyboardStep(carrying, i, e.key, ctl)
    if (handled) e.preventDefault()
    if (carry !== carrying) setCarrying(carry)
  }

  return (
    <div style={mirrorHidden} role="group" aria-label="Interactive papers">
      {papers.map((slot, i) => (
        <button
          key={i}
          type="button"
          onKeyDown={onKeyDown(i)}
          aria-label={paperLabel(slot, i)}
          aria-pressed={carrying?.slot === i}
        >
          {paperLabel(slot, i)}
          {carrying?.slot === i && (
            <span aria-live="polite">
              {' '}
              — carrying; zone {controller.current?.zoneIds()[carrying.zoneIndex] ?? 'none'};
              Enter places, Escape returns
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
