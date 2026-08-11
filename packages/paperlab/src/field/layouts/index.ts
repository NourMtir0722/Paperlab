import { z } from 'zod'
import type { SheetDims } from '../../deformers/types'
import { SHEET_LIFT, sheetLayoutSchema, sheetSlotXY, type SheetLayoutOptions } from '../sheetGrid'
import { getWalkPath, walkPathSchema } from '../../stage/path'

/**
 * A layout is a pure `pose(i, n, options, phase)` function — no state, no
 * three.js. `phase` is the motion driver's continuous offset in turns
 * (0..1 = one full cycle); cyclic layouts use it, static ones ignore it.
 * Community layouts are ~30 lines.
 *
 * Every built-in names a place paper actually sits — a fanned swatch deck, a
 * slipped stack, a heap on a desk — because arrangement alone is what makes a
 * field read as a photo carousel instead of as paper. The other half of that
 * is `bias`: paper in the world does not all bend alike.
 */

export interface PaperPose {
  position: [number, number, number]
  rotation: [number, number, number]
  scale: number
  /**
   * How strongly this sheet takes the field's deformation: 1 = exactly as the
   * preset configures it, 0 = flat. Lets one instanced draw call curl the top
   * of a pile while the sheets pressed underneath stay flat. Omitted = 1.
   */
  bias?: number
}

export interface Layout<O = Record<string, unknown>> {
  id: string
  label: string
  defaults: O
  optionsSchema: z.ZodType<O, z.ZodTypeDef, unknown>
  /**
   * `sheet` is the field's paper size. Layouts that arrange by CONTACT —
   * edges meeting, sheets resting on each other — cannot work without it,
   * and a layout that ignores it may simply omit the parameter.
   */
  pose(i: number, n: number, o: O, phase: number, sheet: SheetDims): PaperPose
}

/** For the odd caller that has no papers yet to measure. */
export const DEFAULT_SHEET: SheetDims = { width: 1, height: 1.4 }

const TAU = Math.PI * 2
const DEG = Math.PI / 180

/** Deterministic per-index jitter — layouts must be pure. */
function jitter(seed: number, i: number): number {
  let h = Math.imul((seed * 1000 + i + 1) ^ 0x9e3779b9, 2654435761)
  h = Math.imul(h ^ (h >>> 13), 3266489917)
  return (((h ^ (h >>> 16)) >>> 0) / 4294967295) * 2 - 1
}

/** 0 at the first sheet, 1 at the last — the spine of most layouts. */
function ramp(i: number, n: number): number {
  return n > 1 ? i / (n - 1) : 1
}

const ringSchema = z.object({
  radius: z.number().min(0.5).max(12).default(2.6),
  tiltDeg: z.number().min(-45).max(45).default(8),
})
/** Prints pegged around a circle — the one carousel worth keeping. */
export const ring: Layout<z.infer<typeof ringSchema>> = {
  id: 'ring',
  label: 'Ring',
  defaults: ringSchema.parse({}),
  optionsSchema: ringSchema,
  pose(i, n, o, phase) {
    const theta = (i / n + phase) * TAU
    return {
      position: [Math.sin(theta) * o.radius, 0, Math.cos(theta) * o.radius],
      // Face radially OUTWARD so the papers nearest the camera show their
      // front (content) side — you stand outside the ring, not inside it.
      rotation: [(o.tiltDeg * Math.PI) / 180, theta, 0],
      scale: 1,
    }
  },
}

const fanSchema = z.object({
  /** Total angular sweep from the first sheet to the last, degrees. */
  sweep: z.number().min(0).max(180).default(72),
  /** Where the shared pin sits, in half-sheet-heights below center. 1 = the bottom edge. */
  hinge: z.number().min(0).max(4).default(1.15),
  /** Thickness step so the sheets stack in order instead of z-fighting. */
  lift: z.number().min(0.002).max(0.08).default(0.012),
  /** How much flatter the middle of the fan sits than its outer sheets. */
  bow: z.number().min(0).max(1).default(0.7),
})
/**
 * A Pantone deck, a paint-chip book, a hand of cards: every sheet pinned at
 * one shared point and swung open. The sheets nearest the outside of the
 * sweep carry the most curl, which is what sells the hinge as a hinge.
 */
