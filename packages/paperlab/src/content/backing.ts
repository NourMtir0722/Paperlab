import { sheetBackingSize, sheetSlotXY, type SheetLayoutOptions } from '../field/sheetGrid'

/**
 * The backing sheet's generated content: per-slot ghost silhouettes a few
 * percent lighter than the backing tint. When a slot's paper detaches
 * (picked/placed), its silhouette lightens further and gains a faint
 * adhesive-sheen gradient — the visual proof of removal. Redrawn on state
 * change, never per-frame.
 */

export interface SilhouetteRect {
  /** Canvas-UV rect (0..1, y down) of slot i on the backing sheet. */
  x: number
  y: number
  w: number
  h: number
}

/** Pure: where each slot's silhouette sits on the backing, in canvas UV. */
export function silhouetteRects(o: SheetLayoutOptions, count: number): SilhouetteRect[] {
  const { width, height } = sheetBackingSize(o)
  const rects: SilhouetteRect[] = []
  for (let i = 0; i < count; i++) {
    const { x, y } = sheetSlotXY(i, o)
    rects.push({
      x: (x - o.cellWidth / 2 + width / 2) / width,
      // World y up → canvas y down.
      y: (height / 2 - y - o.cellHeight / 2) / height,
      w: o.cellWidth / width,
      h: o.cellHeight / height,
    })
  }
  return rects
}

/** Lighten a hex tint toward white by `amount` (0..1). */
export function lightenHex(hex: string, amount: number): string {
  const n = parseInt(hex.replace('#', ''), 16)
  const ch = (shift: number) => {
    const c = (n >> shift) & 0xff
    return Math.min(255, Math.round(c + (255 - c) * amount))
  }
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`
}

export interface BackingDrawSpec {
  options: SheetLayoutOptions
  count: number
  tint: string
  /** Slot indices whose paper has been picked/placed away. */
  removed: ReadonlySet<number>
}

/** Draw the backing content onto a canvas (called on state change only). */
export function drawBacking(canvas: HTMLCanvasElement, spec: BackingDrawSpec): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { width: cw, height: chh } = canvas
  ctx.fillStyle = spec.tint
  ctx.fillRect(0, 0, cw, chh)

  const rects = silhouetteRects(spec.options, spec.count)
  rects.forEach((r, i) => {
    const removed = spec.removed.has(i)
    const x = r.x * cw
    const y = r.y * chh
    const w = r.w * cw
    const h = r.h * chh
    const radius = Math.min(w, h) * 0.06

    ctx.fillStyle = lightenHex(spec.tint, removed ? 0.5 : 0.07)
    roundedRect(ctx, x, y, w, h, radius)
    ctx.fill()

    if (removed) {
      // Faint adhesive sheen: a diagonal highlight across the bare silhouette.
      const sheen = ctx.createLinearGradient(x, y, x + w, y + h)
      sheen.addColorStop(0, 'rgba(255,255,255,0)')
      sheen.addColorStop(0.5, 'rgba(255,255,255,0.35)')
      sheen.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = sheen
      roundedRect(ctx, x, y, w, h, radius)
      ctx.fill()
    }
  })
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
