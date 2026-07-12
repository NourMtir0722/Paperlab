import { describe, expect, it } from 'vitest'
import { paperConfigSchema } from './schema'
import { mergeConfig, mergeWithDeletes, parsePreset, serializePreset } from './serialize'
import {
  getPreset,
  isBuiltinPreset,
  listPresets,
  registerPreset,
  unregisterPreset,
} from './presets'

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

  it('content.back: letter front, kraft-image back (spec §4.6)', () => {
    const config = paperConfigSchema.parse({
      content: {
        type: 'text',
        text: 'front side',
        back: { type: 'image', src: '/kraft.jpg' },
      },
    })
    expect(config.content.back).toMatchObject({ type: 'image', src: '/kraft.jpg', fit: 'cover' })
    // The back slot is single-level — no back-of-back.
    expect(() =>
      paperConfigSchema.parse({
        content: { type: 'text', text: 'x', back: { type: 'text', text: 'y', back: { type: 'blank' } } },
      }),
    ).not.toThrow() // unknown keys are stripped, not fatal
    const reparsed = paperConfigSchema.parse(JSON.parse(JSON.stringify(config)))
    expect(reparsed).toEqual(config)
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

describe('mergeWithDeletes (base-config writes)', () => {
  it('deep-merges like mergeConfig but an explicit undefined DELETES its key', () => {
    // Clearing a top-level structural key (behavior/deformers) — what mergeConfig
    // silently ignored, which is why setPhysics/setBehaviorType could not clear.
    expect(mergeWithDeletes({ stock: 'kraft', behavior: { type: 'peel' } }, { behavior: undefined })).toEqual({
      stock: 'kraft',
    })
    // Nested delete: toggling a surface effect off.
    expect(
      mergeWithDeletes(
        { surface: { grain: 0.4, deckle: { edges: ['bottom'] } } },
        { surface: { deckle: undefined } },
      ),
    ).toEqual({ surface: { grain: 0.4 } })
  })

  it('still replaces discriminated unions wholesale and keeps mergeConfig semantics for defined values', () => {
    expect(
      mergeWithDeletes(
        { content: { type: 'image', src: '/a.jpg' } },
        { content: { type: 'text', text: 'hi' } },
      ),
    ).toEqual({ content: { type: 'text', text: 'hi' } })
    expect(mergeWithDeletes({ sheet: { width: 1, height: 2 } }, { sheet: { width: 3 } })).toEqual({
      sheet: { width: 3, height: 2 },
    })
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

describe('user preset registry', () => {
  it('registers, resolves, lists and unregisters user presets', () => {
    registerPreset('my-note', { stock: 'kraft', content: { type: 'text', text: 'hi' } })
    expect(getPreset('my-note').stock).toBe('kraft')
    expect(listPresets()).toContain('my-note')
    expect(isBuiltinPreset('my-note')).toBe(false)
    expect(isBuiltinPreset('receipt-unroll')).toBe(true)
    unregisterPreset('my-note')
    expect(() => getPreset('my-note')).toThrow(/Unknown preset/)
  })

  it('reserves built-in names and rejects invalid configs', () => {
    expect(() => registerPreset('receipt-unroll', {})).toThrow(/built-in/)
    expect(() => registerPreset('bad', { stock: 'papyrus' as never })).toThrow()
    expect(listPresets()).not.toContain('bad')
  })
})
