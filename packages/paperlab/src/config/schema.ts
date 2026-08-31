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
import { crumpleBehaviorOptionsSchema } from '../behaviors/crumple'
import { settleOptionsSchema } from '../behaviors/settle'
import { ribbonOptionsSchema } from '../behaviors/ribbon'

/**
 * The zod schema is the single source of truth: it validates the public API,
 * generates editor panels, defines the `.paper` preset format, and feeds the docs.
 * If a feature can't serialize into this schema, it waits.
 *
 * Every schema here exports BOTH of its types, and the difference is
 * load-bearing. `z.infer` is the parsed config — every default filled in,
 * every field present — and it is what the renderer reads. `z.input` is what
 * a caller is allowed to write, where anything with a default is optional,
 * and it is what every public prop must take. Handing a component the
 * inferred type instead demands that the caller supply every field of every
 * nested object, which turns the documented one-liner into a type error.
 */

// ── Sheet ────────────────────────────────────────────────────────────────────

export const sheetSchema = z.object({
  /** World units. A letter sheet is ~1 × 1.4, a receipt ~1 × 2.6. */
  width: z.number().positive().max(20).default(1),
  height: z.number().positive().max(20).default(1.4),
  /** Visual thickness in mm-ish units; drives edge/shadow treatment, not geometry (yet). */
  thickness: z.number().min(0).max(2).default(0.2),
  /**
   * `'auto'` sizes the grid from the active deformers' needs — genuinely, as
   * of 0.3.0. It asks each one what these options require (a gentle bend and
   * a tight roll are not the same request), takes the densest answer, and
   * snaps it to a ladder so dragging a slider does not rebuild the mesh.
   *
   * It is capped at 72, which is what it used to hand out flat regardless of
   * what was on the sheet, so `'auto'` can only ever subdivide LESS than it
   * did before — a blank sheet drops from 72 a side to 8, and stops being
   * tessellated as finely as a crumpled one.
   *
   * Set a number to take the decision yourself; a deformer's `minSegments`
   * still raises it, because that is a correctness floor rather than a
   * preference.
   */
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

/**
 * A watercolour wash, painted under whatever else the sheet carries.
 *
 * It is a FIELD on every content type rather than a content type of its own,
 * and that is the whole design. A wash is a ground, not a subject: the thing
 * people want is a letter written over one, a card laid on one, a poster with
 * one behind the type. Made a sixth member of the union it would have been
 * mutually exclusive with the text it exists to sit behind, and the only way
 * to get both would have been to bake the words into an uploaded picture —
 * which is exactly the trick this library exists to avoid.
 *
 * Painted rather than shipped as artwork, for the same reason `DEMO_CARDS`
 * are typeset rather than photographed. A bitmap is ~100KB that cannot cross
 * a share link, does not survive an export to someone else's codebase, and
 * does not know what stock it is lying on. A wash described in nine numbers
 * travels anywhere the config does, tints against the paper under it, and
 * curls with the mesh because it IS the texture.
 */
export const washSchema = z.object({
  /** The first pigment. */
  color: z.string().default('#4a5b8c').describe('color'),
  /** The second. Blooms alternate, and overlaps multiply into a third. */
  secondary: z.string().default('#b06a6a').describe('color'),
  /** How many pools of colour. */
  blooms: z.number().int().min(1).max(24).default(7),
  /** How far a pool runs before it dries — its size against the sheet. */
  spread: z.number().min(0.1).max(1).default(0.7),
  /** Softness of the wet edge. 0 is a hard cut, 1 is a pool still moving. */
  bleed: z.number().min(0).max(1).default(0.5),
  /** How much pigment is in the water. */
  intensity: z.number().min(0).max(1).default(0.55),
  /**
   * Edge darkening — the ring of pigment left where a pool dried.
   *
   * The signature of the medium, and the one thing a plain gradient cannot
   * fake. Without it a wash reads as an airbrush.
   */
  edge: z.number().min(0).max(1).default(0.6),
  /** Pigment settling into the tooth of the paper. */
  granulation: z.number().min(0).max(1).default(0.35),
  /** Fixed so a preset paints the same wash every time. */
  seed: z.number().int().min(0).max(99).default(0),
})

export type WashConfig = z.infer<typeof washSchema>

const blankContentBase = z.object({
  type: z.literal('blank'),
})

const imageContentBase = z.object({
  type: z.literal('image'),
  /**
   * Empty means "no picture yet", and renders as bare stock rather than as
   * a failure. That is what lets a built-in preset be an image preset
   * without shipping — or fetching — a photograph: `photo-print` and
   * `postage-stamp` are containers for the caller's own art, handed over via
   * `<PaperField images={...} />` or `content.src`.
   */
  src: z.string().default(''),
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
  color: z.string().default('#2b2620').describe('color'),
  align: z.enum(['left', 'center', 'right']).default('left'),
  /** Fraction of the short edge. */
  padding: z.number().min(0).max(0.4).default(0.09),
  lineHeight: z.number().min(0.8).max(3).default(1.45),
  /**
   * Letter-spacing, in em. The one control display type cannot do without:
   * a line set large enough to be read across a room needs its tracking
   * pulled IN, and a small line of uppercase small-print needs it pushed
   * out, and neither is achievable by changing the size.
   */
  tracking: z.number().min(-0.1).max(0.6).default(0),
  /**
   * Where the block sits down the sheet.
   *
   * `top` is the old behaviour and stays the default, because a letter
   * starts at the top of the page. `center` is what a card, a label or a
   * poster wants — a block of type optically centred in the sheet rather
   * than hung from its top edge.
   */
  valign: z.enum(['top', 'center']).default('top'),
})

/**
 * A card: the small stiff printed thing paper is most often cut into.
 *
 * One type covers the index card, the library due-date card, the museum
 * wall label, the telegram slip and the gallery quote sheet, because they
 * are the same object — a tracked label, a rule, a body, and a line of small
 * print — differing only in which parts are present.
 *
 * It exists because `text` could not make any of them. `text` sets a block
 * of prose in one size and one weight; every artifact above is a
 * COMPOSITION, with a hierarchy and a rule in it, and composing one out of
 * plain text meant hand-placing newlines and hoping.
 */
const cardContentBase = z.object({
  type: z.literal('card'),
  /** Small, tracked, uppercase by convention — the label at the top. */
  title: z.string().default(''),
  /** The card's reason for existing. */
  body: z.string().default(''),
  /** Attribution, catalogue number, date — the line in small print at the foot. */
  note: z.string().default(''),
  /** A hairline under the title. What separates a label from a paragraph. */
  rule: z.boolean().default(true),
  /**
   * Ruled writing lines behind the body, as on an index card.
   *
   * Drawn UNDER the type and in the stock's own ink at low alpha, so they
   * read as printed on the card rather than as underlines on the words.
   */
  ruled: z.boolean().default(false),
  font: z.string().default('Georgia, "Times New Roman", serif'),
  /**
   * Body size, px at texture resolution. Title and note derive from it.
   *
   * Set larger than the `text` default on purpose. A card is a small object
   * read close up, so its type is LARGE relative to the sheet; at the text
   * block's 42 the composition floated in the middle of the card with a
   * third of the stock empty above and below it, which reads as a page that
   * was cropped rather than as a card that was set.
   */
  size: z.number().min(8).max(256).default(58),
  color: z.string().default('#2b2620').describe('color'),
  align: z.enum(['left', 'center']).default('left'),
  padding: z.number().min(0).max(0.4).default(0.1),
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

/** A ground under the subject, on either side of the sheet. */
const withWash = { wash: washSchema.optional() }

/** What can print on the reverse side (letter front / blank back, printed front / kraft back). */
export const backContentSchema = z.discriminatedUnion('type', [
  blankContentBase.extend(withWash),
  imageContentBase.extend(withWash),
  textContentBase.extend(withWash),
  cardContentBase.extend(withWash),
  receiptContentBase.extend(withWash),
])

export type BackContentConfig = z.infer<typeof backContentSchema>

/**
 * What every content type carries besides its own subject: what prints on
 * the reverse, and what is washed on underneath.
 */
const withBack = { back: backContentSchema.optional(), ...withWash }

export const blankContentSchema = blankContentBase.extend(withBack)
export const imageContentSchema = imageContentBase.extend(withBack)
export const textContentSchema = textContentBase.extend(withBack)
export const cardContentSchema = cardContentBase.extend(withBack)
export const receiptContentSchema = receiptContentBase.extend(withBack)

export const contentSchema = z.discriminatedUnion('type', [
  blankContentSchema,
  imageContentSchema,
  textContentSchema,
  cardContentSchema,
  receiptContentSchema,
])

export type ContentConfig = z.infer<typeof contentSchema>
/** What a caller may WRITE — defaults still unfilled. This is the prop type. */
export type ContentConfigInput = z.input<typeof contentSchema>

/**
 * Every kind of thing that can print on a sheet, in declaration order.
 *
 * Read off the union rather than written out beside it. The sibling name
 * lists here (`stockNames`, `physicsNames`) are the SOURCE their schema is
 * built from, so a hand-written array is the single source of truth; this
 * one is not — the union is — and a second copy would be free to drift the
 * day a sixth content type lands.
 */
export const contentNames = contentSchema.options.map(
  (option) => option.shape.type.value,
) as readonly ContentConfig['type'][]

/**
 * One variant's schema, by its `type`.
 *
 * Exists so that a caller GENERATING UI from the schema — the editor's
 * inspector already does this for behaviors, layouts and the stage — can
 * reach a content variant without reaching into the union's internals.
 * Which member carries which discriminator is the union's own fact to
 * state, not a walk's to rediscover.
 */
export function contentSchemaFor(type: ContentConfig['type']): (typeof contentSchema)['options'][number] {
  const option = contentSchema.options.find((candidate) => candidate.shape.type.value === type)
  if (!option) throw new Error(`Unknown content type: ${type}`)
  return option
}

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
export type SurfaceConfigInput = z.input<typeof surfaceSchema>
export type PaperEdge = (typeof paperEdges)[number]

// ── Memory ───────────────────────────────────────────────────────────────────

/**
 * A crease the paper carries: a line it has been folded along and did not
 * fully come back from.
 *
 * `angle` and `offset` name the line exactly as {@link foldOptionsSchema}
 * does — angle is the direction the fold TRAVELS and the crease line runs
 * perpendicular to it, offset is the signed distance of that line from the
 * sheet's centre along the travel direction. Naming the line in the fold
 * deformer's own terms is what lets a remembered crease and a live fold
 * recognise each other as the same crease rather than stack into two.
 */
export const creaseSchema = z.object({
  angle: z.number().min(-360).max(360).default(90),
  offset: z.number().min(-20).max(20).default(0),
  /**
   * The residual fold angle in degrees, signed — how far open the crease
   * still sits once nothing is holding the paper. This is the whole of what
   * a crease IS: geometry and shading both read it, and it is what makes the
   * field authorable by hand (a dog-ear is a crease with a big `depth` near
   * a corner) rather than only recordable.
   */
  depth: z.number().min(-180).max(180).default(12),
})

export type CreaseConfig = z.infer<typeof creaseSchema>
export type CreaseConfigInput = z.input<typeof creaseSchema>

/**
 * What the sheet remembers having been done to it.
 *
 * Paper is PLASTIC where cloth is elastic: fold it and it keeps the fold.
 * Every deformer in the library is a pure function of its options, so a
 * sheet folded to 180° and back to 0° comes out of the stack pristine —
 * which is right for cloth and wrong for the one material Paperlab models.
 * This is the layer that remembers, and it lives beside the stack rather
 * than inside it precisely so deformers stay pure.
 */
export const memorySchema = z.object({
  /**
   * How much of a fold this paper keeps, 0..1, over the stock's own
   * {@link Stock.takesSet}. Kraft holds a crease hard; vellum springs most
   * of the way back.
   */
  set: z.number().min(0).max(1).optional(),
  /**
   * The creases themselves. Recorded by folding the paper (see
   * `onCrease`), or written by hand — a preset can ship already creased.
   *
   * Capped at four because that is what the crease shader carries, and a
   * cap the schema states is better than one the renderer applies silently.
   */
  creases: z.array(creaseSchema).max(4).default([]),
})

export type MemoryConfig = z.infer<typeof memorySchema>
export type MemoryConfigInput = z.input<typeof memorySchema>

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
  crumpleBehaviorOptionsSchema.extend({ type: z.literal('crumple') }),
  settleOptionsSchema.extend({ type: z.literal('settle') }),
  ribbonOptionsSchema.extend({ type: z.literal('ribbon') }),
])

export type BehaviorConfig = z.infer<typeof behaviorConfigSchema>
export type BehaviorConfigInput = z.input<typeof behaviorConfigSchema>

/** Advanced escape hatch: a raw deformer stack (editing one forks the behavior). */
export const deformerInstanceSchema = z.object({
  type: z.string(),
  options: z.record(z.unknown()).default({}),
  enabled: z.boolean().default(true),
})

export type DeformerInstanceConfig = z.infer<typeof deformerInstanceSchema>
export type DeformerInstanceConfigInput = z.input<typeof deformerInstanceSchema>

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

/**
 * A strip of paper paying off a roll, and the pile it makes when it lands.
 *
 * The one simulation with a driving body: `scroll` turns the roll, the roll
 * extrudes paper, and the paper is left to fall. Bind `scroll` to the page —
 * it is a MONOTONIC world-unit figure, not a 0..1 progress, because the sim
 * differentiates it and only ever reads the delta.
 */
export const stripConfigSchema = z.object({
  type: z.literal('strip'),
  /** How far the page has scrolled, in world units of paper asked for. */
  scroll: z.number().min(-1000).max(1000).default(0),
  /** Thin layers and many turns, or few and fat. */
  tightness: z.number().min(0).max(1).default(0.6),
  /** Radius of the cardboard tube — the roll never pays out past it. */
  core: z.number().min(0.01).max(0.5).default(0.09),
  /** Paper already hanging before the first scroll. A roll always has a leaf out. */
  tail: z.number().min(0).max(20).default(1.1),
  /** Spacing of the perforations: one sheet's worth of strip, in world units. */
  perforation: z.number().min(0.05).max(5).default(1),
  /**
   * How much a perforation remembers being folded. 0 = a fresh roll, 1 = one
   * that has been used.
   *
   * The default is high on purpose: below about 0.6 the landed paper flops
   * over in flat panels and spreads across the floor, and at 0.7 it holds its
   * folds and stacks into an accordion. The pile is the point.
   */
  crease: z.number().min(0).max(1).default(0.7),
  /** Bend stiffness between perforations. 1 = card, 0 = cloth. */
  stiffness: z.number().min(0).max(1).default(0.55),
  /** Broadside air drag — what makes paper float down rather than drop. */
  drag: z.number().min(0).max(1).default(0.55),
  gravity: z.number().min(0).max(2).default(1),
  /**
   * How far below the roll the paper lands. A DISTANCE below the roll's axis,
   * matching `unroll.floor`, not a signed y like `cloth.floor` — the roll
   * family measures drops, and the composition is centred on the origin so
   * an absolute y would not survive the offset anyway.
   */
  floor: z.number().min(0.1).max(30).default(1.2),
  /** How long the roll coasts after the scroll stops. */
  inertia: z.number().min(0).max(1).default(0.45),
})

export type StripConfig = z.infer<typeof stripConfigSchema>

export const physicsSchema = z.union([
  z.enum(physicsNames),
  z.literal('cloth').transform(() => clothConfigSchema.parse({ type: 'cloth' })),
  z.literal('strip').transform(() => stripConfigSchema.parse({ type: 'strip' })),
  clothConfigSchema,
  stripConfigSchema,
])

export type PhysicsConfig = z.infer<typeof physicsSchema>
export type PhysicsConfigInput = z.input<typeof physicsSchema>

// ── Scene ────────────────────────────────────────────────────────────────────

export const lightingNames = [
  'studio',
  'window',
  'leaves',
  'goldenhour',
  'noir',
  'nave',
  'raking',
  'lightbox',
] as const

/**
 * The film the picture is printed on — the tone curve that maps unbounded
 * scene light onto a screen.
 *
 * This matters more here than in most 3D work because the subject is almost
 * white. A sheet of printer stock sits at `#fbfaf7`, and a lit one runs past
 * 1.0 constantly, so the whole image lives in the part of the curve where
 * tone mappers disagree most.
 *
 * - `neutral` — **the default.** Khronos PBR Neutral, built specifically to
 *   preserve hue and saturation through the highlight roll-off. On a warm
 *   backlit hall it is the only one of the three that keeps the light warm.
 * - `agx` — filmic, with a long, very graceful roll-off. It also desaturates
 *   hard as it approaches white, which is a look; on a scene whose subject
 *   IS warm light through paper it bleaches the thing you came for.
 * - `filmic` — ACES. High contrast, drifts bright neutrals toward
 *   yellow-green, and washes out badly once a source is bright enough to
 *   clip. This is what every preset was pinned to before.
 *
 * Measured on `nave` rather than argued: rendered through all three with the
 * source authored as a real HDR emitter, `neutral` holds the cream glow,
 * `agx` and `filmic` both bleach it to grey-white.
 */
export const filmNames = ['agx', 'neutral', 'filmic'] as const

/** Scene-level presentation, serialized with the paper. */
/**
 * Overrides on top of a named preset — the Blender-panel half of lighting.
 *
 * Every field is optional ON PURPOSE. An unset field means "whatever the
 * preset says", so a shared link carries the two sliders you actually moved
 * rather than a frozen copy of a rig you never touched, and re-basing onto
 * another preset keeps your intent instead of your numbers.
 */
export const lightSchema = z.object({
  /** Tone-mapping exposure — the stop the whole picture is printed at. */
  exposure: z.number().min(0.1).max(4).optional(),
  /**
   * The tone curve — the film, where `exposure` is the stop.
   *
   * `filmic` is ACES, which is what every preset used to be pinned to and is
   * kept so a scene tuned against it can say so. On near-white paper it is
   * the wrong film: it desaturates and drags bright neutrals toward
   * yellow-green, which is the sepia cast a lit sheet used to pick up.
   */
  film: z.enum(filmNames).optional(),
  /** Key light strength. */
  key: z.number().min(0).max(12).optional(),
  /** Key light colour. */
  color: z.string().optional().describe('color'),
  /**
   * Where the key stands, degrees around the vertical. 0° is straight in
   * front of the paper (+Z, beside the camera), 90° is off to the right,
   * and ±180° is directly behind it — which is where `nave` puts it, and
   * why that preset is carried by light coming THROUGH the paper.
   */
  direction: z.number().min(-180).max(180).optional(),
  /** How high the key stands, degrees above the horizon. */
  height: z.number().min(-30).max(89).optional(),
  /** Flat fill from every direction at once. Cheap, and it kills form — reach for `studio` first. */
  ambient: z.number().min(0).max(2).optional(),
  /** The room's own light: an environment map built from `sky`. Directional fill, and the only thing paper's sheen has to reflect. */
  studio: z.number().min(0).max(3).optional(),
  /** Distance haze, as a multiple of the preset's. 0 clears the air entirely; 2 halves the distance you can see. */
  haze: z.number().min(0).max(3).optional(),
})

export type LightOverrides = z.infer<typeof lightSchema>
export type LightOverridesInput = z.input<typeof lightSchema>

/**
 * What is behind the sheet.
 *
 * Optional, and that is deliberate: an unset backdrop means the canvas is
 * left exactly as it was found. `<Paper>` has always rendered onto whatever
 * is behind it, and a default that painted the frame would change the look
 * of every sheet already on a page.
 *
 * It is part of the CONFIG rather than a preview trick in the editor,
 * because the whole export story is that the code you copy makes the picture
 * you were looking at. A backdrop that existed only in the editor would make
 * the most-photographed part of a composition the one thing that does not
 * travel.
 */
export const backdropSchema = z.object({
  /** Behind everything, and behind the picture where it does not reach. */
  color: z.string().default('#171717').describe('color'),
  /** A URL, or an uploaded picture. Empty is the colour on its own. */
  image: z.string().default(''),
  fit: z.enum(['cover', 'contain']).default('cover'),
  /**
   * Toward the colour, so the paper stays the subject.
   *
   * A backdrop at full strength competes with the sheet in front of it —
   * which is what a real photographer solves by putting the background out
   * of the light, and what this solves by mixing it back toward the ground
   * it sits on.
   */
  fade: z.number().min(0).max(1).default(0.25),
  /** Out of focus, for the same reason. */
  blur: z.number().min(0).max(1).default(0.2),
})

export type BackdropConfig = z.infer<typeof backdropSchema>

export const sceneSchema = z.object({
  lighting: z.enum(lightingNames).default('studio'),
  /** What is behind the sheet. Unset leaves the canvas alone. */
  backdrop: backdropSchema.optional(),
  /**
   * Degrees the whole composition is turned about its vertical axis, so a
   * preset can choose the angle it is READ from.
   *
   * Every camera in the library is fixed and head-on — `<Paper>` sits at
   * `(0, 0.35, 2.4)` looking down -Z, and neither it nor the editor fits a
   * camera to its content. That is the right default for a sheet, which is
   * flat and faces you. It is the wrong one for anything whose shape lives
   * in DEPTH: the `strip` sim folds in z by construction, so head-on its
   * roll and the whole accordion of its pile are edge-on and the preset
   * renders as a blank white column.
   *
   * A camera field would have been the other way to fix it, and is worse: it
   * is meaningless inside `<PaperField>` and `<PaperMesh>`, where the caller
   * owns the camera and there may be a dozen papers sharing it. Turning the
   * paper works everywhere, because it is a property of the paper.
   *
   * Additive with the `rotation` prop rather than overriding it — the prop
   * is the caller's, and a preset does not get to overrule it.
   */
  turn: z.number().min(-180).max(180).default(0),
  /**
   * Overrides on the named preset — the same authorable half stage mode has
   * always had, and which a lone sheet had no way to reach.
   *
   * A preset was the starting point everywhere EXCEPT here: a stage could be
   * "nave, but the sun is lower", and a `<Paper>` could only be one of seven
   * rigs exactly as shipped. `<PaperLighting>` has taken these overrides all
   * along; nothing was passing them.
   */
  light: lightSchema.default({}),
})

export type SceneConfig = z.infer<typeof sceneSchema>
export type SceneConfigInput = z.input<typeof sceneSchema>
export type LightingName = (typeof lightingNames)[number]
export type FilmName = (typeof filmNames)[number]

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
    /**
     * What the sheet remembers being folded — creases outlive the fold.
     *
     * Present by default, and on: paper that forgets is the bug this exists
     * to fix, so remembering is not something a preset should have to ask
     * for. `memory: { set: 0 }` is the opt-out, and it is what every sheet in
     * the library did before this shipped.
     */
    memory: memorySchema.default({}),
    physics: physicsSchema.default('none'),
    scene: sceneSchema.default({}),
    onTwos: z.boolean().default(false),
    /** Interaction state machine — overrides-on-base diffs. */
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
          'a simulation (cloth, strip) and behavior/deformers are exclusive — the sim owns the vertices (pick Shape OR Simulation)',
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
