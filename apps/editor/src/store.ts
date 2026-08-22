import { create } from 'zustand'
import {
  behaviorConfigSchema,
  clothConfigSchema,
  diffConfig,
  getPreset,
  isBuiltinPreset,
  mergeConfig,
  mergeWithDeletes,
  paperConfigSchema,
  paperStatesSchema,
  parsePreset,
  recordStateOverride,
  sheetLayoutSchema,
  stateDefSchema,
  uniquePresetName,
  type ClothConfig,
  type PaperConfig,
  type PaperConfigInput,
  type PaperStatesInput,
  type SurfaceConfig,
} from 'paperlab'
import {
  type StageConfigInput,
  type WalkName,
  getStagePreset,
  walkNames,
  walks,
  type QualityName,
  type QualityTier,
} from 'paperlab/stage'
import type { PaperShare } from './paperShare'
import { readSession } from './session'
import {
  loadUserPresets,
  persistUserPresets,
  syncRegistry,
  type StoredPreset,
  type UserPresetMap,
} from './userPresets'

export interface EditorZone {
  id: string
  /** Comma-separated preset-name globs; empty = accept all. */
  accept: string
  position: [number, number, number]
  size: [number, number]
  highlight: 'none' | 'glow' | 'outline'
}

export interface FieldState {
  layout: string
  layoutOptions: Record<string, unknown>
  count: number
  driver: 'autoplay' | 'drag' | 'none'
  speed: number
  entrance: 'rise' | 'scatter' | 'none'
  /** Preset name per slot — each field slot references a preset (components). */
  slots: string[]
  /** Per-slot state overrides (slot layer, merged over the preset's states). */
  slotStates: Record<number, PaperStatesInput>
  /** Drop zones — serialized into the field config and the export. */
  zones: EditorZone[]
}

/** Editor zone → library DropZoneConfig. */
export function zoneToConfig(zone: EditorZone) {
  const accept = zone.accept
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return {
    id: zone.id,
    ...(accept.length > 0 ? { accept } : {}),
    bounds: { position: zone.position, size: zone.size },
    highlight: zone.highlight,
  }
}

/**
 * Stage mode's editable state. The walk is held as a NAME rather than as
 * points: picking "ess" from a list is the interaction, and it resolves to
 * a real path at render time.
 */
export type EditorMode = 'paper' | 'field' | 'stage'

export interface StageState {
  /** Which named stage is loaded — the left rail's selection. */
  preset: string
  walk: WalkName
  layout: string
  layoutOptions: Record<string, unknown>
  /** The words the space is built out of. Empty renders blank banners. */
  text: string
  count: number
  /** 0..1 along the walk, used while paused. */
  progress: number
  /** Playing hands the walk to the clock; paused hands it to the scrubber. */
  playing: boolean
  /** Shot, figure, lighting, source, ground — everything but the path. */
  config: StageConfigInput
  /** The banner itself: dims, stock, drape. */
  paper?: PaperConfigInput
  /** Render cost. `auto` adapts; the fixed tiers are how you see what a weak machine gets. */
  quality: QualityName
  /** What `auto` actually settled on, reported back by the scene. */
  settled: QualityTier | null
}

