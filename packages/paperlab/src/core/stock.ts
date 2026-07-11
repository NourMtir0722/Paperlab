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
  /** Ink multiply tint for content drawn on this stock (thermal prints grey-black). */
  inkColor: string
  /** Thermal-printer banding intensity baked into the grain effect. */
  banding: number
  /** Surface effects this stock ships with; explicit surface config overrides per key. */
  defaultSurface: { grain?: number; aging?: number }
}

export const stocks: Record<StockName, Stock> = {
  printer: {
    id: 'printer',
    label: 'Printer',
    color: '#fbfaf7',
    roughness: 0.88,
    opacity: 1,
    inkColor: '#222222',
    banding: 0,
    defaultSurface: { grain: 0.12 },
  },
  thermal: {
    id: 'thermal',
    label: 'Thermal',
    color: '#f6f3e9',
    roughness: 0.62,
    opacity: 1,
    inkColor: '#3a3a3a',
    banding: 0.35,
    defaultSurface: { aging: 0.1 },
  },
  kraft: {
    id: 'kraft',
    label: 'Kraft',
    color: '#c9a06c',
    roughness: 0.96,
    opacity: 1,
    inkColor: '#33261a',
    banding: 0,
    defaultSurface: { grain: 0.5 },
  },
  newsprint: {
    id: 'newsprint',
    label: 'Newsprint',
    color: '#e9e4d6',
    roughness: 0.95,
    opacity: 1,
    inkColor: '#3d3a34',
    banding: 0,
    defaultSurface: { grain: 0.7, aging: 0.15 },
  },
  vellum: {
    id: 'vellum',
    label: 'Vellum',
    color: '#f4f2ec',
    roughness: 0.42,
    opacity: 0.62,
    inkColor: '#4a453d',
    banding: 0,
    defaultSurface: {},
  },
  'photo-gloss': {
    id: 'photo-gloss',
    label: 'Photo gloss',
    color: '#ffffff',
    roughness: 0.22,
    opacity: 1,
    inkColor: '#111111',
    banding: 0,
    defaultSurface: {},
  },
}

export function getStock(name: StockName): Stock {
  return stocks[name]
}
