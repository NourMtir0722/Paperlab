import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { schemaControls, type Control } from './controlModel'

const byKey = (controls: Control[], key: string) => {
  const found = controls.find((c) => c.key === key)
  if (!found) throw new Error(`no control "${key}" in [${controls.map((c) => c.key).join(', ')}]`)
  return found
}

describe('schemaControls', () => {
  it('maps a bounded number to a slider with min/max from the zod checks', () => {
    const schema = z.object({ tightness: z.number().min(0.2).max(3).default(1) })
    const [ctl] = schemaControls(schema, { tightness: 1.5 }, () => {})
    expect(ctl).toMatchObject({ kind: 'number', key: 'tightness', value: 1.5, min: 0.2, max: 3 })
    if (ctl?.kind !== 'number') throw new Error('expected number')
    expect(ctl.step).toBeCloseTo((3 - 0.2) / 200)
  })

  it('defaults an unbounded number to the 0..1 range and falls back to min when the value is absent', () => {
    const schema = z.object({ progress: z.number() })
    const [ctl] = schemaControls(schema, {}, () => {})
    expect(ctl).toMatchObject({ kind: 'number', value: 0, min: 0, max: 1 })
  })

  it('unwraps default/optional wrappers to find the inner type', () => {
    const schema = z.object({
      wind: z.number().min(0).max(2).default(0.4).optional(),
      pins: z.enum(['top-edge', 'none']).optional(),
    })
    const controls = schemaControls(schema, { wind: 0.4, pins: 'none' }, () => {})
    expect(byKey(controls, 'wind')).toMatchObject({ kind: 'number', min: 0, max: 2 })
    expect(byKey(controls, 'pins')).toMatchObject({ kind: 'select', options: ['top-edge', 'none'] })
  })

  it('maps enum→select, boolean→toggle, string→text, and reports edits under the field key', () => {
    const schema = z.object({
      corner: z.enum(['top-left', 'bottom-right']),
      loop: z.boolean(),
      title: z.string(),
    })
    const edits: [string, unknown][] = []
    const controls = schemaControls(schema, { corner: 'top-left', loop: true, title: 'hi' }, (k, v) =>
      edits.push([k, v]),
    )

    const corner = byKey(controls, 'corner')
    if (corner.kind !== 'select') throw new Error('expected select')
    corner.onChange('bottom-right')
    const loop = byKey(controls, 'loop')
    if (loop.kind !== 'toggle') throw new Error('expected toggle')
    loop.onChange(false)
    const title = byKey(controls, 'title')
    if (title.kind !== 'text') throw new Error('expected text')
    title.onChange('bye')

    expect(edits).toEqual([
      ['corner', 'bottom-right'],
      ['loop', false],
      ['title', 'bye'],
    ])
  })

  it('expands a numeric tuple to one slider per axis, and an axis edit reassembles the whole vector', () => {
    const schema = z.object({
      wind: z.tuple([z.number().min(-2).max(2), z.number().min(-1).max(1), z.number().min(-2).max(2)]),
    })
    const edits: [string, unknown][] = []
    const controls = schemaControls(schema, { wind: [0.5, 0, -0.25] }, (k, v) => edits.push([k, v]))

    expect(controls.map((c) => c.key)).toEqual(['windX', 'windY', 'windZ'])
    expect(byKey(controls, 'windY')).toMatchObject({ kind: 'number', label: 'wind y', min: -1, max: 1 })

    const windY = byKey(controls, 'windY')
    if (windY.kind !== 'number') throw new Error('expected number')
    windY.onChange(0.75)
    expect(edits).toEqual([['wind', [0.5, 0.75, -0.25]]])
  })

  it('turns a nested object into a collapsed folder whose edits bubble up as a whole replacement object', () => {
    const schema = z.object({
      figure: z.object({ height: z.number().min(1).max(3), visible: z.boolean() }),
    })
    const edits: [string, unknown][] = []
    const controls = schemaControls(schema, { figure: { height: 1.7, visible: true } }, (k, v) =>
      edits.push([k, v]),
    )

    const figure = byKey(controls, 'figure')
    if (figure.kind !== 'folder') throw new Error('expected folder')
    expect(figure.collapsed).toBe(true)

    const height = byKey(figure.children, 'height')
    if (height.kind !== 'number') throw new Error('expected number')
    height.onChange(2)
    expect(edits).toEqual([['figure', { height: 2, visible: true }]])
  })

  it('keeps duplicate leaf names apart in sibling folders (the leva flatten bug this model retires)', () => {
    // A stage whose shot and figure both carry `height` used to lose one
    // silently — the tree keeps hierarchy, so both survive.
    const schema = z.object({
      shot: z.object({ height: z.number().min(0).max(10) }),
      figure: z.object({ height: z.number().min(1).max(3) }),
    })
    const edits: [string, unknown][] = []
    const controls = schemaControls(schema, { shot: { height: 4 }, figure: { height: 1.7 } }, (k, v) =>
      edits.push([k, v]),
    )

    const shot = byKey(controls, 'shot')
    const figure = byKey(controls, 'figure')
    if (shot.kind !== 'folder' || figure.kind !== 'folder') throw new Error('expected folders')
    expect(byKey(shot.children, 'height')).toMatchObject({ value: 4, max: 10 })
    expect(byKey(figure.children, 'height')).toMatchObject({ value: 1.7, max: 3 })

    const figureHeight = byKey(figure.children, 'height')
    if (figureHeight.kind !== 'number') throw new Error('expected number')
    figureHeight.onChange(2.2)
    expect(edits).toEqual([['figure', { height: 2.2 }]])
  })

  it('honors the skip list and ignores unsupported field types', () => {
    const schema = z.object({
      path: z.array(z.number()),
      keep: z.number().min(0).max(1),
      skipped: z.number().min(0).max(1),
    })
    const controls = schemaControls(schema, { keep: 0.5, skipped: 0.5 }, () => {}, ['skipped'])
    expect(controls.map((c) => c.key)).toEqual(['keep'])
  })

  it('returns nothing for a non-object schema', () => {
    expect(schemaControls(z.number(), {}, () => {})).toEqual([])
  })
})
