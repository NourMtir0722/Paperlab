import { paperConfigSchema, type PaperConfig, type PaperConfigInput } from '../schema'

/**
 * Built-in `.paper` presets. A preset is the serialized closure of one Paper —
 * the unit of saving, sharing, and code export. Stored as plain JSON-safe
 * objects, validated on access.
 */
const builtins: Record<string, PaperConfigInput> = {
  'receipt-unroll': {
    meta: { name: 'Receipt unroll', tags: ['receipt', 'unroll', 'hero'] },
    sheet: { width: 1, height: 2.6 },
    stock: 'thermal',
    content: {
      type: 'receipt',
      store: 'nawwara.studio',
      address: '124 Paper St',
      items: [
        { name: 'Curl, true', price: 12 },
        { name: 'Roll, tight', price: 8.5 },
        { name: 'Sheet, one', price: 0.99 },
      ],
      timestamp: '11.07.2026 18:42',
    },
    behavior: { type: 'unroll', progress: 0.55, tightness: 0.55, sway: 0.3 },
    surface: { deckle: { edges: ['bottom'], roughness: 0.6 } },
  },
  'letter-fold': {
    meta: { name: 'Letter fold', tags: ['fold', 'text'] },
    sheet: { width: 1, height: 1.4 },
    stock: 'printer',
    content: {
      type: 'text',
      text: 'Dear you,\n\nSome things are worth folding carefully.\n\nYours,\nN.',
    },
    behavior: { type: 'letter-fold', progress: 0.4, crease: 0.3 },
    surface: { creaseLines: { angle: 0, positions: [1 / 3, 2 / 3], strength: 0.5 } },
  },
  'vintage-note': {
    meta: { name: 'Vintage note', tags: ['aging', 'text'] },
    sheet: { width: 1.1, height: 1.4 },
    stock: 'newsprint',
    content: {
      type: 'text',
      text: 'FOUND, ONE PAPER ENGINE.\n\nReward if returned to the web.',
      font: 'Georgia, serif',
      size: 40,
    },
    behavior: { type: 'peel', progress: 0.18, corner: 'top-right', radius: 0.22 },
    surface: { aging: 0.55, grain: 0.6, deckle: { edges: ['top', 'bottom'], roughness: 0.4 } },
  },
  'hero-peel': {
    meta: { name: 'Hero peel', tags: ['peel', 'image', 'hero'] },
    sheet: { width: 1.5, height: 1 },
    stock: 'photo-gloss',
    content: {
      type: 'image',
      src: 'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=1200&q=80',
      fit: 'cover',
    },
    behavior: { type: 'peel', progress: 0.35, corner: 'bottom-right', radius: 0.16 },
  },
  'page-flip': {
    meta: { name: 'Page flip', tags: ['flip', 'text'] },
    sheet: { width: 1, height: 1.4 },
    stock: 'printer',
    content: {
      type: 'text',
      text: 'Chapter One\n\nIt was a paper town, and everything in it folded.',
    },
    behavior: { type: 'flip', progress: 0.3, spine: 'left', radius: 0.3 },
  },
  'hanging-poster': {
    meta: { name: 'Hanging poster', tags: ['hang', 'image', 'wind'] },
    sheet: { width: 1.1, height: 1.55 },
    stock: 'printer',
    content: {
      type: 'image',
      src: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1200&q=80',
      fit: 'cover',
    },
    behavior: { type: 'hang', wind: 0.45, sag: 0.3 },
  },
  'pinned-sheet': {
    meta: { name: 'Pinned sheet', tags: ['cloth', 'wind', 'interactive'] },
    sheet: { width: 1.2, height: 1.5 },
    stock: 'printer',
    content: {
      type: 'text',
      text: 'Grab me.\n\n(cloth: pinned at the top edge,\nwind from the left)',
      size: 40,
    },
    physics: { type: 'cloth', pins: 'top-edge', wind: 0.45, stiffness: 0.8, gravity: 1, floor: -1.4 },
  },
  'flying-note': {
    meta: { name: 'Flying note', tags: ['fly', 'tumble', 'text'] },
    sheet: { width: 1, height: 0.7 },
    stock: 'printer',
    content: {
      type: 'text',
      text: 'meet me where\nthe paper lands',
      size: 52,
      align: 'center',
      padding: 0.16,
    },
    behavior: { type: 'fly', flutter: 0.55, curve: 0.45 },
    physics: 'tumble',
  },
  'blank-sheet': {
    meta: { name: 'Blank sheet', tags: ['starter'] },
    stock: 'printer',
  },
  // The M6 driving use case: one stamp of the 2×5 block. Hover peels the
  // outward-facing corner ('auto' resolves per sheet slot), pressing deepens
  // the peel; the perforation tears when it detaches (field auto-wiring).
  'postage-stamp': {
    meta: { name: 'Postage stamp', tags: ['sticker', 'stamp', 'states', 'sheet'] },
    sheet: { width: 0.64, height: 0.78, thickness: 0.08 },
    stock: 'sticker',
    content: {
      type: 'image',
      src: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=600&q=80',
      fit: 'cover',
      alt: 'A forest stamp',
    },
    behavior: { type: 'peel', progress: 0, corner: 'auto', radius: 0.12 },
    surface: { perforation: { edges: 'all', holeRadius: 0.014, spacing: 0.05 } },
    states: {
      initial: 'rest',
      states: {
        hover: {
          overrides: { behavior: { progress: 0.22 } },
          transition: { duration: 0.25, ease: 'power2.out' },
        },
        pressed: {
          overrides: { behavior: { progress: 0.5 } },
          transition: { duration: 0.16, ease: 'power3.out' },
        },
        // Picked is auto-choreographed at pick time (carry hanging from the
        // peeled corner); placed announces itself for a host postmark overlay.
        placed: { overrides: {}, onEnter: ['emit:postmark'] },
      },
      pickThreshold: 0.08,
    },
  },
  'photo-print': {
    meta: { name: 'Photo print', tags: ['image', 'starter'] },
    sheet: { width: 1.2, height: 0.9 },
    stock: 'photo-gloss',
    content: {
      type: 'image',
      src: 'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=1200&q=80',
      fit: 'cover',
    },
    // No print lies perfectly flat. A shade of bow is the whole difference
    // between a sheet of paper and a rectangle — and since this is the field
    // starter, it is what a layout's per-sheet bias has to scale.
    deformers: [{ type: 'bend', options: { curvature: 0.35, angle: 0 } }],
  },
  'crumpled-note': {
    meta: { name: 'Crumpled note', tags: ['crumple', 'text', 'handled'] },
    sheet: { width: 1.1, height: 1.4 },
    stock: 'printer',
    content: {
      type: 'text',
      text: 'I wrote it out three times\nand threw all three away.',
      size: 42,
    },
    behavior: { type: 'crumple', progress: 0.62, coarseness: 0.4, ball: 0.55 },
    // Handled paper is dirty paper: the grain is what stops the facets
    // reading as folded plastic.
    surface: { grain: 0.5, aging: 0.18 },
  },
  'typed-note': {
    meta: { name: 'Typed note', tags: ['text', 'starter'] },
    sheet: { width: 1, height: 1.4 },
    stock: 'printer',
    content: {
      type: 'text',
      text: 'Dear reader,\n\nPaper is the product. Everything else hangs off the sheet.\n\n— Paperlab',
    },
  },
}

