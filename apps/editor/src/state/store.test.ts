import { describe, expect, it } from 'vitest'
import { useEditor } from './store'

/**
 * The stage store, and the one property that keeps the scene from pumping
 * itself.
 *
 * `<PaperStageScene>` reports back up here — the quality tier it settled on,
 * every time it settles. If a report that says nothing new still produces a
 * fresh `stage` object, zustand notifies, the app re-renders, the scene is
 * handed new prop identities, and it reports again: a loop that spends every
 * frame on itself and leaves nothing for the interaction you actually made.
 * That is what "the whole app freezes when I touch anything" looked like.
 *
 * So the guarantee under test is identity, not equality: an unchanged patch
 * must return the SAME object, because that is the only thing a subscriber
 * checks.
 */
describe('patchStage', () => {
  it('returns the same stage object when the patch changes nothing', () => {
    const before = useEditor.getState().stage
    useEditor.getState().patchStage({ settled: before.settled })
    expect(useEditor.getState().stage).toBe(before)
  })

  it('is a no-op for a repeated report, however many times it arrives', () => {
    useEditor.getState().patchStage({ settled: 'medium' })
    const settledOnce = useEditor.getState().stage
    for (let i = 0; i < 5; i++) useEditor.getState().patchStage({ settled: 'medium' })
    expect(useEditor.getState().stage).toBe(settledOnce)
  })

  it('still writes a patch that does change something', () => {
    const before = useEditor.getState().stage
    useEditor.getState().patchStage({ progress: before.progress + 0.1 })
    const after = useEditor.getState().stage
    expect(after).not.toBe(before)
    expect(after.progress).toBeCloseTo(before.progress + 0.1)
  })

  it('writes when only one key of a multi-key patch is new', () => {
    const before = useEditor.getState().stage
    useEditor.getState().patchStage({ settled: before.settled, playing: !before.playing })
    expect(useEditor.getState().stage.playing).toBe(!before.playing)
  })
})

/**
 * `inspectorEpoch` remounts the whole inspector, which resets every folder's
 * open/closed state. That is right when the SUBJECT changes — a new preset,
 * a new behavior, a new mode — and wrong when only a value does.
 *
 * It was wrong in four places, and the drop-zone one was visible: opening
 * "Drop zones" and pressing "Add a drop zone" closed the folder on the zone
 * you had just made. The state-override resets had the same shape — you open
 * a folder to find the control you want to reset, and resetting it closes
 * the folder. Each of these setters changes values the inspector already
 * derives from the store on every render, so none of them needs a remount.
 */
describe('the inspector is not remounted for a value change', () => {
  const epoch = () => useEditor.getState().inspectorEpoch

  it('adding and removing a drop zone', () => {
    const before = epoch()
    useEditor.getState().addZone()
    expect(useEditor.getState().field.zones.length).toBeGreaterThan(0)
    useEditor.getState().removeZone(useEditor.getState().field.zones.length - 1)
    expect(epoch()).toBe(before)
  })

  it('clearing one recorded state override', () => {
    useEditor.getState().setEditingState('hover')
    useEditor.getState().patchConfig({ surface: { grain: 0.7 } })
    useEditor.getState().setEditingState(null)
    const before = epoch()
    useEditor.getState().clearStateOverride('hover', 'surface.grain')
    expect(epoch()).toBe(before)
  })

  it('resetting a whole state to base', () => {
    useEditor.getState().setEditingState('pressed')
    useEditor.getState().patchConfig({ surface: { grain: 0.6 } })
    useEditor.getState().setEditingState(null)
    const before = epoch()
    useEditor.getState().resetStateOverrides('pressed')
    expect(useEditor.getState().config.states?.states.pressed?.overrides).toEqual({})
    expect(epoch()).toBe(before)
  })

  it('clearing a slot-layer override', () => {
    useEditor.getState().patchSlotState(0, 'hover', { behavior: { progress: 0.6 } })
    const before = epoch()
    useEditor.getState().clearSlotState(0, 'hover')
    expect(epoch()).toBe(before)
  })

  it('but still remounts when the subject changes', () => {
    const before = epoch()
    useEditor.getState().setMode('field')
    expect(epoch()).toBeGreaterThan(before)
    useEditor.getState().setMode('paper')
  })
})
