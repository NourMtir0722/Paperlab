import type { ContentConfig } from '../config/schema'
import type { Stock } from '../core/stock'

export type ReceiptContent = Extract<ContentConfig, { type: 'receipt' }>

export interface ReceiptTotals {
  subtotal: number
  tax: number
  total: number
}

export function receiptTotals(content: ReceiptContent): ReceiptTotals {
  const subtotal = content.items.reduce((sum, item) => sum + item.price, 0)
  const tax = subtotal * content.taxRate
  return { subtotal, tax, total: subtotal + tax }
}

/** Deterministic bar widths from a string — stylized Code-128 look. */
export function barcodeBars(seed: string): number[] {
  // Not a scannable Code 128 (real encoding tracked for later) — but the
  // start/stop guard structure and 1–4 module widths match the real thing.
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const bars: number[] = [2, 1, 1, 4] // start guard
  for (let i = 0; i < 30; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822519)
    bars.push(1 + (Math.abs(h) % 4))
  }
  bars.push(2, 3, 3, 1, 1, 2) // stop guard
  return bars
}

const money = (v: number) => v.toFixed(2)

/**
 * The procedural receipt: store header, line items, totals, barcode,
 * timestamp, footer. Pairs with `deckle: { edges: ['bottom'] }` for the
 * jagged thermal tear. One-liner meme potential by design.
 */
export function paintReceipt(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  content: ReceiptContent,
  stock: Stock,
): void {
  const ink = stock.inkColor
  const pad = w * 0.09
  const colWidth = w - pad * 2
  const base = Math.round(w / 15) // font size scales with receipt width
  const mono = (size: number, weight = 400) => `${weight} ${size}px ui-monospace, Menlo, Consolas, monospace`

  let y = h * 0.045
  const line = (step = 1.6) => (y += base * step)

  const center = (text: string, size = base, weight = 400) => {
    ctx.font = mono(size, weight)
    ctx.textAlign = 'center'
    ctx.fillText(text, w / 2, y)
  }
  const row = (left: string, right: string, size = base) => {
    ctx.font = mono(size)
    ctx.textAlign = 'left'
    ctx.fillText(left, pad, y)
    ctx.textAlign = 'right'
    ctx.fillText(right, w - pad, y)
  }
  const divider = () => {
    ctx.font = mono(base)
    ctx.textAlign = 'center'
    ctx.fillText('- '.repeat(Math.floor(colWidth / (base * 1.1))).trim(), w / 2, y)
  }

  ctx.fillStyle = ink
  ctx.textBaseline = 'top'

  center(content.store.toUpperCase(), base * 1.5, 700)
  line(2.4)
  center(content.address.toUpperCase())
  line(1.8)
  divider()
  line(1.8)

  for (const item of content.items) {
    row(item.name.toUpperCase(), money(item.price))
    line()
  }
  line(0.4)
  divider()
  line(1.8)

  const totals = receiptTotals(content)
  row('SUBTOTAL', money(totals.subtotal))
  line()
  row(`TAX ${(content.taxRate * 100).toFixed(0)}%`, money(totals.tax))
  line()
  row('TOTAL', money(totals.total), base * 1.15)
  line(2)

  center(content.timestamp ?? new Date().toLocaleString('en-GB'), base * 0.9)
  line(2.2)

  if (content.barcode) {
    const bars = barcodeBars(content.store)
    const modules = bars.reduce((a, b) => a + b, 0)
    const module = (colWidth * 0.85) / modules
    const barH = base * 3.2
    let x = (w - modules * module) / 2
    bars.forEach((width, i) => {
      if (i % 2 === 0) ctx.fillRect(x, y, width * module, barH)
      x += width * module
    })
    y += barH
    line(1.8)
  }

  center(content.footer.toUpperCase(), base * 0.9)
}
