/**
 * Procedural fill for the layout examples.
 *
 * A layout only reads as a layout when the sheets differ from each other —
 * twelve copies of one image is a carousel, not a gallery. These are
 * generated locally rather than fetched, so the page has no network
 * dependency and nothing to rate-limit. Same trick the editor's field
 * composer uses for its slots.
 */

const W = 512
const H = 640

function tile(index: number, count: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  const hue = (index / count) * 360
  const g = ctx.createLinearGradient(0, 0, W, H)
  g.addColorStop(0, `hsl(${hue} 52% 64%)`)
  g.addColorStop(1, `hsl(${(hue + 44) % 360} 48% 36%)`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)

  ctx.globalAlpha = 0.12
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(W * 0.68, H * 0.32, W * 0.42, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1

  return canvas.toDataURL('image/jpeg', 0.82)
}

export function demoTiles(count: number): string[] {
  if (typeof document === 'undefined') return []
  return Array.from({ length: count }, (_, i) => tile(i, count))
}
