import { z } from 'zod'
import { mergeConfig } from './merge'
import { peelOptionsSchema } from '../behaviors/peel'
import { unrollOptionsSchema } from '../behaviors/unroll'
import { flipOptionsSchema } from '../behaviors/flip'
import { letterFoldOptionsSchema } from '../behaviors/letter-fold'
import { hangOptionsSchema } from '../behaviors/hang'
import { flyOptionsSchema } from '../behaviors/fly'
import { fallOptionsSchema } from '../behaviors/fall'
import { carryOptionsSchema } from '../behaviors/carry'
import { flightOptionsSchema } from '../behaviors/flight'

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

export const stockNames = [
  'printer',
  'thermal',
  'kraft',
  'newsprint',
  'vellum',
  'photo-gloss',
  'sticker',
] as const
export const stockSchema = z.enum(stockNames)
export type StockName = z.infer<typeof stockSchema>

// ── Content ──────────────────────────────────────────────────────────────────

const blankContentBase = z.object({
  type: z.literal('blank'),
})

const imageContentBase = z.object({
  type: z.literal('image'),
  src: z.string(),
  fit: z.enum(['cover', 'contain']).default('cover'),
  /** Read by the hidden DOM mirror and the no-WebGL fallback. */
  alt: z.string().optional(),
})

