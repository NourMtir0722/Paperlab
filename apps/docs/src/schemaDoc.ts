import { z } from 'zod'

/**
 * The schema is the reference.
 *
 * Every behavior, layout and stage carries a zod schema, and that schema
 * already knows each parameter's type, its bounds and its default. Typing
 * those into a markdown table by hand is how a README ends up advertising
 * five layouts that do not exist — so this walks the schema instead, and a
 * community behavior gets documented the moment it registers.
 *
 * Read-only twin of the editor's `schemaControls`: same unwrapping, no
 * `onChange`. Kept local rather than shared because the library's public
 * surface is something we want smaller, not larger.
 */

export interface ParamDoc {
  key: string
  /** Human type word — 'number', 'one of', 'toggle', 'text', 'vector', 'object'. */
  type: string
  /** '0 – 1' for bounded numbers; undefined when unbounded. */
  range?: string
  options?: string[]
  /** Rendered default, or undefined when the field has none (i.e. required). */
  fallback?: string
}

export function describeSchema(schema: z.ZodTypeAny): ParamDoc[] {
  if (!(schema instanceof z.ZodObject)) return []
  const rows: ParamDoc[] = []

  for (const [key, field] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
    // `type` is the discriminator a preset needs, not a parameter anyone tunes.
    if (key === 'type') continue
    const fallback = defaultOf(field)
    const inner = unwrap(field)

    if (inner instanceof z.ZodNumber) {
      rows.push({ key, type: 'number', range: rangeOf(inner), fallback })
    } else if (inner instanceof z.ZodEnum) {
      rows.push({ key, type: 'one of', options: [...(inner.options as string[])], fallback })
    } else if (inner instanceof z.ZodBoolean) {
      rows.push({ key, type: 'toggle', fallback })
    } else if (inner instanceof z.ZodString) {
      rows.push({ key, type: 'text', fallback })
    } else if (inner instanceof z.ZodTuple) {
      const items = inner._def.items as z.ZodTypeAny[]
      rows.push({ key, type: `vector (${items.length})`, fallback })
    } else if (inner instanceof z.ZodArray) {
      rows.push({ key, type: 'list', fallback })
    } else if (inner instanceof z.ZodObject) {
      rows.push({ key, type: 'object', options: Object.keys(inner.shape as object), fallback })
    } else {
      rows.push({ key, type: 'value', fallback })
    }
  }
  return rows
}

function rangeOf(num: z.ZodNumber): string | undefined {
  const min = checkValue(num, 'min')
  const max = checkValue(num, 'max')
  if (min === undefined && max === undefined) return undefined
  return `${min ?? '−∞'} – ${max ?? '∞'}`
}

function defaultOf(field: z.ZodTypeAny): string | undefined {
  let f = field
  while (f instanceof z.ZodOptional) f = f.unwrap()
  if (!(f instanceof z.ZodDefault)) return undefined
  try {
    return render(f._def.defaultValue())
  } catch {
    return undefined
  }
}

/** Compact enough for a table cell — a default nobody can read is noise. */
function render(value: unknown): string {
  if (typeof value === 'number') return String(Math.round(value * 1000) / 1000)
  if (typeof value === 'string') return `'${value}'`
  if (typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.map(render).join(', ')}]`
  if (value && typeof value === 'object') {
    const keys = Object.keys(value)
    return keys.length === 0 ? '{}' : `{ ${keys.join(', ')} }`
  }
  return String(value)
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
  return check && 'value' in check ? (check.value as number) : undefined
}
