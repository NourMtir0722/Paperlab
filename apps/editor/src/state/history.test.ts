import { beforeEach, describe, expect, it } from 'vitest'
import { useEditor } from './store'
import { useHistory } from './history'

/**
 * The history subscribes to the store at import time, so these drive the
 * real store the way the UI does — a setter, then a read of what the stack
 * did about it. Nothing here stubs the subscription; if the wiring breaks,
 * these fail, which is the point of testing it from this side.
 */

/** Reset both stacks to a known start between cases. */
function reset() {
  useEditor.getState().setPreset('receipt-unroll')
  useHistory.setState({
    entries: [{ doc: current(), label: '', signature: '', at: 0 }],
    index: 0,
  })
}

function current() {
  const s = useEditor.getState()
  const { progress: _p, playing: _pl, settled: _s, ...stage } = s.stage
  return { presetName: s.presetName, config: s.config, mode: s.mode, field: s.field, stage }
}

const grain = () => useEditor.getState().config.surface.grain

describe('undo / redo', () => {
  beforeEach(reset)

  it('records an edit and puts it back', () => {
    useEditor.getState().setSurface({ grain: 0.8 })
    expect(grain()).toBe(0.8)
    expect(useHistory.getState().index).toBe(1)

    useHistory.getState().undo()
    expect(grain()).not.toBe(0.8)

    useHistory.getState().redo()
    expect(grain()).toBe(0.8)
  })

  it('collapses a drag into one step', () => {
    // What a slider drag actually looks like: one path, many writes, fast.
    for (let i = 1; i <= 30; i++) useEditor.getState().setSurface({ grain: i / 30 })
    expect(useHistory.getState().entries.length).toBe(2)

    useHistory.getState().undo()
    // One undo, not thirty — the whole drag is the thing you meant to undo.
    expect(grain()).not.toBe(1)
    expect(useHistory.getState().index).toBe(0)
  })

  it('keeps separate edits separate', () => {
    useEditor.getState().setSurface({ grain: 0.8 })
    useEditor.getState().patchConfig({ stock: 'newsprint' })
    expect(useHistory.getState().entries.length).toBe(3)

    useHistory.getState().undo()
    expect(useEditor.getState().config.stock).not.toBe('newsprint')
    expect(grain()).toBe(0.8)
  })

  it('names what it will undo, so the button can say it', () => {
    useEditor.getState().setSurface({ grain: 0.8 })
    const { entries, index } = useHistory.getState()
    expect(entries[index]!.label).toBe('grain')
  })

  it('a new edit after an undo drops the redo branch', () => {
    useEditor.getState().setSurface({ grain: 0.8 })
    useEditor.getState().patchConfig({ stock: 'newsprint' })
    useHistory.getState().undo()
    expect(useHistory.getState().index).toBe(1)

    useEditor.getState().patchConfig({ stock: 'vellum' })
    const { entries, index } = useHistory.getState()
    expect(index).toBe(2)
    expect(entries.length).toBe(3)
    // Redoing back into 'newsprint' would be redoing a future that no longer
    // follows from the present.
    expect(index).toBe(entries.length - 1)
  })

  it('ignores the transport — a playhead is not an edit', () => {
    const before = useHistory.getState().entries.length
    useEditor.getState().patchStage({ progress: 0.77, playing: false })
    expect(useHistory.getState().entries.length).toBe(before)
  })

  it('ignores looking around: which state chip is active is not the document', () => {
    const before = useHistory.getState().entries.length
    useEditor.getState().setEditingState('hover')
    useEditor.getState().setSelectedSlot(3)
    expect(useHistory.getState().entries.length).toBe(before)
    useEditor.getState().setEditingState(null)
  })

  it('undoing does not record itself', () => {
    useEditor.getState().setSurface({ grain: 0.8 })
    const length = useHistory.getState().entries.length
    useHistory.getState().undo()
    expect(useHistory.getState().entries.length).toBe(length)
  })

  it('has nowhere to go at the ends, and does not throw trying', () => {
    expect(() => useHistory.getState().undo()).not.toThrow()
    expect(useHistory.getState().index).toBe(0)
    expect(() => useHistory.getState().redo()).not.toThrow()
    expect(useHistory.getState().index).toBe(0)
  })
})
