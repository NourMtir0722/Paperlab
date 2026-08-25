import { z } from 'zod'

/**
 * Renderer-neutral control descriptors — the seam between "what the
 * inspector edits" and "what draws it". `schemaControls()` walks a zod
 * schema and emits one descriptor per field; `controls.tsx` renders them.
 * Behaviors, layouts, and the stage schema get editor UI from their schema
 * alone, with no control-library shape leaking into the walk.
 */
export type Control =
  | {
      kind: 'number'
      key: string
      label: string
      value: number
      min: number
      max: number
      step: number
      disabled?: boolean
      emphasis?: Emphasis
      onChange: (v: number) => void
    }
  | {
      kind: 'select'
      key: string
      label: string
      value: string
      options: string[]
      emphasis?: Emphasis
      onChange: (v: string) => void
    }
  | {
      kind: 'toggle'
      key: string
      label: string
      value: boolean
      emphasis?: Emphasis
      onChange: (v: boolean) => void
    }
  | {
      kind: 'color'
      key: string
      label: string
      /** Whatever the config holds — may not be a `#rrggbb` the swatch can show. */
      value: string
      onChange: (v: string) => void
    }
  | {
      kind: 'text'
      key: string
      label: string
      value: string
      /** >1 renders a textarea. */
      rows?: number
      hint?: string
      onChange: (v: string) => void
    }
  /** A read-only caption line (the ⓘ notes). */
  | { kind: 'note'; key: string; value: string }
  | { kind: 'button'; key: string; label: string; onClick: () => void }
  | { kind: 'folder'; key: string; label: string; collapsed?: boolean; children: Control[] }

/**
 * How loudly a control is drawn. `signature` is a behavior's own nomination
 * (see `Behavior.signature`) — the two or three options that ARE the
 * behavior get a full-width row instead of a 88px label and a hairline
 * slider. Nothing else about them differs: same descriptor, same write path.
 */
export type Emphasis = 'signature'

// ── Constructors — the inspectors read better building trees from these. ────

export const num = (
  key: string,
  value: number,
  opts: { min: number; max: number; step?: number; label?: string; disabled?: boolean },
  onChange: (v: number) => void,
): Control => ({
  kind: 'number',
  key,
  label: opts.label ?? key,
  value,
  min: opts.min,
  max: opts.max,
  step: opts.step ?? (opts.max - opts.min) / 200,
  disabled: opts.disabled,
  onChange,
})

export const select = (
  key: string,
  value: string,
  options: string[],
  onChange: (v: string) => void,
  label?: string,
): Control => ({ kind: 'select', key, label: label ?? key, value, options, onChange })

export const toggle = (
  key: string,
  value: boolean,
  onChange: (v: boolean) => void,
  label?: string,
): Control => ({ kind: 'toggle', key, label: label ?? key, value, onChange })

export const text = (
  key: string,
  value: string,
  onChange: (v: string) => void,
  opts: { label?: string; rows?: number; hint?: string } = {},
): Control => ({
  kind: 'text',
  key,
  label: opts.label ?? key,
  value,
  rows: opts.rows,
  hint: opts.hint,
  onChange,
})

export const color = (
  key: string,
  value: string,
  onChange: (v: string) => void,
  label?: string,
): Control => ({ kind: 'color', key, label: label ?? key, value, onChange })

export const note = (key: string, value: string): Control => ({ kind: 'note', key, value })

export const button = (label: string, onClick: () => void, key?: string): Control => ({
  kind: 'button',
  key: key ?? label,
  label,
  onClick,
})

export const folder = (
  label: string,
  children: Control[],
  opts: { collapsed?: boolean; key?: string } = {},
): Control => ({ kind: 'folder', key: opts.key ?? label, label, collapsed: opts.collapsed, children })

/**
 * Mark a generated run of controls as signature controls.
 *
 * A pass over the finished tree rather than a flag threaded through
 * `schemaControls`: the schema walk's job is to say what a field IS, and
 * prominence is the inspector's editorial call about the same field. Kinds
 * that have no louder form (notes, buttons, folders, text) are returned
 * untouched rather than being given a flag nothing reads.
 */
export function emphasize(controls: Control[], emphasis: Emphasis = 'signature'): Control[] {
  return controls.map((control) =>
    control.kind === 'number' || control.kind === 'select' || control.kind === 'toggle'
      ? { ...control, emphasis }
      : control,
  )
}

/**
 * Split a behavior's options into the ones it nominated and the rest.
 *
 * Each nominated key is walked SEPARATELY, skipping every other field, for
 * two reasons: the result comes back in the order the behavior listed them
 * (its own ranking, not the schema's declaration order), and a nominated
 * numeric tuple still expands into its per-axis sliders, which a filter over
 * the flat control list could not reassociate — `wind` emits `windX`,
 * `windY`, `windZ` and none of those is the name the behavior nominated.
 */
