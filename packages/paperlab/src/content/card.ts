import type { ContentConfig } from '../config/schema'
import type { Stock } from '../core/stock'
import { wrapLines } from './type'

export type CardContent = Extract<ContentConfig, { type: 'card' }>

/**
 * The card: a tracked label, a rule, a body, and a line of small print.
 *
 * Held to the receipt's standard rather than the text block's, which is the
 * whole reason it exists. The receipt is the only content type in this
 * library anybody art-directed — it knows what a dashed rule is, what a
 * barcode looks like, and that a total belongs at the bottom — and
 * everything else went through one `fillText` loop in the system serif.
 *
 * The proportions below are the composition, and they are ratios of the body
 * size rather than numbers, so a card scales as a card instead of as a
 * paragraph that grew.
 */

/** Title sits well under the body: it is a label, not a heading. */
const TITLE_RATIO = 0.52
/** Small print smaller still, and the two are deliberately different sizes. */
const NOTE_RATIO = 0.46
/** Tracking for the title. Uppercase at small sizes closes up without it. */
const TITLE_TRACKING = 0.16
const NOTE_TRACKING = 0.06

export function paintCard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  content: CardContent,
  stock: Stock,
  dpr: number,
): void {
  const ink = content.color === '#2b2620' ? stock.inkColor : content.color
  const size = content.size * dpr
  const pad = content.padding * Math.min(w, h)
  const maxWidth = w - pad * 2
  const x = content.align === 'center' ? w / 2 : pad
  ctx.textAlign = content.align === 'center' ? 'center' : 'left'
  ctx.textBaseline = 'alphabetic'

  const titleSize = size * TITLE_RATIO
  const noteSize = size * NOTE_RATIO
  const bodyStep = size * 1.35

  // Measure the whole composition before drawing any of it, so the block can
  // be centred in the card. A card whose type is hung from the top edge
  // reads as a page that got cut off rather than as a card.
  const bodyLines = content.body ? wrapLines(ctx, content.body, maxWidth, `${size}px ${content.font}`) : []
  const titleBlock = content.title ? titleSize * 1.9 : 0
  const ruleBlock = content.rule && content.title ? titleSize * 0.9 : 0
  const noteBlock = content.note ? noteSize * 2.4 : 0
  const bodyBlock = bodyLines.length * bodyStep
  const total = titleBlock + ruleBlock + bodyBlock + noteBlock

  let y = Math.max(pad, (h - total) / 2) + size * 0.9

  if (content.title) {
    ctx.font = `${titleSize}px ${content.font}`
    ctx.letterSpacing = `${TITLE_TRACKING}em`
    ctx.fillStyle = ink
    ctx.globalAlpha = 0.72
    ctx.fillText(content.title.toUpperCase(), x, y - size * 0.5)
    ctx.globalAlpha = 1
    ctx.letterSpacing = '0em'
    y += titleBlock - size * 0.5

    if (content.rule) {
      // A hairline, not a border: it separates, it does not enclose.
      ctx.save()
      ctx.strokeStyle = ink
      ctx.globalAlpha = 0.28
      ctx.lineWidth = Math.max(1, dpr * 0.75)
      ctx.beginPath()
      ctx.moveTo(content.align === 'center' ? w / 2 - maxWidth / 2 : pad, y - titleSize * 0.5)
      ctx.lineTo(content.align === 'center' ? w / 2 + maxWidth / 2 : pad + maxWidth, y - titleSize * 0.5)
      ctx.stroke()
      ctx.restore()
      y += ruleBlock
    }
  }

  if (content.ruled && bodyLines.length > 0) {
    // Writing lines, drawn UNDER the type and in the stock's own ink at low
    // alpha, so they read as printed on the card rather than as underlines
    // on the words.
    ctx.save()
    ctx.strokeStyle = ink
    ctx.globalAlpha = 0.14
    ctx.lineWidth = Math.max(1, dpr * 0.6)
    for (let i = 0; i < bodyLines.length; i++) {
      const lineY = y + i * bodyStep + size * 0.28
      ctx.beginPath()
      ctx.moveTo(pad, lineY)
      ctx.lineTo(pad + maxWidth, lineY)
      ctx.stroke()
    }
    ctx.restore()
  }

  ctx.font = `${size}px ${content.font}`
  ctx.fillStyle = ink
  for (const line of bodyLines) {
    if (y > h - pad) break
    ctx.fillText(line, x, y)
    y += bodyStep
  }

  if (content.note) {
    ctx.font = `${noteSize}px ${content.font}`
    ctx.letterSpacing = `${NOTE_TRACKING}em`
    ctx.globalAlpha = 0.6
    ctx.fillText(content.note, x, Math.min(y + noteSize * 1.4, h - pad))
    ctx.globalAlpha = 1
    ctx.letterSpacing = '0em'
  }
}
