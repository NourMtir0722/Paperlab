import { create } from 'zustand'
import {
  behaviorConfigSchema,
  getPreset,
  mergeConfig,
  paperConfigSchema,
  type PaperConfig,
  type PaperConfigInput,
  type SurfaceConfig,
} from 'paperlab'

interface EditorState {
  presetName: string
  config: PaperConfig
  /** Bumped when the canvas changes params behind the inspector's back (handle drags, transport commits) — remounts the inspector. */
  inspectorEpoch: number
  setPreset(name: string): void
  patchConfig(patch: PaperConfigInput, opts?: { external?: boolean }): void
  setBehaviorType(type: string | null): void
  /** Shallow-merge surface effects; `undefined` removes an effect (mergeConfig can't). */
  setSurface(patch: Partial<SurfaceConfig>): void
}

export const useEditor = create<EditorState>((set, get) => ({
  presetName: 'receipt-unroll',
  config: getPreset('receipt-unroll'),
  inspectorEpoch: 0,
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
}))