const textContentBase = z.object({
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

const receiptContentBase = z.object({
  type: z.literal('receipt'),
  store: z.string().default('PAPERLAB'),
  address: z.string().default('124 PAPER ST'),
  items: z.array(z.object({ name: z.string(), price: z.number() })).default([
    { name: 'CURL, TRUE', price: 12 },
    { name: 'ROLL, TIGHT', price: 8.5 },
    { name: 'SHEET, ONE', price: 0.99 },
  ]),
  taxRate: z.number().min(0).max(1).default(0.08),
  barcode: z.boolean().default(true),
  /** Fixed so presets render deterministically; omit for "now". */
  timestamp: z.string().optional(),
  footer: z.string().default('KEEP FOR YOUR RECORDS'),
})

/** What can print on the reverse side (letter front / blank back, printed front / kraft back). */
export const backContentSchema = z.discriminatedUnion('type', [
  blankContentBase,
  imageContentBase,
  textContentBase,
  receiptContentBase,
])

export type BackContentConfig = z.infer<typeof backContentSchema>

const withBack = { back: backContentSchema.optional() }

export const blankContentSchema = blankContentBase.extend(withBack)
export const imageContentSchema = imageContentBase.extend(withBack)
export const textContentSchema = textContentBase.extend(withBack)
export const receiptContentSchema = receiptContentBase.extend(withBack)

export const contentSchema = z.discriminatedUnion('type', [
  blankContentSchema,
  imageContentSchema,
  textContentSchema,
  receiptContentSchema,
])

export type ContentConfig = z.infer<typeof contentSchema>

// ── Surface ──────────────────────────────────────────────────────────────────

export const paperEdges = ['top', 'right', 'bottom', 'left'] as const

/**
 * Fragment-side effects, composed in registration order into one shader
 * program. Stocks contribute defaults (thermal → banding + yellowing);
 * explicit surface config overrides per effect.
 */
export const surfaceSchema = z.object({
  /** Paper fiber noise, 0..1. */
  grain: z.number().min(0).max(1).optional(),
  /** Light passing through the sheet from behind, 0..1. Stock defaults apply. */
  translucency: z.number().min(0).max(1).optional(),
  /** Torn-edge alpha with a lightened fiber band. */
  deckle: z
    .object({
      edges: z.array(z.enum(paperEdges)).default(['bottom']),
      roughness: z.number().min(0).max(1).default(0.5),
    })
    .optional(),
  /** Visual AO/highlight companion to the fold deformer. */
  creaseLines: z
    .object({
      /** Crease line direction, degrees (0 = horizontal lines). */
      angle: z.number().min(-360).max(360).default(0),
      /** Positions across the sheet, 0..1 fractions. */
      positions: z.array(z.number().min(0).max(1)).default([1 / 3, 2 / 3]),
      strength: z.number().min(0).max(1).default(0.5),
    })
    .optional(),
  /** Yellowing + foxing spots, 0..1. */
  aging: z.number().min(0).max(1).optional(),
  /** Reversed front-content ghost on the backside, 0..1. Stock defaults apply. */
  showThrough: z.number().min(0).max(1).optional(),
  /**
   * Postage-stamp perforation: alpha-punched semicircular holes along chosen
   * edges. `state` flips an edge to a ripped-through profile (torn) — set
   * automatically when a paper detaches from a `sheet` field, manual wins.
   */
  perforation: z
    .object({
      edges: z.union([z.array(z.enum(paperEdges)), z.literal('all')]).default('all'),
      /** World units — default tuned to stamp scale. */
      holeRadius: z.number().min(0.002).max(0.1).default(0.016),
      spacing: z.number().min(0.01).max(0.5).default(0.055),
      state: z
        .object({
          top: z.enum(['intact', 'torn']).optional(),
          right: z.enum(['intact', 'torn']).optional(),
          bottom: z.enum(['intact', 'torn']).optional(),
          left: z.enum(['intact', 'torn']).optional(),
        })
        .default({}),
    })
    .optional(),
})

export type SurfaceConfig = z.infer<typeof surfaceSchema>
export type PaperEdge = (typeof paperEdges)[number]

// ── Behavior & deformers ─────────────────────────────────────────────────────

export const behaviorConfigSchema = z.discriminatedUnion('type', [
  peelOptionsSchema.extend({ type: z.literal('peel') }),
  unrollOptionsSchema.extend({ type: z.literal('unroll') }),
  flipOptionsSchema.extend({ type: z.literal('flip') }),
  letterFoldOptionsSchema.extend({ type: z.literal('letter-fold') }),
  hangOptionsSchema.extend({ type: z.literal('hang') }),
  flyOptionsSchema.extend({ type: z.literal('fly') }),
  fallOptionsSchema.extend({ type: z.literal('fall') }),
  carryOptionsSchema.extend({ type: z.literal('carry') }),
  flightOptionsSchema.extend({ type: z.literal('flight') }),
])

export type BehaviorConfig = z.infer<typeof behaviorConfigSchema>

/** Advanced escape hatch: a raw deformer stack (editing one forks the behavior). */
export const deformerInstanceSchema = z.object({
  type: z.string(),
  options: z.record(z.unknown()).default({}),
  enabled: z.boolean().default(true),
})

export type DeformerInstanceConfig = z.infer<typeof deformerInstanceSchema>

// ── Physics ──────────────────────────────────────────────────────────────────

/** Kept in sync with `idleNames` in physics/idle.ts (asserted by test). */
export const physicsNames = ['none', 'float', 'tumble', 'dangle', 'taped', 'breeze'] as const

export const clothConfigSchema = z.object({
  type: z.literal('cloth'),
  pins: z.enum(['top-edge', 'top-corners', 'corner', 'none']).default('top-edge'),
  wind: z.number().min(0).max(1).default(0.3),
  /** Bend stiffness: 1 = crisp paper, 0 = silk. */
  stiffness: z.number().min(0).max(1).default(0.8),
  gravity: z.number().min(0).max(2).default(1),
  /** Local-space ground plane the sheet settles onto. */
  floor: z.number().min(-5).max(0).default(-1.4),
})

export type ClothConfig = z.infer<typeof clothConfigSchema>

export const physicsSchema = z.union([
  z.enum(physicsNames),
  z.literal('cloth').transform(() => clothConfigSchema.parse({ type: 'cloth' })),
  clothConfigSchema,
])

export type PhysicsConfig = z.infer<typeof physicsSchema>

// ── Scene ────────────────────────────────────────────────────────────────────

export const lightingNames = ['studio', 'window', 'leaves', 'goldenhour', 'noir', 'nave'] as const

/** Scene-level presentation, serialized with the paper. */
export const sceneSchema = z.object({
  lighting: z.enum(lightingNames).default('studio'),
})

export type SceneConfig = z.infer<typeof sceneSchema>
export type LightingName = (typeof lightingNames)[number]

// ── Interaction states ───────────────────────────────────────────────────────

/**
 * A state is a set of parameter overrides on the base preset — never a
 * separate preset. The base stays the single source of truth; states are
 * diffs. Triggers are fixed and built-in for v1 (pointer + pick/drop flow);
 * `custom:*` names are the escape hatch for editor v2.
 */
export const coreStateNames = ['rest', 'hover', 'pressed', 'picked', 'placed'] as const
export type CoreStateName = (typeof coreStateNames)[number]
export type StateName = CoreStateName | `custom:${string}`

const isStateName = (s: string): boolean =>
  (coreStateNames as readonly string[]).includes(s) || s.startsWith('custom:')

// Typed as plain string (not the template-literal union) so PaperConfig stays
// assignable to PaperConfigInput; the refine still enforces valid names.
const stateNameSchema = z.string().refine(isStateName, {
  message: `state names are ${coreStateNames.join(', ')} or "custom:<name>"`,
})

export const stateTransitionSchema = z.object({
  duration: z.number().min(0).max(5).default(0.35),
  /** GSAP ease name. */
  ease: z.string().default('power2.out'),
})

export const stateDefSchema = z.object({
  /** Deep-partial override of the paper schema (behavior params, surface, …). */
  overrides: z.record(z.unknown()).default({}),
  /** Transition INTO this state. */
  transition: stateTransitionSchema.default({}),
  /** Chained actions after arriving. v1: 'emit:<event>' only. */
  onEnter: z.array(z.string().regex(/^emit:[\w-]+$/, 'v1 actions are "emit:<event>"')).default([]),
})

export const paperStatesSchema = z.object({
  initial: stateNameSchema.default('rest'),
  states: z
    .record(z.string(), stateDefSchema)
    .default({})
    .refine((rec) => Object.keys(rec).every(isStateName), {
      message: `state names are ${coreStateNames.join(', ')} or "custom:<name>"`,
    }),
  /** World-units drag distance that flips pressed → picked (pick-enabled behaviors only). */
  pickThreshold: z.number().min(0.005).max(1).default(0.1),
})

export type StateTransitionConfig = z.infer<typeof stateTransitionSchema>
export type StateDef = z.infer<typeof stateDefSchema>
export type PaperStates = z.infer<typeof paperStatesSchema>
export type PaperStatesInput = z.input<typeof paperStatesSchema>

// ── Paper config ─────────────────────────────────────────────────────────────

export const metaSchema = z.object({
  name: z.string().default('untitled'),
  author: z.string().optional(),
  version: z.string().default('0'),
  tags: z.array(z.string()).default([]),
})

export const paperConfigSchema = z
  .object({
    meta: metaSchema.default({}),
    sheet: sheetSchema.default({}),
    stock: stockSchema.default('printer'),
    content: contentSchema.default({ type: 'blank' }),
    /** A behavior OR a raw deformer stack — if both are present, `deformers` wins (it's the fork). */
    behavior: behaviorConfigSchema.optional(),
    deformers: z.array(deformerInstanceSchema).optional(),
    surface: surfaceSchema.default({}),
    physics: physicsSchema.default('none'),
    scene: sceneSchema.default({}),
    onTwos: z.boolean().default(false),
    /** Interaction state machine — overrides-on-base diffs (spec M6 §1). */
    states: paperStatesSchema.optional(),
  })
  .superRefine((config, ctx) => {
    // Cloth owns vertex positions: Shape (behavior/deformers) and Simulation
    // (cloth) are alternatives, not layers. Idle presets compose fine.
    if (typeof config.physics === 'object' && (config.behavior || config.deformers)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['physics'],
        message:
          'cloth physics and behavior/deformers are exclusive — cloth owns the vertices (pick Shape OR Simulation)',
      })
    }
    // State overrides must stay serializable schema paths: merging them over
    // the base must still parse. (`paperConfigSchema` is initialized by the
    // time any parse runs; the merged candidate carries no `states`, so this
    // cannot recurse.)
    if (config.states) {
      const { states: _states, ...baseSansStates } = config
      for (const [name, def] of Object.entries(config.states.states)) {
        if (!def) continue
        if ((def.overrides as Record<string, unknown>).states !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['states', 'states', name, 'overrides'],
            message: 'state overrides cannot override `states` (no nested state machines)',
          })
          continue
        }
        const candidate = mergeConfig(baseSansStates as Record<string, unknown>, def.overrides)
        const result = paperConfigSchema.safeParse(candidate)
        if (!result.success) {
          const first = result.error.issues[0]
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['states', 'states', name, 'overrides'],
            message: `state "${name}" overrides don't validate against the paper schema: ${
              first ? `${first.path.join('.')} — ${first.message}` : 'invalid'
            }`,
          })
        }
      }
    }
  })

export type PaperConfig = z.infer<typeof paperConfigSchema>
export type PaperConfigInput = z.input<typeof paperConfigSchema>
