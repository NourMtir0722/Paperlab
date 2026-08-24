import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPreset, paperConfigSchema, registerPreset, unregisterPreset } from 'paperlab'
import { readSession, writeSession, type SessionInput } from './session'

/** vitest runs in node here, so the session's one dependency gets stubbed. */
function stubStorage() {
  const map = new Map<string, string>()
  const store = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    /** Flip to make every write fail, the way a quota-exceeded browser does. */
    full: false,
    raw: map,
  }
  const guarded = {
    ...store,
    setItem: (k: string, v: string) => {
      if (store.full) throw new Error('QuotaExceededError')
      map.set(k, v)
    },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: guarded, configurable: true })
  return store
}

const KEY = 'paperlab.session.v1'

const baseInput = (): SessionInput => ({
  mode: 'paper',
  presetName: 'receipt-unroll',
  config: getPreset('receipt-unroll'),
  field: {
    layout: 'ring',
    layoutOptions: {},
    count: 2,
    driver: 'autoplay',
    speed: 0.5,
    entrance: 'rise',
    slots: ['photo-print', 'photo-print'],
    slotStates: {},
    zones: [],
  },
  stage: {
    preset: 'nave',
    walk: 'ess',
    layout: 'colonnade',
    layoutOptions: {},
    source: 'words' as const,
    text: 'PAPERLAB',
    images: [],
    count: 8,
    progress: 0.61,
    playing: true,
    config: { lighting: 'nave', showFigure: false },
    quality: 'high',
    settled: 'medium',
  },
})

let storage: ReturnType<typeof stubStorage>
beforeEach(() => {
  storage = stubStorage()
})
afterEach(() => {
  storage.raw.clear()
})

describe('remembering the last session', () => {
  it('is null on a first visit', () => {
    expect(readSession()).toBeNull()
  })

  it('round-trips the paper you were sculpting, not just which preset it forked from', () => {
    const sculpted = paperConfigSchema.parse({
      ...getPreset('receipt-unroll'),
      behavior: { type: 'unroll', progress: 0.42, tightness: 0.9 },
    })
    writeSession({ ...baseInput(), presetName: 'receipt-unroll', config: sculpted })

    const session = readSession()
    expect(session?.paper?.name).toBe('receipt-unroll')
    expect(session?.paper?.config.behavior).toMatchObject({ progress: 0.42, tightness: 0.9 })
  })

  it('writes the diff, so the key stays small', () => {
    const blank = getPreset('blank-sheet')
    writeSession({ ...baseInput(), presetName: 'blank-sheet', config: blank })
    const stored = JSON.parse(storage.raw.get(KEY)!)

    // A bare sheet is nearly all defaults, so its diff is a few characters
    // where the resolved config is every key in the schema.
    expect(JSON.stringify(stored.paper.config).length).toBeLessThan(JSON.stringify(blank).length / 4)
    // And it still resolves back to the same paper.
    expect(readSession()?.paper?.config).toEqual(blank)
  })

  it('keeps the mode and the stage you picked, but not the transport', () => {
    writeSession({ ...baseInput(), mode: 'stage' })
    const session = readSession()
    expect(session?.mode).toBe('stage')
    expect(session?.stage).toMatchObject({ preset: 'nave', walk: 'ess', text: 'PAPERLAB', count: 8 })
    expect(session?.stage).not.toHaveProperty('progress')
    expect(session?.stage).not.toHaveProperty('playing')
    expect(session?.stage).not.toHaveProperty('settled')
  })

  it('drops a session that does not validate rather than restoring a broken editor', () => {
    storage.raw.set(KEY, 'not json at all')
    expect(readSession()).toBeNull()
    storage.raw.set(KEY, JSON.stringify({ mode: 'sideways' }))
    expect(readSession()).toBeNull()
    // A config the schema rejects — the same bar a shared link has to clear.
    storage.raw.set(
      KEY,
      JSON.stringify({ mode: 'paper', paper: { name: 'x', config: { sheet: { width: 'wide' } } } }),
    )
    expect(readSession()).toBeNull()
  })

  it('clears the key instead of leaving a stale view when the write cannot fit', () => {
    writeSession(baseInput())
    expect(storage.raw.has(KEY)).toBe(true)
    storage.full = true
    writeSession({ ...baseInput(), presetName: 'blank-sheet' })
    expect(storage.raw.has(KEY)).toBe(false)
  })
})

describe('a remembered session names things that may be gone', () => {
  it('falls a field slot back when its preset no longer exists', () => {
    registerPreset('gone-tomorrow', getPreset('photo-print'))
    const input = baseInput()
    input.field.slots = ['gone-tomorrow', 'photo-print']
    writeSession({ ...input, mode: 'field' })
    unregisterPreset('gone-tomorrow')

    expect(readSession()?.field?.slots).toEqual(['photo-print', 'photo-print'])
  })

  it('takes the field population from the slot list, not a count that disagrees', () => {
    const input = baseInput()
    input.field.slots = ['photo-print', 'photo-print', 'photo-print']
    input.field.count = 99
    writeSession({ ...input, mode: 'field' })

    expect(readSession()?.field?.count).toBe(3)
  })

  it('drops a field whose layout this build does not have, and lands on the paper', () => {
    const input = baseInput()
    input.field.layout = 'helix-from-the-future'
    writeSession({ ...input, mode: 'field' })

    const session = readSession()
    expect(session?.field).toBeUndefined()
    expect(session?.mode).toBe('paper')
  })

  it('drops a stage whose preset this build does not have, and lands on the paper', () => {
    const input = baseInput()
    input.stage.preset = 'cathedral-of-the-future'
    writeSession({ ...input, mode: 'stage' })

    const session = readSession()
    expect(session?.stage).toBeUndefined()
    expect(session?.mode).toBe('paper')
  })
})
