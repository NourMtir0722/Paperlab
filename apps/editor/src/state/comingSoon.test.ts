import { describe, expect, it } from 'vitest'
import { listPresets } from 'paperlab'
import { COMING_SOON, comingSoonNote, isComingSoon, objectComingSoonNote, withOpenObject } from './comingSoon'

describe('the presets the editor keeps closed', () => {
  it('names only presets that exist', () => {
    // A renamed preset would otherwise quietly open again, and a typo would
    // close nothing at all.
    const presets = new Set(listPresets())
    for (const name of COMING_SOON) expect(presets.has(name), `${name} is not a preset`).toBe(true)
  })

  it('never closes a preset the editor falls back to', () => {
    // The first paper anyone sees (store's DEFAULT_PRESET), the Field slots'
    // default, and what a missing or closed slot becomes (session, App).
    for (const name of ['receipt-unroll', 'blank-sheet', 'photo-print']) {
      expect(isComingSoon(name), `${name} is a fallback — closing it strands the editor`).toBe(false)
    }
  })

  it('says why beside a closed option, and nothing beside the rest', () => {
    expect(comingSoonNote('toilet-roll')).toBe('Coming soon')
    expect(comingSoonNote('letter-fold')).toBeNull()
  })
})

describe('the objects the editor keeps closed', () => {
  it('offers only the lemon for now; your own model says it is coming', () => {
    expect(objectComingSoonNote('model')).toBe('Coming soon')
    expect(objectComingSoonNote('lemon')).toBeNull()
  })

  it('draws a config that carries a model on the lemon instead, and leaves the rest alone', () => {
    const withModel = { mount: { object: 'model', model: 'data:model/gltf-binary;base64,AA' } }
    expect(withOpenObject(withModel).mount.object).toBe('lemon')
    // The model is kept, not thrown away: opening the door brings it back.
    expect(withOpenObject(withModel).mount.model).toBe(withModel.mount.model)
    const lemon = { mount: { object: 'lemon' } }
    expect(withOpenObject(lemon)).toBe(lemon)
    const none = { mount: undefined }
    expect(withOpenObject(none)).toBe(none)
  })
})
