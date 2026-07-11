import { create } from 'zustand'
import { getPreset, paperConfigSchema, mergeConfig, type PaperConfig, type PaperConfigInput } from 'paperlab'

interface EditorState {
  presetName: string
  config: PaperConfig
  setPreset(name: string): void
  patchConfig(patch: PaperConfigInput): void
}

export const useEditor = create<EditorState>((set, get) => ({
  presetName: 'typed-note',
  config: getPreset('typed-note'),
  setPreset: (name) => set({ presetName: name, config: getPreset(name) }),
  patchConfig: (patch) =>
    set({ config: paperConfigSchema.parse(mergeConfig(get().config as PaperConfigInput, patch)) }),
}))
