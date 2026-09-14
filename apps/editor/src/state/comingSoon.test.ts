import { describe, expect, it } from 'vitest'
import { listPresets } from 'paperlab'
import { COMING_SOON, comingSoonNote, isComingSoon } from './comingSoon'

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
