import * as THREE from 'three'
import { useEffect, useState } from 'react'
import type { BackContentConfig, ContentConfig, DieCutConfig, SheetConfig } from '../config/schema'
import type { Stock } from '../core/stock'
import { paintReceipt } from './receipt'
import { paintCard } from './card'
import { paintWash } from './wash'
import { ensureFont, wrapLines } from './type'

/**
 * All content is composited onto a canvas and applied as a texture — content
 * deforms with the mesh because the mesh deforms, never a 2D trick.
 * Long edge = 1024 logical px × DPR 2 so text stays crisp when curled.
 */
const LONG_EDGE = 1024
const DPR = 2
/** How wide a die-cut margin is on the canvas the dilation is stamped on — see `paintDieCut`. */
const DILATE_PX = 20

export function contentCanvasSize(sheet: SheetConfig): [number, number] {
  const long = Math.max(sheet.width, sheet.height)
  const w = Math.round((sheet.width / long) * LONG_EDGE * DPR)
  const h = Math.round((sheet.height / long) * LONG_EDGE * DPR)
  return [w, h]
}

function paintBackground(ctx: CanvasRenderingContext2D, w: number, h: number, stock: Stock) {
  ctx.fillStyle = stock.color
  ctx.fillRect(0, 0, w, h)
}

function paintImage(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  img: HTMLImageElement,
  fit: 'cover' | 'contain',
) {
  const scale =
    fit === 'cover' ? Math.max(w / img.width, h / img.height) : Math.min(w / img.width, h / img.height)
  const dw = img.width * scale
  const dh = img.height * scale
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
}

function paintText(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  content: Extract<ContentConfig, { type: 'text' }>,
  stock: Stock,
) {
  const size = content.size * DPR
  const pad = content.padding * Math.min(w, h)
  const font = `${content.weight} ${size}px ${content.font}`
  ctx.font = font
  ctx.fillStyle = content.color === '#2b2620' ? stock.inkColor : content.color
  ctx.textBaseline = 'top'
  ctx.textAlign = content.align
  // Tracking is set before measuring, not after: `measureText` honours
  // `letterSpacing`, so wrapping against the untracked width would break
  // lines to a measure the painted line does not have.
  ctx.letterSpacing = `${content.tracking}em`

  const maxWidth = w - pad * 2
  const x = content.align === 'left' ? pad : content.align === 'right' ? w - pad : w / 2
  const lineStep = size * content.lineHeight

  const lines = wrapLines(ctx, content.text, maxWidth, font)
  // Re-assert: wrapLines restores the font it was handed, which drops the
  // spacing the measure was taken with.
  ctx.font = font
  ctx.letterSpacing = `${content.tracking}em`

  // `center` optically centres the whole block rather than hanging it from
  // the top edge — what a label or a poster wants, where `top` is what a
  // letter wants because a letter starts at the top of the page.
  const block = lines.length * lineStep
  let y = content.valign === 'center' ? Math.max(pad, (h - block) / 2) : pad

  for (const line of lines) {
    if (y > h - pad) break
    ctx.fillText(line, x, y)
    y += lineStep
  }
  ctx.letterSpacing = '0em'
}

/**
 * A die-cut sticker's face: the content on NO ground, then a margin of
 * backing grown out from its silhouette and laid under it.
 *
 * The margin is a dilation, drawn as the silhouette stamped round a few rings
 * of offsets — a canvas has no morphology operator, and a blur-and-threshold
 * would round the inside corners of lettering that a real die keeps sharp.
 *
 * The stamping is done SMALL, with the margin about `DILATE_PX` wide, and the
 * grown silhouette is scaled up under the art. The stamp count grows with the
 * square of the margin in pixels, and at full resolution a small sticker's
 * margin is a couple of hundred of them: the peeling-sticker preset spent
 * 143,000 full-canvas draws on its margins before it could show a frame. The
 * outline is only as sharp as the small canvas, which is well under a screen
 * pixel at any size a sticker is drawn.
 *
 * The transparent ground is not quite empty: it carries the margin colour at
 * the lowest alpha a canvas stores. A texel at alpha 0 has lost its colour
 * (canvas pixels are premultiplied), so filtering across the cut line would
 * mix in black and draw a dark hairline round every sticker. At 1/255 the
 * colour survives and the edge filters to the margin, as it should.
 */
function paintDieCut(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cut: DieCutConfig,
  sheet: SheetConfig,
  paintArt: (art: CanvasRenderingContext2D, x: number, y: number, aw: number, ah: number) => void,
) {
  const perUnit = Math.max(w, h) / Math.max(sheet.width, sheet.height)
  const margin = cut.margin * perUnit
  // Inset by the margin (and a pixel) so the backing is never clipped by the canvas.
  const inset = margin + 2
  const art = document.createElement('canvas')
  art.width = w
  art.height = h
  const actx = art.getContext('2d')!
  paintArt(actx, inset, inset, w - inset * 2, h - inset * 2)

  ctx.save()
  ctx.globalAlpha = 1 / 255
  ctx.fillStyle = cut.color
  ctx.fillRect(0, 0, w, h)
  ctx.restore()

  if (margin > 0.5) {
    const k = Math.min(1, DILATE_PX / margin)
    const sw = Math.max(1, Math.ceil(w * k))
    const sh = Math.max(1, Math.ceil(h * k))
    const small = margin * k
    const silhouette = document.createElement('canvas')
    silhouette.width = sw
    silhouette.height = sh
    const sctx = silhouette.getContext('2d')!
    sctx.drawImage(art, 0, 0, sw, sh)
    sctx.globalCompositeOperation = 'source-in'
    sctx.fillStyle = cut.color
    sctx.fillRect(0, 0, sw, sh)
    const grown = document.createElement('canvas')
    grown.width = sw
    grown.height = sh
    const gctx = grown.getContext('2d')!
    gctx.drawImage(silhouette, 0, 0)
    const rings = Math.max(2, Math.ceil(small / 3))
    for (let r = 1; r <= rings; r++) {
      const radius = (small * r) / rings
      const steps = Math.max(12, Math.ceil(radius * 1.2))
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2
        gctx.drawImage(silhouette, Math.cos(a) * radius, Math.sin(a) * radius)
      }
    }
    ctx.save()
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(grown, 0, 0, w, h)
    ctx.restore()
  }
  ctx.drawImage(art, 0, 0)
}