/** User presets registered at runtime (the editor persists these to localStorage). */
const userPresets = new Map<string, PaperConfigInput>()

export function getPreset(name: string): PaperConfig {
  const raw = builtins[name] ?? userPresets.get(name)
  if (!raw) {
    throw new Error(`[paperlab] Unknown preset "${name}". Registered: ${listPresets().join(', ')}`)
  }
  return paperConfigSchema.parse(raw)
}

/** Register a user preset (validated). Built-in names are reserved. */
export function registerPreset(name: string, input: PaperConfigInput): void {
  if (name in builtins) {
    throw new Error(`[paperlab] "${name}" is a built-in preset — pick another name.`)
  }
  paperConfigSchema.parse(input) // fail fast on invalid configs
  userPresets.set(name, input)
}

export function unregisterPreset(name: string): void {
  userPresets.delete(name)
}

export function isBuiltinPreset(name: string): boolean {
  return name in builtins
}

export function listPresets(): string[] {
  return [...Object.keys(builtins), ...userPresets.keys()]
}

/**
 * A collision-free preset name built from `base`: `base`, else `base 2`,
 * `base 3`, … The disambiguating suffix always grows from the SAME base — a
 * name derived from a synthetic base (e.g. an untitled import → "imported")
 * must not fall back to the original when it collides. `taken` reports whether
 * a candidate is already used (built-in or user preset).
 */
export function uniquePresetName(base: string, taken: (name: string) => boolean): string {
  if (!taken(base)) return base
  let n = 2
  let name = `${base} ${n}`
  while (taken(name)) name = `${base} ${++n}`
  return name
}