export const fan: Layout<z.infer<typeof fanSchema>> = {
  id: 'fan',
  label: 'Fan',
  defaults: fanSchema.parse({}),
  optionsSchema: fanSchema,
  pose(i, n, o, _phase, sheet) {
    const f = n > 1 ? i / (n - 1) : 0.5
    const theta = (f - 0.5) * o.sweep * DEG
    const hinge = (o.hinge * sheet.height) / 2
    // Swing the sheet about the shared pivot, then shift so the middle sheet
    // sits at the origin — the fan stays centered as `sweep` opens and closes.
    const open = Math.abs(f - 0.5) * 2
    return {
      position: [-Math.sin(theta) * hinge, Math.cos(theta) * hinge - hinge, i * o.lift],
      rotation: [0, 0, theta],
      scale: 1,
      bias: 1 - (1 - open) * o.bow,
    }
  },
}

const spreadSchema = z.object({
  /** How far each sheet slides past the one below it. */
  slip: z.number().min(0.02).max(2).default(0.3),
  /** Direction of the slide, degrees. 0 slides right, 90 slides up. */
  angle: z.number().min(-180).max(180).default(28),
  lift: z.number().min(0.002).max(0.08).default(0.012),
  /** How much more the sheets at the far end of the slide bow. */
  bow: z.number().min(0).max(1).default(0.6),
  /** Nothing hand-slid is perfectly square — a touch of per-sheet rotation. */
  drift: z.number().min(0).max(1).default(0.15),
})
/**
 * A ream pushed sideways, or a deck dealt across a table: parallel sheets at
 * a constant offset, each one bowing a little more as it comes free of the
 * stack's weight.
 */
export const spread: Layout<z.infer<typeof spreadSchema>> = {
  id: 'spread',
  label: 'Spread',
  defaults: spreadSchema.parse({}),
  optionsSchema: spreadSchema,
  pose(i, n, o) {
    const centered = i - (n - 1) / 2
    const a = o.angle * DEG
    return {
      position: [Math.cos(a) * o.slip * centered, Math.sin(a) * o.slip * centered, i * o.lift],
      rotation: [0, 0, jitter(11, i) * 0.2 * o.drift],
      scale: 1,
      bias: 1 - (1 - ramp(i, n)) * o.bow,
    }
  },
}

const pileSchema = z.object({
  /** How far sheets wander from the center of the heap. */
  scatter: z.number().min(0).max(2).default(0.22),
  /** Widest angle a sheet sits off square, degrees. */
  turn: z.number().min(0).max(180).default(24),
  lift: z.number().min(0.002).max(0.08).default(0.011),
  /** How flat the sheets underneath are pressed by the ones on top. */
  press: z.number().min(0).max(1).default(0.85),
  seed: z.number().int().min(0).max(9999).default(3),
})
/**
 * The heap on a desk. The physical tell no parametric curve can fake: sheets
 * rest ON each other, so only the top of the pile keeps its curl and
 * everything below is pressed flat by the weight above it.
 */
export const pile: Layout<z.infer<typeof pileSchema>> = {
  id: 'pile',
  label: 'Pile',
  defaults: pileSchema.parse({}),
  optionsSchema: pileSchema,
  pose(i, n, o) {
    return {
      position: [jitter(o.seed, i) * o.scatter, jitter(o.seed + 1, i) * o.scatter * 0.8, i * o.lift],
      rotation: [0, 0, jitter(o.seed + 2, i) * o.turn * DEG],
      scale: 1,
      bias: 1 - (1 - ramp(i, n)) * o.press,
    }
  },
}

const wallSchema = z.object({
  gapX: z.number().min(0.05).max(1).default(0.22),
  gapY: z.number().min(0.05).max(1).default(0.3),
  jitterAmt: z.number().min(0).max(1).default(0.25),
  /** Spread of sag across the wall — no two pinned sheets hang alike. */
  sag: z.number().min(0).max(1).default(0.45),
})
/** A studio wall of pinned sheets: a grid, but nothing hangs quite square. */
export const wall: Layout<z.infer<typeof wallSchema>> = {
  id: 'wall',
  label: 'Wall',
  defaults: wallSchema.parse({}),
  optionsSchema: wallSchema,
  pose(i, n, o, _phase, sheet) {
    const cols = Math.ceil(Math.sqrt((n * sheet.height) / sheet.width))
    const rows = Math.ceil(n / cols)
    const col = i % cols
    const row = Math.floor(i / cols)
    // Gaps are breathing room around the real paper — a wall of 1.2×0.9
    // prints and a wall of 1×1.4 letters both want even gutters.
    const cellW = sheet.width + o.gapX
    const cellH = sheet.height + o.gapY
    return {
      position: [
        (col - (cols - 1) / 2) * cellW,
        ((rows - 1) / 2 - row) * cellH,
        jitter(5, i) * 0.04 * o.jitterAmt * 4,
      ],
      rotation: [0, 0, jitter(6, i) * 0.05 * o.jitterAmt * 4],
      scale: 1,
      bias: 1 - Math.abs(jitter(7, i)) * o.sag,
    }
  },
}

