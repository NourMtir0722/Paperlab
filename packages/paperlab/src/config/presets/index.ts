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
  'blank-sheet': {
    meta: { name: 'Blank sheet', tags: ['starter'] },
    stock: 'printer',
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

export function getPreset(name: string): PaperConfig {
  const raw = builtins[name]
  if (!raw) {
    throw new Error(
      `[paperlab] Unknown preset "${name}". Built-ins: ${Object.keys(builtins).join(', ')}`,
    )
  }
  return paperConfigSchema.parse(raw)
}

export function listPresets(): string[] {
  return Object.keys(builtins)
}
