import { create } from 'zustand'
import {
  behaviorConfigSchema,
  clothConfigSchema,
  getPreset,
  mergeConfig,
  paperConfigSchema,
  type ClothConfig,
  type PaperConfig,
  type PaperConfigInput,
  type SurfaceConfig,
} from 'paperlab'

export interface FieldState {
  layout: string
  layoutOptions: Record<string, unknown>
  count: number
  driver: 'autoplay' | 'drag' | 'none'
  speed: number
  entrance: 'rise' | 'scatter' | 'none'
  /** The preset every field instance references — presets are components. */
  presetName: string
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
  editFieldPaper(): void
  backToField(): void
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

export const useEditor = create<EditorState>((set, get) => ({
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
    presetName: 'photo-print',
  },
  cameFromField: false,
  setMode: (mode) => set((s) => ({ mode, inspectorEpoch: s.inspectorEpoch + 1 })),
  patchField: (patch) =>
    set((s) => ({
      field: { ...s.field, ...patch },
      inspectorEpoch:
        patch.layout !== undefined ? s.inspectorEpoch + 1 : s.inspectorEpoch,
    })),
  editFieldPaper: () =>
    set((s) => ({
      mode: 'paper',
      cameFromField: true,
      presetName: s.field.presetName,
      config: s.presetName === s.field.presetName ? s.config : getPreset(s.field.presetName),
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
}))