const spillSchema = z.object({
  spreadX: z.number().min(0.5).max(8).default(2.4),
  spreadY: z.number().min(0.5).max(8).default(1.5),
  depth: z.number().min(0).max(6).default(1.6),
  /** How far sheets pitch and roll out of the picture plane. */
  tumble: z.number().min(0).max(1).default(0.5),
  /** Spread of bend across the sheets — a spill does not fold them alike. */
  vary: z.number().min(0).max(1).default(0.6),
  seed: z.number().int().min(0).max(9999).default(7),
})
/**
 * A dropped folder's worth of paper, mid-air — what a `pile` looks like the
 * moment before it settles. Loose in all three axes, and (the part that
 * separates it from confetti) every sheet caught at its own angle AND its
 * own amount of bend.
 */
export const spill: Layout<z.infer<typeof spillSchema>> = {
  id: 'spill',
  label: 'Spill',
  defaults: spillSchema.parse({}),
  optionsSchema: spillSchema,
  pose(i, _n, o) {
    const tumble = o.tumble * 2
    return {
      position: [
        jitter(o.seed, i) * o.spreadX,
        jitter(o.seed + 1, i) * o.spreadY,
        jitter(o.seed + 2, i) * o.depth,
      ],
      rotation: [
        jitter(o.seed + 3, i) * 0.4 * tumble,
        jitter(o.seed + 4, i) * 0.5 * tumble,
        jitter(o.seed + 5, i) * 0.4 * tumble,
      ],
      scale: 0.85 + Math.abs(jitter(o.seed + 6, i)) * 0.3,
      bias: 1 - Math.abs(jitter(o.seed + 7, i)) * o.vary,
    }
  },
}

const sweepSchema = z.object({
  columns: z.number().int().min(1).max(24).default(5),
  /** Breathing room around each specimen. */
  gap: z.number().min(0).max(2).default(0.22),
  /** Deformation at the first specimen and at the last. */
  from: z.number().min(0).max(1).default(0),
  to: z.number().min(0).max(1).default(1),
})
/**
 * A specimen chart: the same sheet mounted in a grid, its deformation ramped
 * across the series so one image shows a curl at ten stages instead of one.
 * The layout the rest of this library exists to make possible — and the one
 * that documents every deformer for free.
 *
 * Only as legible as the preset it charts: a sheet with no behavior or
 * deformers has nothing for the ramp to scale, and every specimen comes out
 * identical.
 */
export const sweep: Layout<z.infer<typeof sweepSchema>> = {
  id: 'sweep',
  label: 'Sweep',
  defaults: sweepSchema.parse({}),
  optionsSchema: sweepSchema,
  pose(i, n, o, _phase, sheet) {
    const cols = Math.min(o.columns, Math.max(n, 1))
    const rows = Math.ceil(n / cols)
    const col = i % cols
    const row = Math.floor(i / cols)
    return {
      position: [
        (col - (cols - 1) / 2) * (sheet.width + o.gap),
        ((rows - 1) / 2 - row) * (sheet.height + o.gap),
        0,
      ],
      rotation: [0, 0, 0],
      scale: 1,
      bias: o.from + (o.to - o.from) * ramp(i, n),
    }
  },
}

const bookSchema = z.object({
  /** How far the outermost page lifts off the block, degrees. */
  spread: z.number().min(0).max(150).default(55),
  /** Fraction of the pages bound to the left. 0 = a one-sided sample book. */
  split: z.number().min(0).max(1).default(0.5),
  /** Page thickness — the gap between pages of one block. */
  lift: z.number().min(0.001).max(0.05).default(0.008),
  /** How much more a lifted page arcs than one lying flat in the block. */
  gutter: z.number().min(0).max(1).default(0.6),
})
/**
 * An open codex: pages hinged on a shared spine, each block splaying away
 * from the gutter. `split` slides it between the two bound forms paper takes
 * — 0.5 is a book lying open, 0 is a swatch deck or sample book bound down
 * one side. Pages lying flat in the block are pressed by the ones above;
 * only the lifted pages keep their arc.
 */
