import type { StockName } from '../config/schema'

/**
 * A stock is a named bundle of material + geometry defaults — choosing paper
 * at a print shop. Individual controls always override; schema-wise these are
 * just defaults.
 */
export interface Stock {
  id: StockName
  label: string
  /** Base tint, also used as the canvas background behind content. */
  color: string
  roughness: number
  /** 0 = opaque. Vellum is translucent. */
  opacity: number
  /**
   * How much light passes THROUGH the sheet when something is behind it,
   * 0..1. Distinct from `opacity`: newsprint is fully opaque to look at and
   * still glows on a lightbox. This is what makes a backlit banner read.
   */
  translucency: number
  /** Ink multiply tint for content drawn on this stock (thermal prints grey-black). */
  inkColor: string
  /** Thermal-printer banding intensity baked into the grain effect. */
  banding: number
  /** Surface effects this stock ships with; explicit surface config overrides per key. */
  defaultSurface: { grain?: number; aging?: number }
  /** Reversed front-content ghost on the backside (thin stocks let ink show). */
  showThrough: number
  /** Glossy near-white glue underside (stickers) — forces showThrough 0. */
  adhesive: boolean
  /**
   * How hard this paper holds a crease, 0..1 — the material half of
   * {@link MemoryConfig}. Fibrous, thick stocks take a set and keep it;
   * coated and translucent ones spring most of the way back.
   *
   * Not a fraction of anything on its own: `memory.ts` scales it by
   * `MAX_SET`, so 1 here means "as much as paper ever remembers", not "stays
   * exactly as folded".
   */
  takesSet: number
}

export const stocks: Record<StockName, Stock> = {
  printer: {
    id: 'printer',
    label: 'Printer',
    color: '#fbfaf7',
    roughness: 0.88,
    opacity: 1,
    translucency: 0.2,
    inkColor: '#222222',
    banding: 0,
    defaultSurface: { grain: 0.12 },
    showThrough: 0,
    adhesive: false,
    // Office bond creases cleanly and holds it — the reference paper.
    takesSet: 0.6,
  },
  thermal: {
    id: 'thermal',
    label: 'Thermal',
    color: '#f6f3e9',
    roughness: 0.62,
    opacity: 1,
    translucency: 0.34,
    inkColor: '#3a3a3a',
    banding: 0.35,
    defaultSurface: { aging: 0.1 },
    showThrough: 0.06,
    adhesive: false,
    // Thin and already curled off a roll; a fold in it stays folded.
    takesSet: 0.65,
  },
  kraft: {
    id: 'kraft',
    label: 'Kraft',
    color: '#c9a06c',
    roughness: 0.96,
    opacity: 1,
    translucency: 0.08,
    inkColor: '#33261a',
    banding: 0,
    defaultSurface: { grain: 0.5 },
    showThrough: 0,
    adhesive: false,
    // Thick and fibrous. The crease is a break, and it never comes back.
    takesSet: 0.85,
  },
  newsprint: {
    id: 'newsprint',
    label: 'Newsprint',
    color: '#e9e4d6',
    roughness: 0.95,
    opacity: 1,
    translucency: 0.38,
    inkColor: '#3d3a34',
    banding: 0,
    defaultSurface: { grain: 0.7, aging: 0.15 },
    showThrough: 0.06,
    adhesive: false,
    // Soft, short-fibred, and barely sprung — it crumples rather than resists.
    takesSet: 0.8,
  },
  vellum: {
    id: 'vellum',
    label: 'Vellum',
    color: '#f4f2ec',
    roughness: 0.42,
    opacity: 0.62,
    translucency: 0.86,
    inkColor: '#4a453d',
    banding: 0,
    defaultSurface: {},
    showThrough: 0.55,
    adhesive: false,
    // Translucent and plasticky: it fights the fold and mostly wins.
    takesSet: 0.25,
  },
  'photo-gloss': {
    id: 'photo-gloss',
    label: 'Photo gloss',
    color: '#ffffff',
    roughness: 0.22,
    opacity: 1,
    translucency: 0.03,
    inkColor: '#111111',
    banding: 0,
    defaultSurface: {},
    showThrough: 0,
    adhesive: false,
    // The coating resists, then cracks white — little angle kept, lots of mark.
    takesSet: 0.3,
  },
  // Photo-gloss-like face, glossy near-white glue underside. The default
  // carrier for perforated stamp sheets.
  sticker: {
    id: 'sticker',
    label: 'Sticker',
    color: '#ffffff',
    roughness: 0.3,
    opacity: 1,
    translucency: 0.06,
    inkColor: '#1a1a1a',
    banding: 0,
    defaultSurface: {},
    showThrough: 0,
    adhesive: true,
    // A face sheet on a release liner; the liner does most of the remembering.
    takesSet: 0.5,
  },
}

export function getStock(name: StockName): Stock {
  return stocks[name]
}
