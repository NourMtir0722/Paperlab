import { useEffect } from 'react'
import { create } from 'zustand'
import type { PaperConfig } from 'paperlab'
import { isTypingTarget } from './keys'
import { useEditor, type EditorMode, type FieldState, type StageState } from './store'

/**
 * Undo / redo.
 *
 * The reason this exists is not that people make mistakes. It is that
 * without it, a stranger will not touch a slider they do not understand —
 * every control in a generated inspector is an unlabelled risk until there
 * is a way back, and most of this editor's controls are generated. Undo is
 * what makes exploring the panel free.
 *
 * **It observes the store rather than wrapping it.** Every setter in
 * `store.ts` already routes its writes through `writeConfig`, and threading
 * a history call through each one would be a second thing to remember for
 * every future setter — exactly the kind of rule that gets forgotten once
 * and then silently stops recording one action forever. A subscription
 * cannot be forgotten: anything that changes the document is recorded
 * because it changed the document.
 *
 * What counts as the document, and what does not:
 *
 * - **In:** the paper (`presetName`, `config`), the field, the stage's
 *   space and its edits, and the mode you were in when you made them.
 * - **Out:** the transport (`progress`, `playing`, the settled quality
 *   tier) — scrubbing a timeline is looking, not editing, and a history
 *   full of playhead positions is a history you cannot use. Also out:
 *   `editingState`, `selectedSlot`, `inspectorEpoch`. Those are which way
 *   you are facing, not what you built.
 * - **Out, deliberately:** the user preset library. Saving, renaming and
 *   deleting a preset writes to localStorage and to the library's runtime
 *   registry, and an undo that silently un-saved someone's work — or
 *   resurrected a preset the registry no longer holds — is a worse promise
 *   than not offering one. Those actions confirm and toast instead.
 */

/** Consecutive edits to the same thing inside this window collapse into one. */
const COALESCE_MS = 600
/** Snapshots are whole documents; this is where the memory stops growing. */
const LIMIT = 120

/** The stage minus its transport — see the note above about playheads. */
type StageDoc = Omit<StageState, 'progress' | 'playing' | 'settled'>

interface Doc {
  presetName: string
  config: PaperConfig
  mode: EditorMode
  field: FieldState
  stage: StageDoc
}

interface Entry {
  doc: Doc
  /** What this entry changed, for "Undo grain" — the paths that differed. */
  label: string
  /** The same change made again inside the window replaces this entry. */
  signature: string
  at: number
}

function snapshot(): Doc {
  const s = useEditor.getState()
  const { progress: _p, playing: _pl, settled: _st, ...stage } = s.stage
  return { presetName: s.presetName, config: s.config, mode: s.mode, field: s.field, stage }
}

/**
 * The leaf paths at which two documents differ.
 *
 * This does double duty: joined, it is the coalescing key (a slider drag
 * reports `config.behavior.progress` on every one of its sixty updates a
 * second, so the whole drag collapses to one entry), and read, it is the
 * label on the undo button.
 */
function changedPaths(a: unknown, b: unknown, prefix = '', out: string[] = []): string[] {
  if (a === b) return out
  const objects =
    a !== null &&
    b !== null &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  if (!objects) {
    // Arrays and primitives compare whole: a field's slot list is one fact
    // about the field, not fourteen.
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(prefix || '(root)')
    return out
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  for (const key of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
    changedPaths(ao[key], bo[key], prefix ? `${prefix}.${key}` : key, out)
  }
  return out
}

/**
 * A phrase for the undo button. The last segment of a path is the name the
 * person actually saw on the control they moved ("grain", "tightness"), so
 * that is what the button says; a change that touched several unrelated
 * places has no such name and says "edit" rather than inventing one.
 */
function describe(paths: string[], next: Doc, prev: Doc): string {
  if (next.presetName !== prev.presetName) return `open "${next.presetName}"`
  if (next.mode !== prev.mode) return `${next.mode} mode`
  if (paths.length === 0) return 'edit'
  const leaves = new Set(paths.map((p) => p.split('.').pop()!))
  return leaves.size === 1 ? [...leaves][0]! : 'edit'
}

interface HistoryStore {
  entries: Entry[]
  index: number
  undo(): void
  redo(): void
}

/** True while an undo/redo is writing, so the subscription ignores its own work. */
let applying = false

const initial: Entry = { doc: snapshot(), label: '', signature: '', at: 0 }

export const useHistory = create<HistoryStore>((set, get) => ({
  entries: [initial],
  index: 0,
  undo: () => step(set, get, -1),
  redo: () => step(set, get, +1),
}))

function step(set: (partial: Partial<HistoryStore>) => void, get: () => HistoryStore, delta: -1 | 1): void {
  const { entries, index } = get()
  const next = index + delta
  const entry = entries[next]
  if (!entry) return
  applying = true
  const current = useEditor.getState()
  useEditor.setState({
    ...entry.doc,
    // The transport is not in the snapshot, so it survives the jump — undoing
    // an edit should not also rewind the walk you were standing in.
    stage: { ...current.stage, ...entry.doc.stage },
    // The canvas writes params behind the inspector's back on a handle drag,
    // and undo is the same situation from the other side: the panel is now
    // showing values nothing told it about.
    inspectorEpoch: current.inspectorEpoch + 1,
    editingState: null,
    statePreview: false,
  })
  applying = false
  set({ index: next })
}

useEditor.subscribe(() => {
  if (applying) return
  const { entries, index } = useHistory.getState()
  const prev = entries[index]
  if (!prev) return
  const doc = snapshot()
  const paths = changedPaths(prev.doc, doc)
  if (paths.length === 0) return

  const signature = paths.join('|')
  const now = Date.now()
  const label = describe(paths, doc, prev.doc)
  const entry: Entry = { doc, label, signature, at: now }

  // Still dragging the same slider, at the head of the stack: replace the
  // entry rather than adding a two-hundredth one. The window slides with the
  // activity, so a long drag is one step and a pause starts the next; and
  // `index === last` matters, because after an undo the head is behind us
  // and a fresh edit has to branch rather than overwrite.
  const head = index === entries.length - 1
  if (head && prev.signature === signature && now - prev.at < COALESCE_MS) {
    useHistory.setState({ entries: [...entries.slice(0, index), entry], index })
    return
  }

  const kept = [...entries.slice(0, index + 1), entry]
  const overflow = Math.max(0, kept.length - LIMIT)
  useHistory.setState({ entries: kept.slice(overflow), index: kept.length - 1 - overflow })
})

/** What the buttons need, without re-deriving the stack shape in the view. */
export function useUndoState() {
  const entries = useHistory((s) => s.entries)
  const index = useHistory((s) => s.index)
  return {
    canUndo: index > 0,
    canRedo: index < entries.length - 1,
    undoLabel: entries[index]?.label ?? '',
    redoLabel: entries[index + 1]?.label ?? '',
  }
}

/**
 * The shortcut, bound once for the app.
 *
 * Skipped while a text field or the app's own select has focus: inside an
 * input, ⌘Z is the browser's own undo of what you are typing, and stealing
 * it to roll the document back instead is the more surprising of the two.
 */
export function useHistoryKeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || isTypingTarget(e.target)) return
      const key = e.key.toLowerCase()
      // ⇧⌘Z is redo everywhere; Ctrl+Y is the same thing to Windows hands.
      const redo = (key === 'z' && e.shiftKey) || (key === 'y' && e.ctrlKey && !e.metaKey)
      if (!redo && !(key === 'z')) return
      e.preventDefault()
      const history = useHistory.getState()
      if (redo) history.redo()
      else history.undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
