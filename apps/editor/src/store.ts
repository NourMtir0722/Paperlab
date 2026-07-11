import { create } from 'zustand'
import {
  behaviorConfigSchema,
  clothConfigSchema,
  diffConfig,
  getPreset,
  isBuiltinPreset,
  mergeConfig,
  paperConfigSchema,
  parsePreset,
  type ClothConfig,
  type PaperConfig,
  type PaperConfigInput,
  type SurfaceConfig,
} from 'paperlab'
import {
  loadUserPresets,
  persistUserPresets,
  syncRegistry,
  type StoredPreset,
  type UserPresetMap,
} from './userPresets'

export interface FieldState {
  layout: string
  layoutOptions: Record<string, unknown>
  count: number
  driver: 'autoplay' | 'drag' | 'none'
  speed: number
  entrance: 'rise' | 'scatter' | 'none'
  /** Preset name per slot — each field slot references a preset (components). */
  slots: string[]
}

interface EditorState {
  presetName: string
  config: PaperConfig
  mode: 'paper' | 'field'
  field: FieldState
  /** True while editing a paper that was opened from the Field Composer. */
  cameFromField: boolean
  setMode(mode: 'paper' | 'field'): void
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

// Boot: hydrate the library's runtime registry from localStorage.
const bootUserPresets = loadUserPresets()
syncRegistry(bootUserPresets)

export const useEditor = create<EditorState>((set, get) => ({
  userPresets: bootUserPresets,
  presetName: 'receipt-unroll',
  config: getPreset('receipt-unroll'),
  inspectorEpoch: 0,
  mode: 'paper',
  field: {
    layout: 'ring',
    layoutOptions: {},
    count: 14,
    driver: 'autoplay',
    speed: 0.5,
    entrance: 'rise',
    slots: Array.from({ length: 14 }, () => 'photo-print'),
  },
  cameFromField: false,
  setMode: (mode) => set((s) => ({ mode, inspectorEpoch: s.inspectorEpoch + 1 })),
  patchField: (patch) =>
    set((s) => {
      const field = { ...s.field, ...patch }
      // The count slider resizes the slot list; new slots copy the last one.
      if (patch.count !== undefined && patch.count !== s.field.slots.length) {
        const fill = s.field.slots[s.field.slots.length - 1] ?? 'photo-print'
        field.slots = Array.from({ length: patch.count }, (_, i) => s.field.slots[i] ?? fill)
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
  setAllSlots: (name) =>
    set((s) => ({ field: { ...s.field, slots: s.field.slots.map(() => name) } })),
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
  setPreset: (name) => set({ presetName: name, config: getPreset(name) }),
  patchConfig: (patch, opts) =>
    set((s) => ({
      config: paperConfigSchema.parse(mergeConfig(get().config as PaperConfigInput, patch)),
      inspectorEpoch: opts?.external ? s.inspectorEpoch + 1 : s.inspectorEpoch,
    })),
  setBehaviorType: (type) =>
    set((s) => ({
      config: {
        ...s.config,
        behavior: type ? behaviorConfigSchema.parse({ type }) : undefined,
      },
      inspectorEpoch: s.inspectorEpoch + 1,
    })),
  setSurface: (patch) =>
    set((s) => {
      const surface: Record<string, unknown> = { ...s.config.surface }
      // Toggling an effect on/off changes the control structure — leva needs
      // a remount (epoch bump). Value edits don't.
      let structureChanged = false
      for (const [key, value] of Object.entries(patch)) {
        const existed = surface[key] !== undefined
        if (value === undefined) delete surface[key]
        else surface[key] = value
        if (existed !== (value !== undefined)) structureChanged = true
      }
      return {
        config: paperConfigSchema.parse({ ...s.config, surface }),
        inspectorEpoch: structureChanged ? s.inspectorEpoch + 1 : s.inspectorEpoch,
      }
    }),
  setPhysics: (name) =>
    set((s) => ({
      config: paperConfigSchema.parse({
        ...s.config,
        physics: name === 'cloth' ? clothConfigSchema.parse({ type: 'cloth' }) : name,
        // Cloth owns the vertices — Shape and Simulation are a segmented
        // choice, not two toggles.
        behavior: name === 'cloth' ? undefined : s.config.behavior,
        deformers: name === 'cloth' ? undefined : s.config.deformers,
      }),
      inspectorEpoch: s.inspectorEpoch + 1,
    })),
  patchCloth: (patch) =>
    set((s) => {
      if (typeof s.config.physics !== 'object') return s
      return {
        config: paperConfigSchema.parse({
          ...s.config,
          physics: { ...s.config.physics, ...patch },
        }),
      }
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
    let name = `${source} copy`
    let n = 2
    while (isBuiltinPreset(name) || get().userPresets[name]) name = `${source} copy ${n++}`
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
        config: diffConfig(
          paperConfigSchema.parse({ ...config, meta: { ...config.meta, name: trimmed } }),
        ),
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

  importPreset: (json) => {
    try {
      const config = parsePreset(json)
      let name = config.meta.name === 'untitled' ? 'imported' : config.meta.name
      let n = 2
      while (isBuiltinPreset(name) || get().userPresets[name]) {
        name = `${config.meta.name} ${n++}`
      }
      return get().savePreset(name, config)
    } catch (error) {
      return `Not a valid .paper file: ${error instanceof Error ? error.message.slice(0, 120) : error}`
    }
  },
}))
