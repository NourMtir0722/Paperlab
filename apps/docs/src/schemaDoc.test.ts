import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { getBehavior, getLayout } from 'paperlab'
import { describeSchema } from './schemaDoc'

const row = (rows: ReturnType<typeof describeSchema>, key: string) => {
  const found = rows.find((r) => r.key === key)
  if (!found) throw new Error(`no row "${key}" in [${rows.map((r) => r.key).join(', ')}]`)
  return found
}

describe('describeSchema', () => {
  it('reads a bounded number’s range and default off the checks', () => {
    const rows = describeSchema(z.object({ tightness: z.number().min(0.2).max(3).default(1) }))
    expect(row(rows, 'tightness')).toMatchObject({ type: 'number', range: '0.2 – 3', fallback: '1' })
  })

  it('lists an enum’s options and unwraps default/optional to find them', () => {
    const rows = describeSchema(z.object({ corner: z.enum(['top-left', 'auto']).default('auto').optional() }))
    expect(row(rows, 'corner')).toMatchObject({
      type: 'one of',
      options: ['top-left', 'auto'],
      fallback: "'auto'",
    })
  })

  it('leaves the default blank for a field that has none', () => {
    expect(row(describeSchema(z.object({ src: z.string() })), 'src').fallback).toBeUndefined()
  })

  it('skips the discriminator, which is the name of the thing, not a knob', () => {
    const rows = describeSchema(z.object({ type: z.literal('peel'), progress: z.number() }))
    expect(rows.map((r) => r.key)).toEqual(['progress'])
  })

  it('renders compact defaults for lists and objects', () => {
    const rows = describeSchema(
      z.object({
        edges: z.array(z.string()).default(['bottom']),
        state: z.object({ top: z.string().optional() }).default({}),
      }),
    )
    expect(row(rows, 'edges')).toMatchObject({ type: 'list', fallback: "['bottom']" })
    expect(row(rows, 'state')).toMatchObject({ type: 'object', fallback: '{}' })
  })
})

/**
 * The point of walking the schema is that the page cannot drift from the
 * library. These pin that against two real registry entries — if peel loses a
 * param or ring renames one, the docs change with it and this notices.
 */
describe('against the real registries', () => {
  it('documents every param a behavior actually takes', () => {
    const rows = describeSchema(getBehavior('peel').optionsSchema)
    expect(rows.map((r) => r.key).sort()).toEqual(['corner', 'progress', 'radius'])
    expect(row(rows, 'progress').range).toBe('0 – 1')
  })

  it('documents a layout’s options', () => {
    const rows = describeSchema(getLayout('ring').optionsSchema)
    expect(rows.map((r) => r.key)).toContain('radius')
  })
})
