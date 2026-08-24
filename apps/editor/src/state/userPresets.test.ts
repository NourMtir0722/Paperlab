import { afterEach, describe, expect, it } from 'vitest'
import { loadUserPresets, persistUserPresets, type UserPresetMap } from './userPresets'

/**
 * vitest runs in node, so localStorage is stubbed — with a byte budget,
 * because the outcome under test is precisely what happens as a real
 * browser's quota runs out.
 */
function stubStorage(limit = Number.POSITIVE_INFINITY) {
  const map = new Map<string, string>()
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => {
      if (v.length > limit) throw new Error('QuotaExceededError')
      map.set(k, v)
    },
    raw: map,
  }
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
  return storage
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage')
})

const preset = (thumbnailBytes: number): UserPresetMap => ({
  mine: {
    config: { meta: { name: 'mine' } },
    thumbnail: `data:image/jpeg;base64,${'A'.repeat(thumbnailBytes)}`,
    savedAt: '2026-08-24T00:00:00.000Z',
  },
})

describe('persisting user presets', () => {
  it('reports a clean write', () => {
    const storage = stubStorage()
    expect(persistUserPresets(preset(100))).toBe('stored')
    expect(storage.raw.size).toBe(1)
  })

  it('drops thumbnails to fit, and says that is what it did', () => {
    // Budget sits between the full record (519 bytes) and the same record
    // without its picture (81), so the retry is the write that lands.
    stubStorage(200)
    expect(persistUserPresets(preset(400))).toBe('thumbnails-dropped')
  })

  it('keeps the config when it drops the thumbnail', () => {
    // The retry must shed the picture and nothing else — a preset that
    // survives as a name with no paper attached is not a preset that survived.
    const storage = stubStorage(200)
    persistUserPresets(preset(400))
    const written = JSON.parse([...storage.raw.values()][0]!) as UserPresetMap
    expect(written.mine?.thumbnail).toBeUndefined()
    expect(written.mine?.config).toEqual({ meta: { name: 'mine' } })
  })

  it('reports session-only when even the slim write will not fit', () => {
    // The case that used to be swallowed and shown to the user as "Saved":
    // the preset is live in the registry, and nothing reached the disk.
    stubStorage(10)
    expect(persistUserPresets(preset(400))).toBe('session-only')
  })

  it('reports session-only rather than throwing where there is no storage', () => {
    // Private windows and embedded webviews reach the accessor and throw.
    expect(() => persistUserPresets(preset(10))).not.toThrow()
    expect(persistUserPresets(preset(10))).toBe('session-only')
  })

  it('reads back what it wrote', () => {
    stubStorage()
    persistUserPresets(preset(10))
    expect(Object.keys(loadUserPresets())).toEqual(['mine'])
  })

  it('drops a record the schema no longer accepts instead of failing the load', () => {
    const storage = stubStorage()
    storage.setItem(
      'paperlab.userPresets.v1',
      JSON.stringify({ good: preset(10).mine, bad: { config: { sheet: { width: 'wide' } } } }),
    )
    expect(Object.keys(loadUserPresets())).toEqual(['good'])
  })
})
