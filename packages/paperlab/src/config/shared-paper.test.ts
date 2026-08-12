import { describe, expect, it } from 'vitest'
import { getPreset, listPresets, registerPreset, unregisterPreset } from './presets'
import { diffConfig } from './diff'
import { paperConfigSchema } from './schema'
import { serializePreset, parsePreset } from './serialize'

/**
 * The contract the README makes to anyone handed a `.paper` file: it is a
 * preset object, it goes straight into `<Paper preset={…} />`, and nothing
 * is lost on the way. That promise is the whole community loop — make a
 * paper, send it, someone else ships it — so it gets a test rather than a
 * paragraph.
 *
 * "On disk" here is deliberately round-tripped through JSON.parse/stringify:
 * a file that crossed a network is plain data with no prototypes, no
 * undefined, and no class instances hiding in it.
 */
const onDisk = (name: string) => JSON.parse(JSON.stringify(diffConfig(getPreset(name)))) as unknown

describe('a .paper file someone shared with you', () => {
  it('is a preset object — it parses back to exactly what was sent', () => {
    for (const name of ['receipt-unroll', 'hero-peel', 'letter-fold', 'postage-stamp']) {
      expect(paperConfigSchema.parse(onDisk(name)), name).toEqual(getPreset(name))
    }
  })

  it('survives the editor download path (serialize → text → parse)', () => {
    const text = serializePreset(getPreset('vintage-note'))
    expect(parsePreset(text)).toEqual(getPreset('vintage-note'))
  })

  it('can be registered under a name and retrieved by it', () => {
    const shared = onDisk('hero-peel')
    try {
      registerPreset('a-shared-paper', shared as never)
      expect(getPreset('a-shared-paper')).toEqual(getPreset('hero-peel'))
      expect(listPresets()).toContain('a-shared-paper')
    } finally {
      unregisterPreset('a-shared-paper')
    }
  })

  it('rejects a file that is not a paper, rather than rendering nonsense', () => {
    expect(() => parsePreset('{"stock":"unobtainium"}')).toThrow()
    expect(() => parsePreset('not json at all')).toThrow()
  })
})