export function partitionSignature(
  schema: z.ZodTypeAny,
  signature: readonly string[] | undefined,
  values: Record<string, unknown>,
  onChange: (key: string, value: unknown) => void,
): { signature: Control[]; rest: Control[] } {
  if (!(schema instanceof z.ZodObject) || !signature?.length) {
    return { signature: [], rest: schemaControls(schema, values, onChange) }
  }
  const keys = Object.keys(schema.shape as Record<string, z.ZodTypeAny>)
  const nominated = signature.filter((key) => keys.includes(key))
  return {
    signature: emphasize(
      nominated.flatMap((key) =>
        schemaControls(
          schema,
          values,
          onChange,
          keys.filter((k) => k !== key),
        ),
      ),
    ),
    rest: schemaControls(schema, values, onChange, nominated),
  }
}

/**
 * What a schema field says about itself to be drawn as a colour.
 *
 * Kept next to the walk that reads it rather than exported from the library,
 * because it is a contract about a STRING and the library's half of it is a
 * single call. `paperlab` marks the field; this decides what to draw.
 */
const COLOR = 'color'

// ── The schema walk. ────────────────────────────────────────────────────────

/**
 * Generated panels: every behavior, layout, and the stage config carry a zod
 * schema, and the inspector renders controls from it — number→slider
 * (min/max from checks), enum→select, boolean→toggle, numeric tuple→one
 * slider per axis, nested object→folder. Community behaviors get editor UI
 * for free.
 *
 * Nested objects (a stage's shot, figure, source…) bubble their edits up as
 * a whole replacement object, so the parent's patch stays a single
 * well-formed value.
 */
export function schemaControls(
  schema: z.ZodTypeAny,
  values: Record<string, unknown>,
  onChange: (key: string, value: unknown) => void,
  skip: string[] = [],
): Control[] {
  if (!(schema instanceof z.ZodObject)) return []
  const controls: Control[] = []

  for (const [key, field] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
    if (skip.includes(key)) continue
    const inner = unwrap(field)
    const value = values[key]

    if (inner instanceof z.ZodNumber) {
      controls.push(numberControl(key, key, inner, value, (v) => onChange(key, v)))
    } else if (inner instanceof z.ZodTuple && isNumberTuple(inner)) {
      // Numeric tuples (flight's wind vector) → one slider per component.
      const items = inner._def.items as z.ZodNumber[]
      const current = Array.isArray(value) ? (value as number[]) : items.map(() => 0)
      items.forEach((item, axis) => {
        controls.push(
          numberControl(
            `${key}${'XYZW'[axis] ?? axis}`,
            `${key} ${'xyzw'[axis] ?? axis}`,
            item,
            current[axis] ?? 0,
            (v) => {
              const next = [...current]
              next[axis] = v
              onChange(key, next)
            },
            { fallbackMin: -1 },
          ),
        )
      })
    } else if (inner instanceof z.ZodEnum) {
      controls.push(select(key, String(value), [...inner.options], (v) => onChange(key, v)))
    } else if (inner instanceof z.ZodBoolean) {
      controls.push(toggle(key, Boolean(value), (v) => onChange(key, v)))
    } else if (inner instanceof z.ZodString) {
      // A colour is a string the way a date is a string. The schema says
      // which ones with `.describe('color')`, rather than this walk guessing
      // from field names — `color` and `secondary` are both pigments, and
      // `font` and `text` are both not, and no naming rule separates them.
      //
      // Read off BOTH the field and its unwrapped inside, because
      // `.describe()` attaches to whatever it was called on: after
      // `.default()` it lands on the ZodDefault and never reaches the string.
      const described = field.description ?? inner.description
      controls.push(
        described === COLOR
          ? color(key, String(value ?? ''), (v) => onChange(key, v))
          : text(key, String(value ?? ''), (v) => onChange(key, v)),
      )
    } else if (inner instanceof z.ZodObject) {
      const nested = (value ?? {}) as Record<string, unknown>
      const children = schemaControls(inner, nested, (childKey, childValue) =>
        onChange(key, { ...nested, [childKey]: childValue }),
      )
      if (children.length > 0) controls.push(folder(key, children, { collapsed: true, key }))
    }
  }
  return controls
}

