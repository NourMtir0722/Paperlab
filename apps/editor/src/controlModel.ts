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
      onChange: (v: number) => void
    }
  | {
      kind: 'select'
      key: string
      label: string
      value: string
      options: string[]
      onChange: (v: string) => void
    }
  | { kind: 'toggle'; key: string; label: string; value: boolean; onChange: (v: boolean) => void }
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
      const min = checkValue(inner, 'min') ?? 0
      const max = checkValue(inner, 'max') ?? 1
      controls.push(num(key, typeof value === 'number' ? value : min, { min, max }, (v) => onChange(key, v)))
    } else if (inner instanceof z.ZodTuple && isNumberTuple(inner)) {
      // Numeric tuples (flight's wind vector) → one slider per component.
      const items = inner._def.items as z.ZodNumber[]
      const current = Array.isArray(value) ? (value as number[]) : items.map(() => 0)
      items.forEach((item, axis) => {
        const min = checkValue(item, 'min') ?? -1
        const max = checkValue(item, 'max') ?? 1
        controls.push(
          num(
            `${key}${'XYZW'[axis] ?? axis}`,
            current[axis] ?? 0,
            { min, max, label: `${key} ${'xyzw'[axis] ?? axis}` },
            (v) => {
              const next = [...current]
              next[axis] = v
              onChange(key, next)
            },
          ),
        )
      })
    } else if (inner instanceof z.ZodEnum) {
      controls.push(select(key, String(value), [...inner.options], (v) => onChange(key, v)))
    } else if (inner instanceof z.ZodBoolean) {
      controls.push(toggle(key, Boolean(value), (v) => onChange(key, v)))
    } else if (inner instanceof z.ZodString) {
      controls.push(text(key, String(value ?? ''), (v) => onChange(key, v)))
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

function checkValue(num: z.ZodNumber, kind: 'min' | 'max'): number | undefined {
  const check = num._def.checks.find((c) => c.kind === kind)
  return check && 'value' in check ? check.value : undefined
}
