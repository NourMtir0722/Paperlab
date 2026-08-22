import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { numberSpec, numericFields, schemaControls, type Control } from './controlModel'

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

/**
 * Integer fields, and the crash that made them worth a block of their own.
 *
 * A generated slider used to take only min and max off the schema and derive
 * its step as `(max - min) / 200`. For a `z.number().int()` field that is a
 * fraction, and the receiving parse does not warn about a fraction — it
 * THROWS. `<PaperStageScene>` re-parses its layout options during render, so
 * dragging `seed` on a colonnade raised an uncaught ZodError inside a render
 * and React unmounted the entire editor: a blank white page, no message.
 *
 * Ten fields across the library carry `.int()` — `seed` on four layouts and
 * on crumple, `rows`/`columns` on the sheet grid, `columns` on the rack,
 * `segments` on the sheet — so this is one control-model rule standing in
 * front of all of them.
 */
describe('schemaControls with integer fields', () => {
  const seedSchema = z.object({ seed: z.number().int().min(0).max(9999).default(2) })

  it('steps an int field by 1 instead of by a two-hundredth of its range', () => {
    const [ctl] = schemaControls(seedSchema, { seed: 2 }, () => {})
    if (ctl?.kind !== 'number') throw new Error('expected number')
    expect(ctl.step).toBe(1)
  })

  it('never emits a fraction, whatever the slider hands it', () => {
    const seen: unknown[] = []
    const [ctl] = schemaControls(seedSchema, { seed: 2 }, (_key, v) => seen.push(v))
    if (ctl?.kind !== 'number') throw new Error('expected number')
    // The typed-value path clamps but does not snap, so the control itself
    // has to be the thing that rounds.
    for (const raw of [2.5, 0.1, 3.7, 9998.6, -0.4]) ctl.onChange(raw)
    expect(seen).toEqual([3, 0, 4, 9999, -0])
    for (const v of seen) expect(Number.isInteger(v as number)).toBe(true)
  })

  it('emits values the schema actually accepts — the parse that used to throw', () => {
    const [ctl] = schemaControls(seedSchema, { seed: 2 }, (_k, v) => {
      expect(() => seedSchema.parse({ seed: v })).not.toThrow()
    })
    if (ctl?.kind !== 'number') throw new Error('expected number')
    for (let raw = 0; raw <= 12; raw += 0.37) ctl.onChange(raw)
  })

  it('leaves a plain float field alone', () => {
    const [ctl] = schemaControls(z.object({ hover: z.number().min(0).max(2) }), { hover: 1 }, () => {})
    if (ctl?.kind !== 'number') throw new Error('expected number')
    expect(ctl.step).toBeCloseTo(2 / 200)
  })

  it('applies to an int inside a numeric tuple too', () => {
    const seen: unknown[] = []
    const schema = z.object({ cell: z.tuple([z.number().int().min(1).max(9), z.number().min(0).max(1)]) })
    const controls = schemaControls(schema, { cell: [2, 0.5] }, (_k, v) => seen.push(v))
    const first = byKey(controls, 'cellX')
    const second = byKey(controls, 'cellY')
    if (first.kind !== 'number' || second.kind !== 'number') throw new Error('expected numbers')
    expect(first.step).toBe(1)
    expect(second.step).toBeCloseTo(1 / 200)
    first.onChange(4.6)
    expect(seen).toEqual([[5, 0.5]])
  })
})

/**
 * `numberSpec` is the single reader of a numeric zod field, and
 * `numericFields` is how a panel that draws its own markup gets at it
 * without writing a second one. `StatesBar` did write a second one, it was
 * missing `.int()`, and that shipped the identical crash in a second place —
 * so these guard the reader itself rather than any one panel.
 */
describe('numberSpec', () => {
  it('keeps an exclusive bound off the track', () => {
    // `.positive()` is stored as min 0 with inclusive:false — one boolean
    // apart from `.min(0)`, and the difference is whether the far end of the
    // slider is a number the schema throws on.
    const schema = z.number().positive().max(20)
    const spec = numberSpec(schema)
    expect(spec.min).toBeGreaterThan(0)
    expect(() => schema.parse(spec.snap(spec.min))).not.toThrow()
    expect(() => schema.parse(spec.snap(spec.max))).not.toThrow()
  })

  it('leaves an inclusive bound exactly where the schema put it', () => {
    const spec = numberSpec(z.number().min(0).max(2))
    expect(spec.min).toBe(0)
    expect(spec.max).toBe(2)
  })

  it('emits only values the schema accepts, across every numeric field in the app', () => {
    // The property that actually matters, stated once over a table of the
    // shapes the library really uses.
    const schemas: z.ZodNumber[] = [
      z.number().int().min(0).max(9999),
      z.number().int().min(0).max(7),
      z.number().int().min(1).max(24),
      z.number().int().min(2).max(256),
      z.number().positive().max(20),
      z.number().min(0.2).max(3),
      z.number().min(-1).max(1),
      z.number(),
    ]
    for (const schema of schemas) {
      const spec = numberSpec(schema)
      // Walk the track the way a drag does, plus both endpoints exactly.
      const samples = [spec.min, spec.max]
      for (let k = 0; k <= 40; k++) samples.push(spec.min + ((spec.max - spec.min) * k) / 40)
      for (const raw of samples) {
        const emitted = spec.snap(raw)
        expect(
          () => schema.parse(emitted),
          `${JSON.stringify(schema._def.checks)} rejected ${emitted} (from ${raw})`,
        ).not.toThrow()
      }
    }
  })
})

describe('numericFields', () => {
  it('reports every numeric field of a behavior schema, unwrapping defaults', () => {
    const schema = z.object({
      progress: z.number().min(0).max(1).default(0),
      seed: z.number().int().min(0).max(7).default(0),
      corner: z.enum(['a', 'b']),
    })
    const fields = numericFields(schema)
    expect(fields.map((f) => f.key)).toEqual(['progress', 'seed'])
    expect(fields.find((f) => f.key === 'seed')?.spec.step).toBe(1)
    expect(fields.find((f) => f.key === 'seed')?.spec.snap(2.5)).toBe(3)
  })

  it('returns nothing for a non-object schema', () => {
    expect(numericFields(z.number())).toEqual([])
  })
})
