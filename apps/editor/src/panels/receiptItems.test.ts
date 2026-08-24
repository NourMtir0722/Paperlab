import { describe, expect, it } from 'vitest'
import { formatItems, parseItems } from './receiptItems'

describe('receipt items', () => {
  it('round-trips the shipped default', () => {
    const items = [
      { name: 'CURL, TRUE', price: 12 },
      { name: 'ROLL, TIGHT', price: 8.5 },
      { name: 'SHEET, ONE', price: 0.99 },
    ]
    expect(parseItems(formatItems(items))).toEqual(items)
  })

  it('formats one item per line', () => {
    expect(
      formatItems([
        { name: 'A', price: 1 },
        { name: 'B', price: 2 },
      ]),
    ).toBe('A | 1\nB | 2')
  })

  it('is stable under a second round trip', () => {
    // The control compares the drawn value against the string it last
    // committed; a format that drifted would read as an external edit and
    // clobber the draft on every keystroke.
    const once = formatItems(parseItems('CURL, TRUE | 12'))
    expect(formatItems(parseItems(once))).toBe(once)
  })

  it('splits on the last pipe, so a name may contain one', () => {
    expect(parseItems('A | B | 3')).toEqual([{ name: 'A | B', price: 3 }])
  })

  it('reads a half-typed line as a name with no price yet', () => {
    expect(parseItems('CURL, TRUE')).toEqual([{ name: 'CURL, TRUE', price: 0 }])
  })

  it('tolerates the currency symbols and spaces people actually type', () => {
    expect(parseItems('THING |  $12.50 ')).toEqual([{ name: 'THING', price: 12.5 }])
  })

  it('falls back to zero rather than NaN on an unparseable price', () => {
    // NaN would fail the schema parse and take the render down with it.
    expect(parseItems('THING | free')).toEqual([{ name: 'THING', price: 0 }])
  })

  it('drops blank and whitespace-only lines', () => {
    expect(parseItems('A | 1\n\n   \nB | 2')).toEqual([
      { name: 'A', price: 1 },
      { name: 'B', price: 2 },
    ])
  })

  it('an empty textarea is an empty receipt, not one blank item', () => {
    expect(parseItems('')).toEqual([])
  })
})
