import { z } from 'zod'
import {
  diffConfig,
  listLayouts,
  listPresets,
  paperConfigSchema,
  paperStatesSchema,
  type PaperStatesInput,
} from 'paperlab'
import { listStagePresets, qualityNames, stageSchema, walkNames } from 'paperlab/stage'
import type { EditorMode, EditorZone, FieldState, StageState } from './store'

/**
 * The editor remembers where you left it.
 *
 * Reopening the tab used to drop you on `receipt-unroll` no matter what you
 * had been working on — including a sculpt you had not saved yet, which was
 * simply gone. That is demo behaviour; a tool comes back up on the thing you
 * were looking at.
 *
 * This is a CONVENIENCE, never the source of truth. Saved presets live in
 * [userPresets] and a `.paper` file is the real artifact — the session is
 * one key holding "the view", and it is allowed to fail. Anything that does
 * not validate against the schema is dropped and you land on the default,
 * which is exactly the old behaviour rather than a broken editor.
 *
 * Same shape as everything else here: the schema is what makes the stored
 * half trustworthy, and only the diff from the schema defaults is written.
 */

const STORAGE_KEY = 'paperlab.session.v1'

/** Long enough to outlast a slider drag, short enough to survive a tab close. */
const WRITE_DEBOUNCE_MS = 500

const zoneSchema = z.object({
  id: z.string().min(1),
  accept: z.string(),
  position: z.tuple([z.number(), z.number(), z.number()]),
  size: z.tuple([z.number(), z.number()]),
  highlight: z.enum(['none', 'glow', 'outline']),
})

const fieldSessionSchema = z.object({
  layout: z.string(),
  layoutOptions: z.record(z.unknown()),
  count: z.number().int().min(1).max(400),
  driver: z.enum(['autoplay', 'drag', 'none']),
  speed: z.number(),
  entrance: z.enum(['rise', 'scatter', 'none']),
  slots: z.array(z.string()).min(1),
  // JSON turns the numeric slot keys into strings; they come back as numbers.
  slotStates: z.record(z.string(), paperStatesSchema),
  zones: z.array(zoneSchema),
})

const stageSessionSchema = z.object({
  preset: z.string(),
  walk: z.enum(walkNames),
  layout: z.string(),
  layoutOptions: z.record(z.unknown()),
  text: z.string(),
  count: z.number().int().min(1).max(400),
  // The walk is held as a name, so the resolved path is not part of the view.
  config: stageSchema.omit({ path: true }),
  paper: paperConfigSchema.optional(),
  quality: z.enum(qualityNames),
})

const sessionSchema = z.object({
  mode: z.enum(['paper', 'field', 'stage']),
  paper: z.object({ name: z.string().min(1).max(120), config: paperConfigSchema }).optional(),
  field: fieldSessionSchema.optional(),
  stage: stageSessionSchema.optional(),
})

export interface EditorSession {
  mode: EditorMode
  /** The paper on the canvas, sculpt included — `name` is which preset it forked from. */
  paper?: { name: string; config: z.infer<typeof paperConfigSchema> }
  field?: FieldState
  stage?: Pick<
    StageState,
    'preset' | 'walk' | 'layout' | 'layoutOptions' | 'text' | 'count' | 'config' | 'paper' | 'quality'
  >
}

/** What the editor hands over to be remembered. Transport state is deliberately absent. */
export interface SessionInput {
  mode: EditorMode
  presetName: string
  config: z.infer<typeof paperConfigSchema>
  field: FieldState
  stage: StageState
}

/**
 * A validated session still names presets and layouts that may not exist
 * any more — a deleted user preset, a layout from a newer build. The schema
 * cannot know that, so the registries get the last word here: `getPreset`
 * throws on an unknown name and a field slot referencing one would take the
 * whole canvas down.
 */
function sanitize(parsed: z.infer<typeof sessionSchema>): EditorSession {
  const presets = new Set(listPresets())
  const layouts = new Set(listLayouts())
  const session: EditorSession = { mode: parsed.mode }

  if (parsed.paper) session.paper = parsed.paper

  if (parsed.field && layouts.has(parsed.field.layout)) {
    const slotStates: Record<number, PaperStatesInput> = {}
    for (const [key, states] of Object.entries(parsed.field.slotStates)) {
      const slot = Number(key)
      if (Number.isInteger(slot) && slot >= 0) slotStates[slot] = states as PaperStatesInput
    }
    session.field = {
      ...parsed.field,
      // A slot pointing at a preset that is gone falls back the same way a
      // deleted preset's slots do.
      slots: parsed.field.slots.map((name) => (presets.has(name) ? name : 'photo-print')),
      // The slot list IS the population — the store keeps the two equal, so
      // trust the list rather than a count that could disagree with it.
      count: parsed.field.slots.length,
      slotStates,
      zones: parsed.field.zones as EditorZone[],
    }
  }

  if (parsed.stage && listStagePresets().includes(parsed.stage.preset) && layouts.has(parsed.stage.layout)) {
    session.stage = parsed.stage
  }

  // A mode whose state was dropped would come back up on defaults with no
  // explanation; land on the paper instead, which always restores.
  if (session.mode === 'field' && !session.field) session.mode = 'paper'
  if (session.mode === 'stage' && !session.stage) session.mode = 'paper'

  return session
}

/** The remembered view, or null if there isn't a usable one. Never throws. */
export function readSession(): EditorSession | null {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const result = sessionSchema.safeParse(parsed)
  return result.success ? sanitize(result.data) : null
}

export function writeSession(input: SessionInput): void {
  const { progress: _p, playing: _pl, settled: _s, ...stage } = input.stage
  const payload = {
    mode: input.mode,
    // The diff, not the whole config — the reader's copy of the schema
    // already knows the defaults, and this key gets rewritten constantly.
    paper: { name: input.presetName, config: diffConfig(input.config) },
    field: input.field,
    stage,
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Out of quota, most likely an uploaded image in the config. The session
    // is the expendable one — clear it rather than leaving a stale view that
    // would restore work older than what is on screen.
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* nothing left to try; the editor still works, it just forgets */
    }
  }
}

/**
 * Follow a store and keep the session current. Debounced, because every
 * frame of a slider drag is a state change and none of them are worth a
 * JSON.stringify — and flushed on `pagehide`, because closing the tab is
 * exactly when the last edit needs to already be written.
 */
export function startSessionMemory(store: {
  getState(): SessionInput
  subscribe(listener: () => void): () => void
}): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let dirty = false

  const flush = () => {
    if (!dirty) return
    dirty = false
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    writeSession(store.getState())
  }

  const unsubscribe = store.subscribe(() => {
    dirty = true
    if (timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      flush()
    }, WRITE_DEBOUNCE_MS)
  })

  const onHide = () => flush()
  window.addEventListener('pagehide', onHide)

  return () => {
    unsubscribe()
    window.removeEventListener('pagehide', onHide)
    if (timer !== undefined) clearTimeout(timer)
  }
}
