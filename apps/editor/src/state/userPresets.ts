import { paperConfigSchema, registerPreset, unregisterPreset, type PaperConfigInput } from 'paperlab'

/**
 * User preset persistence: localStorage, versioned key. The library's
 * runtime registry (registerPreset) is the live view; this module is the
 * disk. Invalid records are dropped silently on load — a schema migration
 * story arrives when the schema version actually changes.
 */

const STORAGE_KEY = 'paperlab.userPresets.v1'

export interface StoredPreset {
  config: PaperConfigInput
  /** Small JPEG data-URL captured from the viewport at save time. */
  thumbnail?: string
  savedAt: string
}

export type UserPresetMap = Record<string, StoredPreset>

export function loadUserPresets(): UserPresetMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as UserPresetMap
    const valid: UserPresetMap = {}
    for (const [name, stored] of Object.entries(parsed)) {
      const result = paperConfigSchema.safeParse(stored.config)
      if (result.success) valid[name] = stored
    }
    return valid
  } catch {
    return {}
  }
}

/**
 * What became of a write to localStorage.
 *
 * `session-only` is the one that matters. The presets are live in the
 * registry and fully editable, but nothing reached disk, so they die with
 * the tab. That outcome used to be swallowed here and reported to the user
 * as a plain "Saved" — the worst shape a failure can have, because the way
 * you find out is by losing the work.
 *
 * It is reachable: an uploaded image lands in a config as a data URL of
 * ~100KB and up, and a handful of those clears a 5MB quota.
 */
export type PersistOutcome = 'stored' | 'thumbnails-dropped' | 'session-only'

export function persistUserPresets(presets: UserPresetMap): PersistOutcome {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
    return 'stored'
  } catch {
    // Quota exceeded (thumbnails add up) — drop thumbnails and retry once.
    const slim: UserPresetMap = {}
    for (const [name, stored] of Object.entries(presets)) {
      slim[name] = { config: stored.config, savedAt: stored.savedAt }
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slim))
      return 'thumbnails-dropped'
    } catch {
      return 'session-only'
    }
  }
}

/** Sync the library's runtime registry with the stored map. */
export function syncRegistry(presets: UserPresetMap, removed?: string[]): void {
  for (const name of removed ?? []) unregisterPreset(name)
  for (const [name, stored] of Object.entries(presets)) registerPreset(name, stored.config)
}

/** Capture the editor viewport as a small thumbnail (needs preserveDrawingBuffer). */
export function captureThumbnail(): string | undefined {
  const source = document.querySelector<HTMLCanvasElement>('.viewport canvas')
  if (!source) return undefined
  try {
    const thumb = document.createElement('canvas')
    const scale = 168 / source.width
    thumb.width = 168
    thumb.height = Math.round(source.height * scale)
    thumb.getContext('2d')!.drawImage(source, 0, 0, thumb.width, thumb.height)
    return thumb.toDataURL('image/jpeg', 0.72)
  } catch {
    return undefined
  }
}

export function downloadPreset(name: string, config: PaperConfigInput): void {
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name.replace(/[^a-zA-Z0-9-_]+/g, '-')}.paper.json`
  a.click()
  URL.revokeObjectURL(url)
}
