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
      type: 'text',
      text: 'NAWWARA.STUDIO\n124 PAPER ST\n\nCURL, TRUE       12.00\nROLL, TIGHT       8.50\nSHEET, ONE        0.99\n\nSUBTOTAL         21.49\nTAX               1.72\nTOTAL            23.21\n\n11.07.2026  18:42\n\nKEEP FOR YOUR RECORDS',
      font: 'ui-monospace, Menlo, monospace',
      size: 36,
      align: 'center',
      padding: 0.12,
      lineHeight: 1.5,
    },
    behavior: { type: 'unroll', progress: 0.55, tightness: 0.55, sway: 0.3 },
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
