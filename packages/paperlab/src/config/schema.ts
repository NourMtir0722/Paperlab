import { z } from 'zod'

/**
 * The zod schema is the single source of truth: it validates the public API,
 * generates editor panels, defines the `.paper` preset format, and feeds the docs.
 * If a feature can't serialize into this schema, it waits.
 */

// ── Sheet ────────────────────────────────────────────────────────────────────

export const sheetSchema = z.object({
  /** World units. A letter sheet is ~1 × 1.4, a receipt ~1 × 2.6. */
  width: z.number().positive().max(20).default(1),
  height: z.number().positive().max(20).default(1.4),
  /** Visual thickness in mm-ish units; drives edge/shadow treatment, not geometry (yet). */
  thickness: z.number().min(0).max(2).default(0.2),
  /** 'auto' sizes the grid from the active deformers' needs. */
  segments: z.union([z.literal('auto'), z.number().int().min(2).max(256)]).default('auto'),
  cornerRadius: z.number().min(0).max(0.5).default(0),
})

export type SheetConfig = z.infer<typeof sheetSchema>

// ── Stock ────────────────────────────────────────────────────────────────────

export const stockNames = ['printer', 'thermal', 'kraft', 'newsprint', 'vellum', 'photo-gloss'] as const
export const stockSchema = z.enum(stockNames)
export type StockName = z.infer<typeof stockSchema>

// ── Content ──────────────────────────────────────────────────────────────────

export const blankContentSchema = z.object({
  type: z.literal('blank'),
})

export const imageContentSchema = z.object({
  type: z.literal('image'),
  src: z.string(),
  fit: z.enum(['cover', 'contain']).default('cover'),
})

export const textContentSchema = z.object({
  type: z.literal('text'),
  text: z.string().default('Dear reader,'),
  font: z.string().default('Georgia, "Times New Roman", serif'),
  /** px at texture resolution (long edge = 1024 logical px before DPR). */
  size: z.number().min(8).max(256).default(44),
  weight: z.number().min(100).max(900).default(400),
  color: z.string().default('#2b2620'),
  align: z.enum(['left', 'center', 'right']).default('left'),
  /** Fraction of the short edge. */
  padding: z.number().min(0).max(0.4).default(0.09),
  lineHeight: z.number().min(0.8).max(3).default(1.45),
})

export const contentSchema = z.discriminatedUnion('type', [
  blankContentSchema,
  imageContentSchema,
  textContentSchema,
])

export type ContentConfig = z.infer<typeof contentSchema>

// ── Paper config (schema v0: no behavior/surface yet) ───────────────────────

export const metaSchema = z.object({
  name: z.string().default('untitled'),
  author: z.string().optional(),
  version: z.string().default('0'),
  tags: z.array(z.string()).default([]),
})

export const paperConfigSchema = z.object({
  meta: metaSchema.default({}),
  sheet: sheetSchema.default({}),
  stock: stockSchema.default('printer'),
  content: contentSchema.default({ type: 'blank' }),
  physics: z.literal('none').default('none'),
  onTwos: z.boolean().default(false),
})

export type PaperConfig = z.infer<typeof paperConfigSchema>
export type PaperConfigInput = z.input<typeof paperConfigSchema>
