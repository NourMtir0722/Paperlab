/**
 * Procedural demo fill for the Field Composer's image slots.
 *
 * These replace the old hardcoded Unsplash URLs: they render offline, never
 * rate-limit, and — since they're generated locally — there's nothing to leak
 * if the fill ever escaped into an export. (It doesn't: this pool is
 * PREVIEW-only; see App.tsx `fieldExportInput`.)
 *
 * Each tile is a soft two-tone gradient in paper's 4:5 portrait aspect, spun
 * once at module load so slots stay stable across re-renders.
 */

const TILE_W = 512
const TILE_H = 640
const COUNT = 8

/** Evenly-spaced hues so a full ring of slots reads as distinct cards. */
function tile(index: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = TILE_W
  canvas.height = TILE_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  const hue = (index / COUNT) * 360
  const g = ctx.createLinearGradient(0, 0, TILE_W, TILE_H)
  g.addColorStop(0, `hsl(${hue} 55% 62%)`)
  g.addColorStop(1, `hsl(${(hue + 40) % 360} 50% 38%)`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, TILE_W, TILE_H)

  // A faint offset disc keeps each tile from reading as a flat swatch.
  ctx.globalAlpha = 0.12
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(TILE_W * 0.68, TILE_H * 0.32, TILE_W * 0.42, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1

  return canvas.toDataURL('image/jpeg', 0.82)
}

/**
 * Data-URI placeholders, generated once. Falls back to an empty pool when no
 * DOM canvas is available (SSR / tests) — callers already guard for that.
 */
export const DEMO_IMAGES: string[] =
  typeof document === 'undefined' ? [] : Array.from({ length: COUNT }, (_, i) => tile(i))
