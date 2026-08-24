/**
 * The receipt's line items, as editable text.
 *
 * `items` is an array of objects, and the inspector's schema walk does not
 * do arrays — but a receipt whose purchases cannot be changed is a receipt
 * PRESET, not a receipt you can edit, and that is most of why the Content
 * folder felt empty on the app's own default paper.
 *
 * One item per line. Name and price split on the LAST pipe, so a name may
 * contain one.
 *
 * It lives in its own module rather than beside the panel that draws it for
 * one reason: `parse` is the only part of this folder that can be WRONG
 * about something — a missing separator, a typed currency symbol, a price
 * that is not a number — and every one of those is a case worth stating in a
 * test rather than discovering on someone's receipt.
 */
export interface ReceiptItem {
  name: string
  price: number
}

/**
 * Round-trips through {@link parseItems} exactly: `format(parse(format(x)))
 * === format(x)`. That is what lets the textarea hold a draft without
 * fighting the value underneath it — the control adopts external edits by
 * comparing against the string it last committed, and a format that drifted
 * would look like an external edit on every keystroke.
 */
export function formatItems(items: readonly ReceiptItem[]): string {
  return items.map((item) => `${item.name} | ${item.price}`).join('\n')
}

export function parseItems(raw: string): ReceiptItem[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const split = line.lastIndexOf('|')
      // No separator is a name with no price yet, not a parse failure — it
      // is what a half-typed line looks like, and a half-typed line should
      // not blank the row you were adding it to.
      if (split === -1) return { name: line, price: 0 }
      // Currency symbols and stray spaces are what people actually type.
      const price = Number.parseFloat(line.slice(split + 1).replace(/[^\d.-]/g, ''))
      return { name: line.slice(0, split).trim(), price: Number.isFinite(price) ? price : 0 }
    })
}
