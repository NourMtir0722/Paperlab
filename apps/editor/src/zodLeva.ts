import { z } from 'zod'
import type { folder } from 'leva'

type LevaSchema = Parameters<typeof folder>[0]

/**
 * Generated panels: every behavior carries a zod schema, and the inspector
 * renders controls from it — number→slider (min/max from checks), enum→
 * select, boolean→toggle. Community behaviors get editor UI for free.
 */
export function schemaControls(
  schema: z.ZodTypeAny,
  values: Record<string, unknown>,
  onChange: (key: string, value: unknown) => void,
  skip: string[] = [],
): LevaSchema {
  if (!(schema instanceof z.ZodObject)) return {}
  const controls: Record<string, unknown> = {}

  for (const [key, field] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
    if (skip.includes(key)) continue
    const inner = unwrap(field)
    const value = values[key]
    const handler = (v: unknown, _path: unknown, ctx: { initial: boolean }) => {
      if (!ctx.initial) onChange(key, v)
    }

    if (inner instanceof z.ZodNumber) {
      const min = checkValue(inner, 'min') ?? 0
      const max = checkValue(inner, 'max') ?? 1
      controls[key] = {
        value: typeof value === 'number' ? value : min,
        min,
        max,
        step: (max - min) / 200,
        onChange: handler,
      }
    } else if (inner instanceof z.ZodTuple && isNumberTuple(inner)) {
      // Numeric tuples (flight's wind vector) → one slider per component.
      const items = inner._def.items as z.ZodNumber[]
      const current = Array.isArray(value) ? (value as number[]) : items.map(() => 0)
      items.forEach((item, axis) => {
        const min = checkValue(item, 'min') ?? -1
        const max = checkValue(item, 'max') ?? 1
        controls[`${key}${'XYZW'[axis] ?? axis}`] = {
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
      controls[key] = { value, options: [...inner.options], onChange: handler }
    } else if (inner instanceof z.ZodBoolean) {
      controls[key] = { value: Boolean(value), onChange: handler }
    } else if (inner instanceof z.ZodString) {
      controls[key] = { value: String(value ?? ''), onChange: handler }
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
