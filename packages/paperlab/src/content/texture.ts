import * as THREE from 'three'
import { useEffect, useState } from 'react'
import type { BackContentConfig, ContentConfig, SheetConfig } from '../config/schema'
import type { Stock } from '../core/stock'
import { paintReceipt } from './receipt'
import { paintCard } from './card'
import { ensureFont, wrapLines } from './type'

/**
 * All content is composited onto a canvas and applied as a texture — content
 * deforms with the mesh because the mesh deforms, never a 2D trick.
 * Long edge = 1024 logical px × DPR 2 so text stays crisp when curled.
 */
const LONG_EDGE = 1024
const DPR = 2

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
 * Render content to a canvas. Synchronous — image content needs a decoded
 * HTMLImageElement passed in (the hook below handles loading).
 */
export function renderContentToCanvas(
  content: ContentConfig | BackContentConfig,
  sheet: SheetConfig,
  stock: Stock,
  image?: HTMLImageElement,
): HTMLCanvasElement {
  const [w, h] = contentCanvasSize(sheet)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  paintBackground(ctx, w, h, stock)
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
): THREE.CanvasTexture | null {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null)
  const key = JSON.stringify({ content: content ?? null, w: sheet.width, h: sheet.height, stock: stock.id })

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
      img.onload = () => commit(renderContentToCanvas(content, sheet, stock, img))
      // A URL that never loads must not leave the sheet textureless — it
      // still has stock, and bare stock is the honest picture of "no image".
      img.onerror = () => commit(renderContentToCanvas(content, sheet, stock))
      img.src = content.src
    } else if (content.type === 'text' || content.type === 'card') {
      // Ask for the face BY NAME. `document.fonts.ready` alone only waits for
      // what the document already requested, and a family named inside a
      // canvas font string was never requested by anything — so on a page
      // with no DOM element using it, `ready` resolves at once and the sheet
      // paints in the fallback.
      void ensureFont(content.font, content.size * DPR).then(() =>
        commit(renderContentToCanvas(content, sheet, stock)),
      )
    } else if (content.type === 'receipt') {
      document.fonts.ready.then(() => commit(renderContentToCanvas(content, sheet, stock)))
    } else {
      commit(renderContentToCanvas(content, sheet, stock))
    }

    return () => {
      disposed = true
      tex?.dispose()
    }
  }, [key])

  return texture
}
