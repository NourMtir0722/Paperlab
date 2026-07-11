import { describe, expect, it } from 'vitest'
import { paperConfigSchema } from './schema'
import { mergeConfig, parsePreset, serializePreset } from './serialize'
import { getPreset, listPresets } from './presets'

describe('paper config schema', () => {
  it('fills every default from an empty object', () => {
    const config = paperConfigSchema.parse({})
    expect(config.sheet).toEqual({
      width: 1,
      height: 1.4,
      thickness: 0.2,
      segments: 'auto',
      cornerRadius: 0,
    })
    expect(config.stock).toBe('printer')
    expect(config.content).toEqual({ type: 'blank' })
    expect(config.physics).toBe('none')
    expect(config.onTwos).toBe(false)
  })

  it('round-trips through .paper JSON', () => {
    const config = paperConfigSchema.parse({
      stock: 'kraft',
      content: { type: 'text', text: 'hello' },
    })
    const reparsed = parsePreset(serializePreset(config))
    expect(reparsed).toEqual(config)
  })

  it('rejects invalid stock names', () => {
    expect(() => paperConfigSchema.parse({ stock: 'papyrus' })).toThrow()
  })

  it('defaults text content sub-fields', () => {
    const config = paperConfigSchema.parse({ content: { type: 'text', text: 'hi' } })
    expect(config.content).toMatchObject({ align: 'left', lineHeight: 1.45 })
  })
})

describe('mergeConfig', () => {
  it('deep-merges plain objects, overrides win', () => {
    const out = mergeConfig({ sheet: { width: 1, height: 2 }, stock: 'printer' }, {
      sheet: { width: 3 },
    })
    expect(out).toEqual({ sheet: { width: 3, height: 2 }, stock: 'printer' })
  })

  it('replaces discriminated unions wholesale when type changes', () => {
    const out = mergeConfig(
      { content: { type: 'image', src: '/a.jpg', fit: 'cover' } },
      { content: { type: 'text', text: 'hi' } },
    )
    expect(out.content).toEqual({ type: 'text', text: 'hi' })
  })

  it('ignores undefined overrides', () => {
    expect(mergeConfig({ a: 1 }, undefined)).toEqual({ a: 1 })
  })
})

describe('built-in presets', () => {
  it('every built-in parses against the schema', () => {
    for (const name of listPresets()) {
      expect(() => getPreset(name)).not.toThrow()
    }
  })

  it('throws a helpful error for unknown presets', () => {
    expect(() => getPreset('nope')).toThrow(/Unknown preset/)
  })
})