interface EditorState {
  presetName: string
  config: PaperConfig
  mode: EditorMode
  field: FieldState
  stage: StageState
  /** True while editing a paper that was opened from the Field Composer. */
  cameFromField: boolean
  /**
   * State-editing mode (the Figma interactive-components model): non-null
   * while a states-bar chip is active — inspector/handle edits record as that
   * state's override diff instead of touching the base.
   */
  editingState: string | null
  /** Live preview: canvas triggers fire so the user can feel the choreography. */
  statePreview: boolean
  /** Selected field slot (chip bar edits its slot-layer overrides). */
  selectedSlot: number | null
  setEditingState(name: string | null): void
  setStatePreview(on: boolean): void
  setStateTransition(name: string, patch: { duration?: number; ease?: string }): void
  /** Per-control reset: drop one recorded override path from a state. */
  clearStateOverride(name: string, path: string): void
  /** Reset-to-base: drop a state's recorded overrides entirely. */
  resetStateOverrides(name: string): void
  setSelectedSlot(i: number | null): void
  /** Record a slot-layer state override (field mode chip bar). */
  patchSlotState(slot: number, state: string, overrides: Record<string, unknown>): void
  clearSlotState(slot: number, state: string): void
  addZone(): void
  patchZone(index: number, patch: Partial<EditorZone>): void
  removeZone(index: number): void
  setMode(mode: EditorMode): void
  patchStage(patch: Partial<StageState>): void
  patchStageConfig(patch: Record<string, unknown>): void
  loadStagePreset(id: string): void
  patchField(patch: Partial<FieldState>): void
  setSlotPreset(index: number, name: string): void
  setAllSlots(name: string): void
  editFieldPaper(name: string): void
  backToField(): void
  userPresets: UserPresetMap
  /** Save (or overwrite) a user preset; rejects built-in names. */
  savePreset(name: string, config: PaperConfig, thumbnail?: string): string | null
  duplicatePreset(source: string): void
  deletePreset(name: string): void
  renamePreset(oldName: string, newName: string): string | null
  importPreset(json: string): string | null
  /** Adopt a paper that arrived on the URL. Returns an error, or null. */
  importSharedPaper(share: PaperShare): string | null
  /** Bumped when the canvas changes params behind the inspector's back (handle drags, transport commits) — remounts the inspector. */
  inspectorEpoch: number
  setPreset(name: string): void
  patchConfig(patch: PaperConfigInput, opts?: { external?: boolean }): void
  setBehaviorType(type: string | null): void
  /** Shallow-merge surface effects; `undefined` removes an effect (mergeConfig can't). */
  setSurface(patch: Partial<SurfaceConfig>): void
  /** Select 'none' | idle name | 'cloth'. Cloth clears the behavior — they're exclusive. */
  setPhysics(name: string): void
  patchCloth(patch: Partial<ClothConfig>): void
}

export interface WriteOpts {
  /** The canvas changed params behind the inspector's back — remount it. */
  external?: boolean
}

/**
 * The single state-aware write path. When a states-bar chip is active the patch
 * records into that state's override diff (via the library's recordStateOverride)
 * and the base is untouched; otherwise it merges into the base (mergeWithDeletes,
 * so `undefined` clears a key). EVERY config setter routes here, so state-editing
 * is enforced in exactly one place.
 */
export function writeConfig(
  s: EditorState,
  patch: Record<string, unknown>,
  opts: WriteOpts = {},
): Pick<EditorState, 'config' | 'inspectorEpoch'> {
  const inspectorEpoch = opts.external ? s.inspectorEpoch + 1 : s.inspectorEpoch
  if (s.editingState) {
    // Overrides SET base params, never remove them — a no-op patch (all
    // undefined) leaves the config untouched.
    if (Object.values(patch).every((v) => v === undefined)) return { config: s.config, inspectorEpoch }
    return { config: recordStateOverride(s.config, s.editingState, patch), inspectorEpoch }
  }
  return {
    config: paperConfigSchema.parse(mergeWithDeletes(s.config as Record<string, unknown>, patch)),
    inspectorEpoch,
  }
}

// Boot: hydrate the library's runtime registry from localStorage. This has to
// happen before the session is read — a remembered paper may BE a user preset,
// and the session's names are checked against the live registry.
const bootUserPresets = loadUserPresets()
syncRegistry(bootUserPresets)

// …then reopen on whatever was last on screen. Null means a first visit, or a
// session this build cannot read, and both land on the default paper.
const bootSession = readSession()

/** A stage preset unpacked into the editor's own editable shape. */
function stageStateFrom(id: string): StageState {
  const preset = getStagePreset(id)
  const walk =
    walkNames.find((name) => JSON.stringify(walks[name]) === JSON.stringify(preset.stage.path)) ?? 'straight'
  const { path: _path, ...config } = preset.stage
  return {
    preset: id,
    walk,
    layout: preset.layout,
    layoutOptions: { ...preset.layoutOptions },
    text: preset.text ?? '',
    count: preset.count,
    progress: 0.42,
    // Opens walking. A stage that opens as a still photograph of itself is
    // the mode's whole point missed — and the scrubber no longer needs the
    // pause, because touching it takes over, the way the Paper tab's
    // timeline already behaves.
    playing: true,
    config,
    paper: preset.paper,
    quality: 'auto',
    settled: null,
  }
}

const DEFAULT_PRESET = 'receipt-unroll'

const DEFAULT_FIELD: FieldState = {
  layout: 'ring',
  layoutOptions: {},
  count: 14,
  driver: 'autoplay',
  speed: 0.5,
  entrance: 'rise',
  // `blank-sheet`, not `photo-print`: the slot pool fills these with card
  // content, and a museum label printed on gloss photo stock is the wrong
  // material. Matte printer stock is what a card is cut from.
  slots: Array.from({ length: 14 }, () => 'blank-sheet'),
  slotStates: {},
  zones: [],
}

