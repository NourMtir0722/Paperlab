import {
  behaviorConfigSchema,
  clothConfigSchema,
  contentSchema,
  paperConfigSchema,
  sheetSchema,
  type PaperConfig,
  type PaperConfigInput,
} from './schema'

/**
 * Presets are diffable: exports emit only non-default values, so a shared
 * `.paper` file or JSX snippet reads like intent, not like a database dump.
 */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Keys of `value` that differ from `defaults` (deep compare, shallow recurse). */
function diffAgainst(
  value: Record<string, unknown>,
  defaults: Record<string, unknown>,
  keep: string[] = [],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value)) {
    if (keep.includes(key)) {
      out[key] = v
      continue
    }
    if (JSON.stringify(v) !== JSON.stringify(defaults[key])) {
      out[key] =
        isPlainObject(v) && isPlainObject(defaults[key])
          ? diffAgainst(v, defaults[key] as Record<string, unknown>)
          : v
    }
  }
  return out
}

/** The minimal PaperConfigInput that parses back to `config`. */
export function diffConfig(config: PaperConfig): PaperConfigInput {
  const base = paperConfigSchema.parse({})
  const out: Record<string, unknown> = {}

  const sheet = diffAgainst(config.sheet as never, sheetSchema.parse({}) as never)
  if (Object.keys(sheet).length > 0) out.sheet = sheet

  if (config.stock !== base.stock) out.stock = config.stock

  if (config.content.type !== 'blank') {
    // Defaults for this content type; required fields (image src) always kept.
    const defaults = contentSchema.parse(
      config.content.type === 'image'
        ? { type: 'image', src: config.content.src }
        : { type: config.content.type },
    ) as Record<string, unknown>
    out.content = {
      type: config.content.type,
      ...diffAgainst(
        config.content as never,
        defaults,
        config.content.type === 'image' ? ['src'] : [],
      ),
    }
  }

  if (config.behavior) {
    const defaults = behaviorConfigSchema.parse({ type: config.behavior.type }) as Record<
      string,
      unknown
    >
    out.behavior = { type: config.behavior.type, ...diffAgainst(config.behavior as never, defaults) }
  }
  if (config.deformers) out.deformers = config.deformers

  if (Object.keys(config.surface).length > 0) out.surface = config.surface

  if (typeof config.physics === 'object') {
    const defaults = clothConfigSchema.parse({ type: 'cloth' }) as Record<string, unknown>
    out.physics = { type: 'cloth', ...diffAgainst(config.physics as never, defaults) }
  } else if (config.physics !== 'none') {
    out.physics = config.physics
  }

  if (config.scene.lighting !== 'studio') out.scene = { lighting: config.scene.lighting }
  if (config.onTwos) out.onTwos = true
  // States are already diffs on the base — emit them whole.
  if (config.states) out.states = config.states
  const meta = diffAgainst(config.meta as never, paperConfigSchema.parse({}).meta as never)
  if (Object.keys(meta).length > 0) out.meta = meta

  return out as PaperConfigInput
}

/** Render a value as compact JSX-attribute source. */
function jsxValue(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`
  return `{${JSON.stringify(value)}}`
}

/**
 * A plain `<Paper />` snippet with only the non-default props — the
 * secondary export for people who read code.
 */
export function buildJsxSnippet(config: PaperConfig): string {
  const diff = diffConfig(config) as Record<string, unknown>
  delete diff.meta
  const props = Object.entries(diff).map(([key, value]) => `  ${key}=${jsxValue(value)}`)
  if (props.length === 0) return '<Paper />'
  return `<Paper\n${props.join('\n')}\n/>`
}
