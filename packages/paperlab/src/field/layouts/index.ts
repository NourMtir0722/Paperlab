import { z } from 'zod'

/**
 * A layout is a pure `pose(i, n, options, phase)` function — no state, no
 * three.js. `phase` is the motion driver's continuous offset in turns
 * (0..1 = one full cycle); cyclic layouts use it, static ones ignore it.
 * Community layouts are ~30 lines.
 */

export interface PaperPose {
  position: [number, number, number]
  rotation: [number, number, number]
  scale: number
}

export interface Layout<O = Record<string, unknown>> {
  id: string
  label: string
  defaults: O
  optionsSchema: z.ZodType<O, z.ZodTypeDef, unknown>
  pose(i: number, n: number, o: O, phase: number): PaperPose
}

const TAU = Math.PI * 2

/** Deterministic per-index jitter — layouts must be pure. */
function jitter(seed: number, i: number): number {
  let h = Math.imul((seed * 1000 + i + 1) ^ 0x9e3779b9, 2654435761)
  h = Math.imul(h ^ (h >>> 13), 3266489917)
  return (((h ^ (h >>> 16)) >>> 0) / 4294967295) * 2 - 1
}

const ringSchema = z.object({
  radius: z.number().min(0.5).max(12).default(2.6),
  tiltDeg: z.number().min(-45).max(45).default(8),
})
export const ring: Layout<z.infer<typeof ringSchema>> = {
  id: 'ring',
  label: 'Ring',
  defaults: ringSchema.parse({}),
  optionsSchema: ringSchema,
  pose(i, n, o, phase) {
    const theta = (i / n + phase) * TAU
    return {
      position: [Math.sin(theta) * o.radius, 0, Math.cos(theta) * o.radius],
      rotation: [(o.tiltDeg * Math.PI) / 180, theta + Math.PI, 0],
      scale: 1,
    }
  },
}

const deckSchema = z.object({
  spread: z.number().min(0).max(1).default(0.3),
  lift: z.number().min(0.005).max(0.08).default(0.014),
})
export const deck: Layout<z.infer<typeof deckSchema>> = {
  id: 'deck',
  label: 'Deck',
  defaults: deckSchema.parse({}),
  optionsSchema: deckSchema,
  pose(i, _n, o) {
    return {
      position: [
        jitter(1, i) * 0.09 * o.spread * 3,
        jitter(2, i) * 0.07 * o.spread * 3,
        i * o.lift,
      ],
      rotation: [0, 0, jitter(3, i) * 0.35 * o.spread],
      scale: 1,
    }
  },
}

const cascadeSchema = z.object({
  gap: z.number().min(0.2).max(2).default(0.55),
  drop: z.number().min(0).max(1).default(0.2),
})
export const cascade: Layout<z.infer<typeof cascadeSchema>> = {
  id: 'cascade',
  label: 'Cascade',
  defaults: cascadeSchema.parse({}),
  optionsSchema: cascadeSchema,
  pose(i, n, o) {
    const centered = i - (n - 1) / 2
    return {
      position: [centered * o.gap, -centered * o.drop, -i * 0.06],
      rotation: [0, 0, jitter(4, i) * 0.06],
      scale: 1,
    }
  },
}

const helixSchema = z.object({
  radius: z.number().min(0.5).max(12).default(2.2),
  height: z.number().min(0.5).max(10).default(2.6),
  turns: z.number().min(0.5).max(5).default(1.5),
})
export const helix: Layout<z.infer<typeof helixSchema>> = {
  id: 'helix',
  label: 'Helix',
  defaults: helixSchema.parse({}),
  optionsSchema: helixSchema,
  pose(i, n, o, phase) {
    const f = n > 1 ? i / (n - 1) : 0
    const theta = (f * o.turns + phase) * TAU
    return {
      position: [Math.sin(theta) * o.radius, (f - 0.5) * o.height, Math.cos(theta) * o.radius],
      rotation: [0, theta + Math.PI, 0],
      scale: 1,
    }
  },
}

const wallSchema = z.object({
  gapX: z.number().min(0.05).max(1).default(0.22),
  gapY: z.number().min(0.05).max(1).default(0.3),
  jitterAmt: z.number().min(0).max(1).default(0.25),
})
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
    }
  },
}

const tunnelSchema = z.object({
  radius: z.number().min(0.5).max(6).default(1.7),
  spacing: z.number().min(0.1).max(3).default(0.55),
})
export const tunnel: Layout<z.infer<typeof tunnelSchema>> = {
  id: 'tunnel',
  label: 'Tunnel',
  defaults: tunnelSchema.parse({}),
  optionsSchema: tunnelSchema,
  pose(i, _n, o, phase) {
    // Golden-angle winding lines the tube; phase pulls the tunnel past you.
    const theta = i * 2.39996 + phase * TAU
    return {
      position: [Math.cos(theta) * o.radius, Math.sin(theta) * o.radius, -i * o.spacing],
      rotation: [0, 0, theta - Math.PI / 2],
      scale: 1,
    }
  },
}

const scatterSchema = z.object({
  spreadX: z.number().min(0.5).max(8).default(2.4),
  spreadY: z.number().min(0.5).max(8).default(1.5),
  depth: z.number().min(0).max(6).default(1.6),
  seed: z.number().int().min(0).max(9999).default(7),
})
export const scatter: Layout<z.infer<typeof scatterSchema>> = {
  id: 'scatter',
  label: 'Scatter',
  defaults: scatterSchema.parse({}),
  optionsSchema: scatterSchema,
  pose(i, _n, o) {
    return {
      position: [
        jitter(o.seed, i) * o.spreadX,
        jitter(o.seed + 1, i) * o.spreadY,
        jitter(o.seed + 2, i) * o.depth,
      ],
      rotation: [jitter(o.seed + 3, i) * 0.4, jitter(o.seed + 4, i) * 0.5, jitter(o.seed + 5, i) * 0.4],
      scale: 0.85 + Math.abs(jitter(o.seed + 6, i)) * 0.3,
    }
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
registerLayout(deck)
registerLayout(cascade)
registerLayout(helix)
registerLayout(wall)
registerLayout(tunnel)
registerLayout(scatter)
