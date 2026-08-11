import { z } from 'zod'
import { folder } from 'leva'

type LevaSchema = Parameters<typeof folder>[0]

/**
 * Generated panels: every behavior carries a zod schema, and the inspector
 * renders controls from it — number→slider (min/max from checks), enum→
 * select, boolean→toggle. Community behaviors get editor UI for free.
 *
 * `prefix` namespaces nested keys, and it is not cosmetic: leva flattens a
 * schema by LEAF NAME and keeps the first of any duplicate, so a stage whose
 * shot and figure both have a `height`, and whose source and ground both
 * have `enabled` and `color`, silently loses the later controls — and a
 * folder that loses all of them disappears from the panel with no error.
 * Namespaced keys carry a `label` so the display name stays the plain one.
 */
export function schemaControls(
  schema: z.ZodTypeAny,
  values: Record<string, unknown>,
  onChange: (key: string, value: unknown) => void,
  skip: string[] = [],
  prefix = '',
): LevaSchema {
  if (!(schema instanceof z.ZodObject)) return {}
  const controls: Record<string, unknown> = {}
  const namespaced = (key: string) =>
    prefix ? `${prefix}${key.charAt(0).toUpperCase()}${key.slice(1)}` : key
  const labelled = <T extends object>(key: string, control: T) =>
    prefix ? { label: key, ...control } : control

  for (const [key, field] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
    if (skip.includes(key)) continue
    const inner = unwrap(field)
    const id = namespaced(key)
    const value = values[key]
    const handler = (v: unknown, _path: unknown, ctx: { initial: boolean }) => {
      if (!ctx.initial) onChange(key, v)
    }

    if (inner instanceof z.ZodNumber) {
      const min = checkValue(inner, 'min') ?? 0
      const max = checkValue(inner, 'max') ?? 1
      controls[id] = labelled(key, {
        value: typeof value === 'number' ? value : min,
        min,
        max,
        step: (max - min) / 200,
        onChange: handler,
      })
    } else if (inner instanceof z.ZodTuple && isNumberTuple(inner)) {
      // Numeric tuples (flight's wind vector) → one slider per component.
      const items = inner._def.items as z.ZodNumber[]
      const current = Array.isArray(value) ? (value as number[]) : items.map(() => 0)
      items.forEach((item, axis) => {
        const min = checkValue(item, 'min') ?? -1
        const max = checkValue(item, 'max') ?? 1
        controls[`${id}${'XYZW'[axis] ?? axis}`] = {
          label: `${key} ${'xyzw'[axis] ?? axis}`,
          value: current[axis] ?? 0,
          min,
          max,
          step: (max - min) / 200,
          onChange: (v: unknown, _path: unknown, ctx: { initial: boolean }) => {
            if (ctx.initial) return
            const next = [...current]
            next[axis] = v as number
            onChange(key, next)
          },
        }
      })
    } else if (inner instanceof z.ZodEnum) {
      controls[id] = labelled(key, { value, options: [...inner.options], onChange: handler })
    } else if (inner instanceof z.ZodBoolean) {
      controls[id] = labelled(key, { value: Boolean(value), onChange: handler })
    } else if (inner instanceof z.ZodString) {
      controls[id] = labelled(key, { value: String(value ?? ''), onChange: handler })
    } else if (inner instanceof z.ZodObject) {
      // Nested config (a stage's shot, figure, source…) becomes a folder, and
      // its edits bubble up as a whole replacement object so the parent's
      // patch stays a single well-formed value.
      const nested = (value ?? {}) as Record<string, unknown>
      const child = schemaControls(
        inner,
        nested,
        (childKey, childValue) => onChange(key, { ...nested, [childKey]: childValue }),
        [],
        id,
      )
      if (Object.keys(child).length > 0) {
        controls[key] = folder(child as LevaSchema, { collapsed: true })
      }
    }
  }
  return controls as LevaSchema
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
