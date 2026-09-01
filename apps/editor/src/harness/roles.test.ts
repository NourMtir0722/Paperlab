import { describe, expect, it } from 'vitest'
import { NO_ROLES, assignRoles, handFor, type HandRead, type Roles } from './roles'
import { NO_GESTURE, type GestureName } from './gestures'

function read(handedness: 'Left' | 'Right', name: GestureName): HandRead {
  return { handedness, frame: { ...NO_GESTURE, name }, anchor: { x: 0.5, y: 0.5 } }
}

describe('assignRoles', () => {
  it('gives one hand both jobs, exactly as it worked before there were two', () => {
    const one = [read('Right', 'pinch')]
    expect(assignRoles(one)).toEqual<Roles>({ hold: 'Right', act: 'Right' })
    expect(assignRoles([read('Right', 'point')])).toEqual<Roles>({ hold: null, act: 'Right' })
  })

  it('has nobody hold and nobody act when the hands leave', () => {
    expect(assignRoles([], { hold: 'Left', act: 'Right' })).toEqual(NO_ROLES)
  })

  it('lets the pinching hand hold and the other one act', () => {
    const hands = [read('Left', 'pinch'), read('Right', 'point')]
    expect(assignRoles(hands)).toEqual<Roles>({ hold: 'Left', act: 'Right' })
  })

  it('does not hand the paper to the other hand just because it closed', () => {
    // The rule that matters. Reassigning a live grab would make the sim take
    // hold of whichever particle is nearest the NEW hand, which reads as the
    // sheet jumping across the screen.
    const both = [read('Left', 'pinch'), read('Right', 'pinch')]
    expect(assignRoles(both, { hold: 'Left', act: 'Right' })).toEqual<Roles>({
      hold: 'Left',
      act: 'Right',
    })
  })

  it('passes hold on once the holding hand opens', () => {
    const hands = [read('Left', 'palm'), read('Right', 'pinch')]
    expect(assignRoles(hands, { hold: 'Left', act: 'Right' })).toEqual<Roles>({
      hold: 'Right',
      act: 'Left',
    })
  })

  it('drops hold when the holding hand leaves the frame', () => {
    const left = [read('Left', 'point')]
    expect(assignRoles(left, { hold: 'Right', act: 'Left' })).toEqual<Roles>({ hold: null, act: 'Left' })
  })

  it('keeps the acting hand acting while nobody is holding', () => {
    // Otherwise the cursor swaps hands every time the tracker reorders them.
    const hands = [read('Left', 'palm'), read('Right', 'point')]
    expect(assignRoles(hands, { hold: null, act: 'Right' }).act).toBe('Right')
    expect(assignRoles(hands, { hold: null, act: 'Left' }).act).toBe('Left')
  })
})

describe('handFor', () => {
  it('finds the hand in a role, and nothing for a role nobody fills', () => {
    const hands = [read('Left', 'pinch'), read('Right', 'point')]
    expect(handFor(hands, 'Right')?.frame.name).toBe('point')
    expect(handFor(hands, null)).toBeNull()
    expect(handFor([], 'Left')).toBeNull()
  })
})
