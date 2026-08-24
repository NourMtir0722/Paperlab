import {
  behaviorConfigSchema,
  clothConfigSchema,
  contentSchema,
  paperConfigSchema,
  sceneSchema,
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
      ...diffAgainst(config.content as never, defaults, config.content.type === 'image' ? ['src'] : []),
    }
  }

  if (config.behavior) {
    const defaults = behaviorConfigSchema.parse({ type: config.behavior.type }) as Record<string, unknown>
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

  // The WHOLE scene, diffed like everything else. This used to read
  // `if (lighting !== 'studio') out.scene = { lighting }` — which was true
  // while `lighting` was the only thing in a scene, and quietly threw away
  // every field added beside it. A hand-tuned light rig and a backdrop both
  // vanished on the way into a `.paper` file, a share link and a snippet:
  // the editor showed them and nothing that left the editor carried them.
  const scene = diffAgainst(config.scene as never, sceneSchema.parse({}) as never)
  if (Object.keys(scene).length > 0) out.scene = scene
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
 * The same config with uploaded pictures swapped for paths.
 *
 * An uploaded image lives in a config as a data URL — a hundred kilobytes
 * and up of base64 — and there are now two places one can be: the sheet's
 * own content, and the backdrop behind it. Pasting that into somebody's
 * source file is not an export, and the reader cannot edit it, diff it, or
 * even scroll past it.
 *
 * So a code export gets a path in the same position instead, and says that
 * is what it did. A referenced URL is already something the receiver can
 * fetch and travels untouched. Emitting nothing was the other option and it
 * is worse: a sheet that silently loses its picture looks like a bug in the
 * library rather than a limit of the clipboard.
 *
 * The `.paper` file and the share link are deliberately NOT run through
 * this — a file has room for the bytes, and losing them there would lose
 * the artwork rather than reformat it.
 */
export function withoutUploads<T>(value: T): { value: T; replaced: number } {
  let replaced = 0
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      if (!node.startsWith('data:')) return node
      replaced++
      const extension = node.startsWith('data:image/png') ? 'png' : 'jpg'
      return `/paperlab-image-${replaced}.${extension}`
    }
    if (Array.isArray(node)) return node.map(walk)
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]))
    }
    return node
  }
  return { value: walk(value) as T, replaced }
}

/** The one-line warning a code export carries when it had to substitute. */
export const UPLOAD_NOTE =
  '// Uploaded pictures cannot travel in a snippet — the paths below are\n// stand-ins, in order. Point them at your own files.'

/**
 * A plain `<Paper />` snippet with only the non-default props — the
 * secondary export for people who read code.
 */
export function buildJsxSnippet(config: PaperConfig): string {
  const diffed = diffConfig(config) as Record<string, unknown>
  delete diffed.meta
  const { value: diff, replaced } = withoutUploads(diffed)
  const props = Object.entries(diff).map(([key, value]) => `  ${key}=${jsxValue(value)}`)
  if (props.length === 0) return '<Paper />'
  const snippet = `<Paper\n${props.join('\n')}\n/>`
  return replaced > 0 ? `${UPLOAD_NOTE}\n${snippet}` : snippet
}
