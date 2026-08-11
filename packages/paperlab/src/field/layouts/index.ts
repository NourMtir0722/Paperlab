import { z } from 'zod'
import { SHEET_LIFT, sheetLayoutSchema, sheetSlotXY, type SheetLayoutOptions } from '../sheetGrid'

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
  pose(i: number, n: number, o: O, phase: number): PaperPose
}

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
  /** Distance from a sheet's center down to the pinned corner they share. */
  hinge: z.number().min(0).max(4).default(0.78),
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
  pose(i, n, o) {
    const f = n > 1 ? i / (n - 1) : 0.5
    const theta = (f - 0.5) * o.sweep * DEG
    // Swing the sheet about the shared pivot, then shift so the middle sheet
    // sits at the origin — the fan stays centered as `sweep` opens and closes.
    const open = Math.abs(f - 0.5) * 2
    return {
      position: [-Math.sin(theta) * o.hinge, Math.cos(theta) * o.hinge - o.hinge, i * o.lift],
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
  pose(i, n, o) {
    const cols = Math.ceil(Math.sqrt(n * 1.4))
    const rows = Math.ceil(n / cols)
    const col = i % cols
    const row = Math.floor(i / cols)
    // Sheet footprint ≈ 1×1.4 world units; gaps are the breathing room.
    const cellW = 1 + o.gapX
    const cellH = 1.4 + o.gapY
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
registerLayout(sheet)
