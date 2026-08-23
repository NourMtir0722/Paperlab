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
    meta: { name: 'Hero peel', tags: ['peel', 'card', 'hero'] },
    sheet: { width: 1.5, height: 1 },
    stock: 'photo-gloss',
    // Was a live Unsplash URL — a third-party network fetch inside one of
    // the first things anybody renders, which fails offline, behind a proxy,
    // under a strict CSP, and on the day the URL changes. The demo here is
    // the PEEL; the photograph was incidental, and a typeset card is both
    // self-contained and more on-brand for a paper library.
    content: {
      type: 'card',
      title: 'Print no. 4',
      body: 'Lift the corner.',
      note: 'Gloss, 240gsm',
      align: 'center',
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
    meta: { name: 'Hanging poster', tags: ['hang', 'text', 'wind'] },
    sheet: { width: 1.1, height: 1.55 },
    stock: 'printer',
    // Also de-Unsplashed. A poster is a typographic object anyway — every
    // paper installation worth the name hangs WORDS — so this shows off the
    // tracking and the optical centring rather than someone else's photo.
    content: {
      type: 'text',
      text: 'THE\nPAPER\nSHOW',
      size: 96,
      align: 'center',
      valign: 'center',
      tracking: 0.08,
      lineHeight: 1.15,
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
  // The driving use case: one stamp of the 2×5 block. Hover peels the
  // outward-facing corner ('auto' resolves per sheet slot), pressing deepens
  // the peel; the perforation tears when it detaches (field auto-wiring).
  'postage-stamp': {
    meta: { name: 'Postage stamp', tags: ['sticker', 'stamp', 'states', 'sheet'] },
    sheet: { width: 0.64, height: 0.78, thickness: 0.08 },
    stock: 'sticker',
    // No `src`: a stamp's art is the caller's, and the library ships no
    // assets and fetches none. The perforation, the sticker stock and the
    // peel — which is what this preset is actually here to demonstrate —
    // all read perfectly well on bare stock.
    content: { type: 'image', fit: 'cover', alt: 'A postage stamp' },
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
    // Same: the field starter is a CONTAINER. Its whole documented use is
    // `<PaperField images={photos} preset="photo-print" />`, where the
    // photographs are the caller's.
    content: { type: 'image', fit: 'cover', alt: 'A photographic print' },
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
  /**
   * The second after the fall. `fall` is a sheet still arguing with the air;
   * this one has stopped — which is the half of the story the library could
   * not tell, and the half every paper installation is actually made of.
   */
  /**
   * A strip hung the full drop of a room. Tall and narrow on purpose: the
   * proportion IS the object, and a ribbon that is not much longer than it
   * is wide is a poster.
   */
  'paper-ribbon': {
    meta: { name: 'Paper ribbon', tags: ['ribbon', 'hang', 'text'] },
    sheet: { width: 0.85, height: 6.4 },
    stock: 'printer',
    content: {
      type: 'text',
      // Short words, set small. The measure on a 0.85-wide strip is about
      // 220px at texture resolution, and anything larger breaks mid-word —
      // a ribbon reading "an d th e pa pe r" is a ribbon nobody can read.
      text: 'the paper\nkept going\nlong after\nthe floor\nran out',
      size: 34,
      align: 'center',
      valign: 'center',
      lineHeight: 1.5,
      tracking: 0.02,
    },
    behavior: { type: 'ribbon', pool: 0.17, curl: 0.42, drape: 0.55 },
    surface: { grain: 0.18 },
  },
  'settled-sheet': {
    meta: { name: 'Settled sheet', tags: ['settle', 'floor', 'text'] },
    sheet: { width: 1.2, height: 0.9 },
    stock: 'printer',
    content: {
      type: 'card',
      title: 'Found',
      body: 'on the floor, face up,\nwhere somebody dropped it.',
      note: 'no. 31',
    },
    behavior: { type: 'settle', relax: 0.6, lift: 0.5, slack: 0.45 },
    surface: { grain: 0.2 },
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