export const book: Layout<z.infer<typeof bookSchema>> = {
  id: 'book',
  label: 'Book',
  defaults: bookSchema.parse({}),
  optionsSchema: bookSchema,
  pose(i, n, o, _phase, sheet) {
    const half = sheet.width / 2
    const left = Math.round(n * o.split)
    const onLeft = i < left
    const count = onLeft ? left : n - left
    const k = onLeft ? i : i - left
    const f = count > 1 ? k / (count - 1) : 1
    const theta = f * o.spread * DEG
    // Swing the page about the spine at x = 0; `side` mirrors the left block.
    const side = onLeft ? -1 : 1
    const cos = Math.cos(theta)
    const sin = Math.sin(theta)
    // Stack along the page's own normal so pages standing near-vertical
    // separate sideways rather than sinking into each other.
    const offset = k * o.lift
    return {
      position: [side * (half * cos - offset * sin), 0, half * sin + offset * cos],
      rotation: [0, -side * theta, 0],
      scale: 1,
      bias: 1 - (1 - f) * o.gutter,
    }
  },
}

const accordionSchema = z.object({
  /** How far each panel tilts off the strip's line, degrees. 0 = flat, 90 = shut. */
  angle: z.number().min(0).max(89).default(55),
  /** A concertina holds its creases — how much bow the panels keep. */
  slack: z.number().min(0).max(1).default(0.15),
})
/**
 * A concertina: panels alternating about creases they genuinely share, so
 * the sheets read as ONE folded strip rather than as N separate papers —
 * the only layout here where that is true. Adjacent edges are solved to
 * meet, which is why it needs the sheet's real width.
 */
export const accordion: Layout<z.infer<typeof accordionSchema>> = {
  id: 'accordion',
  label: 'Accordion',
  defaults: accordionSchema.parse({}),
  optionsSchema: accordionSchema,
  pose(i, n, o, _phase, sheet) {
    const theta = o.angle * DEG
    const side = i % 2 === 0 ? 1 : -1
    // Solving edge-meets-edge for alternating ±angle puts every panel center
    // on one line, spaced by the panel's foreshortened width.
    const step = sheet.width * Math.cos(theta)
    return {
      position: [(i - (n - 1) / 2) * step, 0, 0],
      rotation: [0, side * theta, 0],
      scale: 1,
      bias: o.slack,
    }
  },
}

const rackSchema = z.object({
  /** Gap along the row, as a fraction of the paper's width. Under 1 they overlap. */
  spacing: z.number().min(0.05).max(2).default(0.82),
  /** How far a sheet leans back off vertical, degrees. */
  lean: z.number().min(0).max(70).default(16),
  /** How much that lean differs sheet to sheet — nothing propped is uniform. */
  vary: z.number().min(0).max(1).default(0.55),
  /** Small rotations off square. */
  sway: z.number().min(0).max(1).default(0.35),
  seed: z.number().int().min(0).max(9999).default(5),
})
/**
 * Prints stood in a row and leaning back — against a wall, in a rack, propped
 * along a shelf. The one arrangement here that RESTS on a surface rather than
 * floating: every sheet pivots on the bottom edge it actually stands on, so
 * the row shares a floor. The further a sheet has leaned, the more it bows
 * under its own weight.
 *
 * (Stacking these front-to-back the way a letter tray really holds paper is
 * physically honest and visually useless — the front sheet hides the rest.
 * A row is the arrangement you can actually see.)
 */
export const rack: Layout<z.infer<typeof rackSchema>> = {
  id: 'rack',
  label: 'Rack',
  defaults: rackSchema.parse({}),
  optionsSchema: rackSchema,
  pose(i, n, o, _phase, sheet) {
    const lean = o.lean * DEG * (1 + jitter(o.seed, i) * o.vary)
    const half = sheet.height / 2
    return {
      position: [
        (i - (n - 1) / 2) * sheet.width * o.spacing,
        // Standing on the floor: the bottom edge stays at y = 0 as it leans.
        half * Math.cos(lean),
        -half * Math.sin(lean) + i * 0.004,
      ],
      rotation: [-lean, jitter(o.seed + 1, i) * 0.12 * o.sway, jitter(o.seed + 2, i) * 0.06 * o.sway],
      scale: 1,
      // A sheet leaning further has more of its own weight to carry.
      bias: o.lean === 0 ? 0 : Math.min(1, lean / (o.lean * DEG * (1 + o.vary))),
    }
  },
}

