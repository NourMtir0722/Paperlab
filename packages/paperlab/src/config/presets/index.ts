import { paperConfigSchema, type PaperConfig, type PaperConfigInput } from '../schema'

/**
 * Built-in `.paper` presets. A preset is the serialized closure of one Paper —
 * the unit of saving, sharing, and code export. Stored as plain JSON-safe
 * objects, validated on access.
 */
const builtins: Record<string, PaperConfigInput> = {
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
