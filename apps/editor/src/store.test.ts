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