export const useEditor = create<EditorState>((set, get) => ({
  userPresets: bootUserPresets,
  presetName: bootSession?.paper?.name ?? DEFAULT_PRESET,
  config: bootSession?.paper?.config ?? getPreset(DEFAULT_PRESET),
  inspectorEpoch: 0,
  mode: bootSession?.mode ?? 'paper',
  field: bootSession?.field ?? DEFAULT_FIELD,
  // A remembered stage keeps the space you picked and the edits you made to
  // it; the transport (playing, progress) is not part of the view.
  stage: bootSession?.stage
    ? { ...stageStateFrom(bootSession.stage.preset), ...bootSession.stage }
    : stageStateFrom('nave'),
  cameFromField: false,
  editingState: null,
  statePreview: false,
  selectedSlot: null,
  setEditingState: (name) =>
    set((s) => ({ editingState: name, statePreview: false, inspectorEpoch: s.inspectorEpoch + 1 })),
  setStatePreview: (on) =>
    set((s) => ({
      statePreview: on,
      editingState: on ? null : s.editingState,
      inspectorEpoch: s.inspectorEpoch + 1,
    })),
  setStateTransition: (name, patch) =>
    set((s) => {
      const states = s.config.states ?? paperStatesSchema.parse({})
      const def = states.states[name] ?? stateDefSchema.parse({})
      return {
        config: paperConfigSchema.parse({
          ...s.config,
          states: {
            ...states,
            states: {
              ...states.states,
              [name]: { ...def, transition: { ...def.transition, ...patch } },
            },
          },
        }),
      }
    }),
  clearStateOverride: (name, path) =>
    set((s) => {
      const def = s.config.states?.states[name]
      if (!def) return s
      const overrides = JSON.parse(JSON.stringify(def.overrides)) as Record<string, unknown>
      const keys = path.split('.')
      let node: Record<string, unknown> | undefined = overrides
      for (let i = 0; i < keys.length - 1 && node; i++) {
        node = node[keys[i]!] as Record<string, unknown> | undefined
      }
      if (node) delete node[keys[keys.length - 1]!]
      return {
        config: paperConfigSchema.parse({
          ...s.config,
          states: {
            ...s.config.states!,
            states: { ...s.config.states!.states, [name]: { ...def, overrides } },
          },
        }),
        inspectorEpoch: s.inspectorEpoch + 1,
      }
    }),
  resetStateOverrides: (name) =>
    set((s) => {
      const def = s.config.states?.states[name]
      if (!def) return s
      return {
        config: paperConfigSchema.parse({
          ...s.config,
          states: {
            ...s.config.states!,
            states: { ...s.config.states!.states, [name]: { ...def, overrides: {} } },
          },
        }),
        inspectorEpoch: s.inspectorEpoch + 1,
      }
    }),
  setSelectedSlot: (i) => set({ selectedSlot: i }),
  patchSlotState: (slot, state, overrides) =>
    set((s) => {
      const existing = s.field.slotStates[slot] ?? {}
      const existingDef = existing.states?.[state]
      const merged: PaperStatesInput = {
        ...existing,
        states: {
          ...existing.states,
          [state]: {
            ...existingDef,
            overrides: mergeConfig(existingDef?.overrides ?? {}, overrides) as Record<string, unknown>,
          },
        },
      }
      return { field: { ...s.field, slotStates: { ...s.field.slotStates, [slot]: merged } } }
    }),
  clearSlotState: (slot, state) =>
    set((s) => {
      const existing = s.field.slotStates[slot]
      if (!existing?.states?.[state]) return s
      const states = { ...existing.states }
      delete states[state]
      const slotStates = { ...s.field.slotStates }
      if (Object.keys(states).length === 0 && !existing.initial) delete slotStates[slot]
      else slotStates[slot] = { ...existing, states }
      return {
        field: { ...s.field, slotStates },
        inspectorEpoch: s.inspectorEpoch + 1,
      }
    }),
  addZone: () =>
    set((s) => {
      let n = s.field.zones.length + 1
      let id = `zone-${n}`
      while (s.field.zones.some((z) => z.id === id)) id = `zone-${++n}`
      const zone: EditorZone = {
        id,
        accept: '',
        // Off to the right of the field — visible, not on top of the papers.
        position: [2.8, 0, 0],
        size: [1.6, 1.1],
        highlight: 'glow',
      }
      // No epoch bump. The inspector derives the zone rows from this list on
      // every render, so it needs no remount — and remounting collapses the
      // Drop zones folder, which is the folder the button lives in. Adding a
      // zone would close the panel on the zone you just added. Same reason
      // the surface toggles don't bump.
      return { field: { ...s.field, zones: [...s.field.zones, zone] } }
    }),
  patchZone: (index, patch) =>
    set((s) => ({
      field: {
        ...s.field,
        zones: s.field.zones.map((z, i) => (i === index ? { ...z, ...patch } : z)),
      },
    })),
  removeZone: (index) =>
    set((s) => ({ field: { ...s.field, zones: s.field.zones.filter((_, i) => i !== index) } })),
  setMode: (mode) =>
    set((s) => ({
      mode,
      editingState: null,
      statePreview: false,
      selectedSlot: null,
      inspectorEpoch: s.inspectorEpoch + 1,
    })),
  // A patch that changes nothing returns the SAME stage object, so it does
  // not notify. The scene reports things back up here every time it settles
  // — the quality tier most of all — and a store that hands out a fresh
  // object for a no-op turns each of those reports into a re-render, which
  // is exactly the loop that made stage mode unusable.
  patchStage: (patch) =>
    set((s) => {
      const changed = Object.entries(patch).some(([key, value]) => s.stage[key as keyof StageState] !== value)
      return changed ? { stage: { ...s.stage, ...patch } } : s
    }),
  loadStagePreset: (id) =>
    set((s) => ({
      // A preset replaces the stage wholesale rather than merging: half of
      // "archive" over half of "threshold" is a space nobody designed.
      stage: { ...stageStateFrom(id), progress: s.stage.progress, playing: s.stage.playing },
      inspectorEpoch: s.inspectorEpoch + 1,
    })),
  patchStageConfig: (patch) =>
    set((s) => ({ stage: { ...s.stage, config: { ...s.stage.config, ...patch } } })),
  patchField: (patch) =>
    set((s) => {
      const field = { ...s.field, ...patch }
      // The count slider resizes the slot list; new slots copy the last one.
      if (patch.count !== undefined && patch.count !== s.field.slots.length) {
        const fill = s.field.slots[s.field.slots.length - 1] ?? 'photo-print'
        field.slots = Array.from({ length: patch.count }, (_, i) => s.field.slots[i] ?? fill)
      }
      // Switching INTO the sheet layout seeds the stamp-block demo.
      if (patch.layout === 'sheet' && s.field.layout !== 'sheet') {
        const o = sheetLayoutSchema.parse(field.layoutOptions)
        field.count = o.rows * o.columns
        field.slots = Array.from({ length: field.count }, () => 'postage-stamp')
        field.driver = 'none'
        field.entrance = 'none'
      }
      // A sheet's population is its grid: rows × columns drive the count.
      if (field.layout === 'sheet' && patch.layoutOptions !== undefined) {
        const o = sheetLayoutSchema.parse(field.layoutOptions)
        const count = o.rows * o.columns
        if (count !== field.slots.length) {
          const fill = field.slots[field.slots.length - 1] ?? 'postage-stamp'
          field.count = count
          field.slots = Array.from({ length: count }, (_, i) => field.slots[i] ?? fill)
        }
      }
      return {
        field,
        inspectorEpoch: patch.layout !== undefined ? s.inspectorEpoch + 1 : s.inspectorEpoch,
      }
    }),
  setSlotPreset: (index, name) =>
    set((s) => ({
      field: { ...s.field, slots: s.field.slots.map((v, i) => (i === index ? name : v)) },
    })),
  setAllSlots: (name) => set((s) => ({ field: { ...s.field, slots: s.field.slots.map(() => name) } })),
  editFieldPaper: (name) =>
    set((s) => ({
      mode: 'paper',
      cameFromField: true,
      presetName: name,
      config: s.presetName === name ? s.config : getPreset(name),
      inspectorEpoch: s.inspectorEpoch + 1,
    })),
  backToField: () =>
    set((s) => ({ mode: 'field', cameFromField: false, inspectorEpoch: s.inspectorEpoch + 1 })),
  setPreset: (name) =>
    set({ presetName: name, config: getPreset(name), editingState: null, statePreview: false }),
  // Every config setter below delegates to writeConfig — the ONE place that
  // decides base-vs-state-override, so a live state chip can never be bypassed.
  patchConfig: (patch, opts) =>
    set((s) => writeConfig(s, patch as Record<string, unknown>, { external: opts?.external })),
  setBehaviorType: (type) =>
    set((s) => writeConfig(s, { behavior: type ? behaviorConfigSchema.parse({ type }) : undefined })),
  // Toggling an effect on/off adds or removes controls; the inspector derives
  // its rows from the config on every render, so that needs no remount — and
  // remounting would collapse the folder the toggle lives in.
  setSurface: (patch) => set((s) => writeConfig(s, { surface: patch })),
  setPhysics: (name) =>
    set((s) =>
      writeConfig(
        s,
        // Cloth owns the vertices — Shape and Simulation are a segmented choice,
        // not two toggles, so switching TO cloth clears behavior/deformers.
        name === 'cloth'
          ? { physics: clothConfigSchema.parse({ type: 'cloth' }), behavior: undefined, deformers: undefined }
          : { physics: name },
      ),
    ),
  patchCloth: (patch) =>
    set((s) => {
      if (typeof s.config.physics !== 'object') return s
      return writeConfig(s, { physics: patch })
    }),

  savePreset: (name, config, thumbnail) => {
    const trimmed = name.trim()
    if (!trimmed) return 'Preset needs a name.'
    if (isBuiltinPreset(trimmed)) return `"${trimmed}" is a built-in — pick another name.`
    const named = paperConfigSchema.parse({ ...config, meta: { ...config.meta, name: trimmed } })
    const stored: StoredPreset = {
      config: diffConfig(named),
      thumbnail,
      savedAt: new Date().toISOString(),
    }
    set((s) => {
      const userPresets = { ...s.userPresets, [trimmed]: stored }
      persistUserPresets(userPresets)
      syncRegistry(userPresets)
      return { userPresets, presetName: trimmed, config: named, inspectorEpoch: s.inspectorEpoch + 1 }
    })
    return null
  },

  duplicatePreset: (source) => {
    const base = getPreset(source)
    const name = uniquePresetName(
      `${source} copy`,
      (n) => isBuiltinPreset(n) || Boolean(get().userPresets[n]),
    )
    get().savePreset(name, base)
  },

  deletePreset: (name) =>
    set((s) => {
      const userPresets = { ...s.userPresets }
      delete userPresets[name]
      persistUserPresets(userPresets)
      syncRegistry(userPresets, [name])
      return {
        userPresets,
        // Field slots referencing the deleted preset fall back.
        field: {
          ...s.field,
          slots: s.field.slots.map((slot) => (slot === name ? 'photo-print' : slot)),
        },
        inspectorEpoch: s.inspectorEpoch + 1,
      }
    }),

  renamePreset: (oldName, newName) => {
    const trimmed = newName.trim()
    if (!trimmed || trimmed === oldName) return null
    if (isBuiltinPreset(trimmed) || get().userPresets[trimmed]) {
      return `"${trimmed}" is already taken.`
    }
    set((s) => {
      const stored = s.userPresets[oldName]
      if (!stored) return s
      const userPresets = { ...s.userPresets }
      delete userPresets[oldName]
      const config = parsePreset(stored.config)
      userPresets[trimmed] = {
        ...stored,
        config: diffConfig(paperConfigSchema.parse({ ...config, meta: { ...config.meta, name: trimmed } })),
      }
      persistUserPresets(userPresets)
      syncRegistry(userPresets, [oldName])
      return {
        userPresets,
        presetName: s.presetName === oldName ? trimmed : s.presetName,
        field: {
          ...s.field,
          slots: s.field.slots.map((slot) => (slot === oldName ? trimmed : slot)),
        },
        inspectorEpoch: s.inspectorEpoch + 1,
      }
    })
    return null
  },

  // A shared paper lands as a normal user preset — editable, renameable,
  // deletable. Opening someone's link should hand you a fork, not a
  // read-only view: remixing it IS the point.
  importSharedPaper: (share) => {
    const name = uniquePresetName(share.name, (n) => isBuiltinPreset(n) || Boolean(get().userPresets[n]))
    try {
      return get().savePreset(name, paperConfigSchema.parse(share.config))
    } catch (error) {
      return `That link isn't a paper this build can open: ${
        error instanceof Error ? error.message.slice(0, 120) : error
      }`
    }
  },
  importPreset: (json) => {
    try {
      const config = parsePreset(json)
      // Disambiguate from the COMPUTED base ('imported' for untitled), not the
      // raw meta.name — an untitled collision must yield 'imported 2'.
      const base = config.meta.name === 'untitled' ? 'imported' : config.meta.name
      const name = uniquePresetName(base, (n) => isBuiltinPreset(n) || Boolean(get().userPresets[n]))
      return get().savePreset(name, config)
    } catch (error) {
      return `Not a valid .paper file: ${error instanceof Error ? error.message.slice(0, 120) : error}`
    }
  },
}))
