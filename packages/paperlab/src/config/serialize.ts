import { paperConfigSchema, type PaperConfig, type PaperConfigInput } from './schema'

export { mergeConfig, mergeWithDeletes } from './merge'

/** Parse anything preset-shaped (object or JSON string) into a full, defaulted config. */
export function parsePreset(input: PaperConfigInput | string): PaperConfig {
  const raw = typeof input === 'string' ? JSON.parse(input) : input
  return paperConfigSchema.parse(raw)
}

/** Serialize a config to `.paper` JSON. */
export function serializePreset(config: PaperConfig): string {
  return JSON.stringify(config, null, 2)
}
