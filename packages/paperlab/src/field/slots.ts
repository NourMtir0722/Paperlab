import {
  paperConfigSchema,
  type ContentConfig,
  type PaperConfig,
  type PaperConfigInput,
  type PaperStatesInput,
} from '../config/schema'
import { mergeConfig } from '../config/merge'
import { resolveConfig } from '../PaperMesh'
import { outwardCorner, sheetLayoutSchema } from './sheetGrid'

/** A field slot references a preset — the spec's component/instance model. */
export interface FieldPaperSlot {
  preset?: string | PaperConfigInput
  content?: ContentConfig
  /** Per-instance state overrides, merged over the preset's states (spec M6 §1.1). */
  states?: PaperStatesInput
}

export interface FieldGroupData {
  config: PaperConfig
  /** Global slot indices this group renders (layout poses use global i / total n). */
  indices: number[]
  contents: ContentConfig[]
}

export const EMPTY_SET: ReadonlySet<number> = new Set()

/**
 * The effective slot list: explicit `papers`, the `images` sugar, or the
 * twelve-blank default. ONE derivation shared by PaperFieldMesh and the
 * PaperField wrapper, so the mesh and the keyboard mirror always agree on
 * which papers exist.
 */
export function effectiveFieldPapers(
  papers?: FieldPaperSlot[],
  images?: string[],
): FieldPaperSlot[] {
  if (papers) return papers
  if (images) {
    return images.map((src) => ({
      content: { type: 'image', src, fit: 'cover' } as ContentConfig,
    }))
  }
  return Array.from({ length: 12 }, () => ({}))
}

/** Group slots by resolved preset — one instanced draw call per distinct preset. */
export function groupFieldPapers(
  papers: FieldPaperSlot[],
  fallback?: string | PaperConfigInput,
): FieldGroupData[] {
  const groups = new Map<string, FieldGroupData>()
  papers.forEach((slot, i) => {
    const config = resolveConfig({ preset: slot.preset ?? fallback })
    const key = JSON.stringify(config)
    let group = groups.get(key)
    if (!group) {
      group = { config, indices: [], contents: [] }
      groups.set(key, group)
    }
    group.indices.push(i)
    group.contents.push(slot.content ?? config.content)
  })
  return [...groups.values()]
}

/**
 * Whether a field runs the per-paper interactive path. A stateful field is
 * interactive by nature — and "stateful" must RESOLVE presets: a slot naming
 * a stateful preset by string counts exactly like an inline `states` object.
 * The single decision shared by PaperFieldMesh (render path) and PaperField
 * (keyboard mirror), so pointer interaction and keyboard access never diverge.
 */
export function fieldIsInteractive(
  papers: FieldPaperSlot[],
  fallback?: string | PaperConfigInput,
  explicit?: boolean,
): boolean {
  if (explicit !== undefined) return explicit
  return (
    papers.some((s) => s.states) ||
    groupFieldPapers(papers, fallback).some((g) => Boolean(g.config.states))
  )
}

/**
 * Resolve one slot to its final render config: preset (or fallback) + slot
 * content + slot-level state overrides merged over the preset's states + the
 * `sheet` smart default (an 'auto' peel corner resolves to the corner facing
 * away from the sheet's center — what a thumb would find).
 */
export function resolveFieldSlotConfig(
  slot: FieldPaperSlot,
  fallback: string | PaperConfigInput | undefined,
  index: number,
  layoutId: string,
  layoutOptions: Record<string, unknown>,
): PaperConfig {
  let config = resolveConfig({ preset: slot.preset ?? fallback })
  const patch: Record<string, unknown> = {}
  if (slot.content) patch.content = slot.content
  if (slot.states) patch.states = slot.states
  if (
    layoutId === 'sheet' &&
    config.behavior?.type === 'peel' &&
    config.behavior.corner === 'auto'
  ) {
    const o = sheetLayoutSchema.parse(layoutOptions)
    patch.behavior = { corner: outwardCorner(index, o) }
  }
  if (Object.keys(patch).length > 0) {
    config = paperConfigSchema.parse(mergeConfig(config as Record<string, unknown>, patch))
  }
  return config
}