const colonnadeSchema = z.object({
  /** The walk the colonnade is built along — see `stage/path`. */
  path: walkPathSchema.default({}),
  /** Half-width of the clear aisle: how far each banner stands off the walk line. */
  aisle: z.number().min(0.2).max(20).default(2.4),
  /** How much that gap opens and closes along the walk. Nothing hung by hand is a corridor. */
  breathe: z.number().min(0).max(1).default(0.3),
  /** Widest angle a banner turns off square to the aisle, degrees. */
  twist: z.number().min(0).max(90).default(22),
  /** Fraction of the walk left clear at each end, so the figure has somewhere to enter from. */
  margin: z.number().min(0).max(0.45).default(0.05),
  /** Spread of banner heights, 0..1. */
  rise: z.number().min(0).max(1).default(0.28),
  /** How far the banners lift off the floor, as a fraction of their height. 0 = they pool on it. */
  hover: z.number().min(0).max(1).default(0),
  /** Spread of deformation — no two lengths of hung paper drape alike. */
  drape: z.number().min(0).max(1).default(0.5),
  seed: z.number().int().min(0).max(9999).default(2),
})
/**
 * A nave of hanging banners flanking a walk: paper as ARCHITECTURE rather
 * than as an object on a desk. The first layout here that arranges along a
 * path instead of around an origin, which is what lets a figure walk through
 * it — the aisle is guaranteed clear because the banners are placed off the
 * walk line, not merely near it.
 *
 * Banners alternate ranks (left, right, left…) and the two ranks are
 * staggered by a quarter step, so you pass them one at a time rather than
 * through a ladder of matched pairs. Each faces across the aisle: a banner
 * ahead of you presents its face, which is the whole reason to print
 * anything on it.
 */
export const colonnade: Layout<z.infer<typeof colonnadeSchema>> = {
  id: 'colonnade',
  label: 'Colonnade',
  defaults: colonnadeSchema.parse({}),
  optionsSchema: colonnadeSchema,
  pose(i, n, o, phase, sheet) {
    const path = getWalkPath(o.path)
    const side = i % 2 === 0 ? 1 : -1
    const pairs = Math.max(Math.ceil(n / 2), 1)
    const k = Math.floor(i / 2)
    const span = 1 - o.margin * 2
    const step = pairs > 1 ? span / (pairs - 1) : 0
    const base = o.margin + (pairs > 1 ? k * step : span / 2) + side * step * 0.25
    // Only a closed walk can slide: on an open one, offsetting by phase would
    // teleport the far banner back to the near end mid-shot.
    const s = path.closed ? base + phase : base
    const [px, pz] = path.pointAt(s)
    const [nx, nz] = path.normalAt(s)
    const scale = 1 + jitter(o.seed, i) * o.rise * 0.5
    const offset = o.aisle * (1 + jitter(o.seed + 1, i) * o.breathe)
    const height = sheet.height * scale
    // Face the centerline: the inward direction is the aisle normal, negated
    // on whichever rank this banner stands in.
    const yaw = Math.atan2(-side * nx, -side * nz) + jitter(o.seed + 2, i) * o.twist * DEG
    return {
      position: [px + nx * side * offset, height / 2 + height * o.hover, pz + nz * side * offset],
      rotation: [0, yaw, 0],
      scale,
      bias: 1 - Math.abs(jitter(o.seed + 3, i)) * o.drape,
    }
  },
}

/**
 * A block of stamps: flat rows × columns grid in register, floating a hair
 * above the (field-rendered) backing sheet. Standard layout contract — it
 * also works standalone as a plain grid; `backing`/`backingMargin` are read
 * by the field renderer, not by `pose`.
 */
export const sheet: Layout<SheetLayoutOptions> = {
  id: 'sheet',
  label: 'Sheet',
  defaults: sheetLayoutSchema.parse({}),
  optionsSchema: sheetLayoutSchema,
  pose(i, _n, o) {
    const { x, y } = sheetSlotXY(i, o)
    return { position: [x, y, SHEET_LIFT], rotation: [0, 0, 0], scale: 1 }
  },
}

const registry = new Map<string, Layout<any>>()

export function registerLayout(layout: Layout<any>): void {
  registry.set(layout.id, layout)
}

export function getLayout(id: string): Layout<any> {
  const layout = registry.get(id)
  if (!layout) {
    throw new Error(`[paperlab] Unknown layout "${id}". Registered: ${[...registry.keys()].join(', ')}`)
  }
  return layout
}

export function listLayouts(): string[] {
  return [...registry.keys()]
}

registerLayout(ring)
registerLayout(fan)
registerLayout(spread)
registerLayout(pile)
registerLayout(wall)
registerLayout(spill)
registerLayout(sweep)
registerLayout(book)
registerLayout(accordion)
registerLayout(rack)
registerLayout(colonnade)
registerLayout(sheet)