/**
 * What a numeric zod field permits, in the terms a slider needs.
 *
 * **This is the one place that reads a `z.ZodNumber`.** It exists because
 * the same reading was once done twice — here and by hand in `StatesBar` —
 * and the copy that was written second was missing a check, which is a
 * completely avoidable way to ship the same crash twice.
 *
 * The checks that matter, and why:
 *
 * - **`.int()`.** A step of `(max - min) / 200` on an integer field hands
 *   the schema a fraction the moment you touch it, and the receiving parse
 *   does not warn — it THROWS. Dragging `seed` on a colonnade took the whole
 *   editor down that way: `<PaperStageScene>` re-parses its layout options
 *   during render, so a 2.5 became an uncaught ZodError inside a render and
 *   React unmounted everything. `snap` rounds as well as stepping, because
 *   the readout you can type into clamps but never snaps.
 * - **Exclusive bounds.** `.positive()` is stored as `min: 0, inclusive:
 *   false` — the same shape as `.min(0)`, one boolean apart. Reading the
 *   value and ignoring the boolean gives a slider whose far end is the one
 *   number the schema rejects. Shifted by a step so the track cannot land
 *   on it.
 */
export interface NumberSpec {
  min: number
  max: number
  step: number
  /** Coerce a raw slider/typed value into something the schema accepts. */
  snap: (v: number) => number
}

export function numberSpec(schema: z.ZodNumber, fallbackMin = 0): NumberSpec {
  const integer = schema._def.checks.some((c) => c.kind === 'int')
  const rawMin = checkValue(schema, 'min') ?? fallbackMin
  const rawMax = checkValue(schema, 'max') ?? 1
  const step = integer ? 1 : (rawMax - rawMin) / 200
  // An excluded endpoint is still a number the track could land on; move the
  // end in by one step so it cannot.
  const min = isExclusive(schema, 'min') ? rawMin + step : rawMin
  const max = isExclusive(schema, 'max') ? rawMax - step : rawMax
  return { min, max, step, snap: integer ? (v) => Math.round(v) : (v) => v }
}

/** One slider for one numeric schema field, on the spec above. */
function numberControl(
  key: string,
  label: string,
  schema: z.ZodNumber,
  value: unknown,
  onChange: (v: number) => void,
  opts: { fallbackMin?: number } = {},
): Control {
  const spec = numberSpec(schema, opts.fallbackMin)
  return num(
    key,
    typeof value === 'number' ? value : spec.min,
    { min: spec.min, max: spec.max, step: spec.step, label },
    (v) => onChange(spec.snap(v)),
  )
}

/**
 * Every numeric field of an object schema, with its spec. For panels that
 * draw their own markup rather than going through `Control` — they still do
 * not get to re-derive what the schema allows.
 */
export function numericFields(schema: z.ZodTypeAny): { key: string; spec: NumberSpec }[] {
  if (!(schema instanceof z.ZodObject)) return []
  const out: { key: string; spec: NumberSpec }[] = []
  for (const [key, field] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
    const inner = unwrap(field)
    if (inner instanceof z.ZodNumber) out.push({ key, spec: numberSpec(inner) })
  }
  return out
}

function isExclusive(schema: z.ZodNumber, kind: 'min' | 'max'): boolean {
  const check = schema._def.checks.find((c) => c.kind === kind)
  return Boolean(check && 'inclusive' in check && check.inclusive === false)
}

function isNumberTuple(tuple: z.ZodTuple): boolean {
  const items = tuple._def.items as z.ZodTypeAny[]
  return items.length > 0 && items.length <= 4 && items.every((i) => i instanceof z.ZodNumber)
}

function unwrap(field: z.ZodTypeAny): z.ZodTypeAny {
  let f = field
  while (f instanceof z.ZodDefault || f instanceof z.ZodOptional) {
    f = f instanceof z.ZodDefault ? f._def.innerType : f.unwrap()
  }
  return f
}

/**
 * A field's slider range, straight off the schema.
 *
 * Exported because a few panels have to build a control by hand — the light
 * ones, whose fields are optional overrides and so have no value of their
 * own to show — and the range is still the schema's fact to state, not
 * theirs to restate.
 */
export function numberRange(schema: z.ZodTypeAny, key: string): { min: number; max: number } {
  const field =
    schema instanceof z.ZodObject ? (schema.shape as Record<string, z.ZodTypeAny>)[key] : undefined
  const inner = field ? unwrap(field) : undefined
  if (!(inner instanceof z.ZodNumber)) return { min: 0, max: 1 }
  return { min: checkValue(inner, 'min') ?? 0, max: checkValue(inner, 'max') ?? 1 }
}

function checkValue(num: z.ZodNumber, kind: 'min' | 'max'): number | undefined {
  const check = num._def.checks.find((c) => c.kind === kind)
  return check && 'value' in check ? check.value : undefined
}