/**
 * Render content to a canvas. Synchronous — image content needs a decoded
 * HTMLImageElement passed in (the hook below handles loading).
 */
export function renderContentToCanvas(
  content: ContentConfig | BackContentConfig,
  sheet: SheetConfig,
  stock: Stock,
  image?: HTMLImageElement,
  dieCut?: DieCutConfig,
  /** Fraction of the usual resolution. Everything is painted at the usual size and scaled, so text keeps its measure. */
  scale = 1,
): HTMLCanvasElement {
  const [w, h] = contentCanvasSize(sheet)
  const pw = Math.max(1, Math.round(w * scale))
  const ph = Math.max(1, Math.round(h * scale))
  const canvas = document.createElement('canvas')
  canvas.width = pw
  canvas.height = ph
  const ctx = canvas.getContext('2d')!
  if (dieCut) {
    // No ground: the sticker is only what the content covers, plus its margin.
    paintDieCut(ctx, pw, ph, dieCut, sheet, (art, x, y, aw, ah) => {
      art.save()
      art.translate(x, y)
      art.scale(pw / w, ph / h)
      aw *= w / pw
      ah *= h / ph
      if (content.type === 'image' && image && content.src) paintImage(art, aw, ah, image, 'contain')
      if (content.type === 'text') paintText(art, aw, ah, content, stock)
      if (content.type === 'card') paintCard(art, aw, ah, content, stock, DPR)
      if (content.type === 'receipt') paintReceipt(art, aw, ah, content, stock)
      // Blank, or an image still loading: a plain sticker of stock.
      if (content.type === 'blank' || (content.type === 'image' && !(image && content.src))) {
        art.fillStyle = stock.color
        art.fillRect(0, 0, aw, ah)
      }
      art.restore()
    })
    return canvas
  }
  ctx.scale(pw / w, ph / h)
  paintBackground(ctx, w, h, stock)
  // Under everything the sheet carries, and over the stock. A wash is a
  // ground: the letter is written on it, not beside it.
  if (content.wash) paintWash(ctx, w, h, content.wash)
  if (content.type === 'image' && image && content.src) paintImage(ctx, w, h, image, content.fit)
  if (content.type === 'text') paintText(ctx, w, h, content, stock)
  if (content.type === 'receipt') paintReceipt(ctx, w, h, content, stock)
  if (content.type === 'card') paintCard(ctx, w, h, content, stock, DPR)
  return canvas
}

function makeTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  tex.generateMipmaps = true
  return tex
}

/**
 * React hook: content config → texture. Re-renders only on content change,
 * never per-frame. Waits for image decode / document.fonts.ready.
 */
export function useContentTexture(
  content: ContentConfig | BackContentConfig | undefined,
  sheet: SheetConfig,
  stock: Stock,
  /** Paint it as a die-cut sticker face — see `paintDieCut`. */
  dieCut?: DieCutConfig,
  /** Fraction of the usual resolution, for a sheet drawn much smaller than its canvas — see `renderContentToCanvas`. */
  scale = 1,
): THREE.CanvasTexture | null {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null)
  const key = JSON.stringify({
    content: content ?? null,
    w: sheet.width,
    h: sheet.height,
    stock: stock.id,
    cut: dieCut ?? null,
    scale,
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: key serializes the content, sheet and stock the canvas draws from.
  useEffect(() => {
    let disposed = false
    let tex: THREE.CanvasTexture | null = null

    if (!content) {
      setTexture(null)
      return
    }

    const commit = (canvas: HTMLCanvasElement) => {
      if (disposed) return
      tex = makeTexture(canvas)
      setTexture(tex)
    }

    if (content.type === 'image' && content.src) {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => commit(renderContentToCanvas(content, sheet, stock, img, dieCut, scale))
      // A URL that never loads must not leave the sheet textureless — it
      // still has stock, and bare stock is the honest picture of "no image".
      img.onerror = () => commit(renderContentToCanvas(content, sheet, stock, undefined, dieCut, scale))
      img.src = content.src
    } else if (content.type === 'text' || content.type === 'card') {
      // Ask for the face BY NAME. `document.fonts.ready` alone only waits for
      // what the document already requested, and a family named inside a
      // canvas font string was never requested by anything — so on a page
      // with no DOM element using it, `ready` resolves at once and the sheet
      // paints in the fallback.
      void ensureFont(content.font, content.size * DPR).then(() =>
        commit(renderContentToCanvas(content, sheet, stock, undefined, dieCut, scale)),
      )
    } else if (content.type === 'receipt') {
      document.fonts.ready.then(() =>
        commit(renderContentToCanvas(content, sheet, stock, undefined, dieCut, scale)),
      )
    } else {
      commit(renderContentToCanvas(content, sheet, stock, undefined, dieCut, scale))
    }

    return () => {
      disposed = true
      tex?.dispose()
    }
  }, [key])

  return texture
}
