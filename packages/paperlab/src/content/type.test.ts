import { describe, expect, it } from 'vitest'
import { wrapLines } from './type'
import { contentSchema } from '../config/schema'

/**
 * A stand-in for a canvas context that measures one unit per character.
 *
 * The real one needs a DOM; the thing under test is the BREAKING policy, and
 * that is pure arithmetic over a measure function. Monospace measurement
 * makes every expectation below readable as a count of characters.
 */
function fakeCtx(): CanvasRenderingContext2D {
  return {
    font: '',
    measureText: (s: string) => ({ width: s.length }) as TextMetrics,
  } as unknown as CanvasRenderingContext2D
}

describe('wrapLines', () => {
  it('wraps to the measure and keeps whole words together', () => {
    expect(wrapLines(fakeCtx(), 'aaa bbb ccc ddd', 7, '10px x')).toEqual(['aaa bbb', 'ccc ddd'])
  })

  it('keeps an explicit newline as a break', () => {
    expect(wrapLines(fakeCtx(), 'one\ntwo', 40, '10px x')).toEqual(['one', 'two'])
  })

  it('keeps a blank line, because a paragraph break is content', () => {
    expect(wrapLines(fakeCtx(), 'one\n\ntwo', 40, '10px x')).toEqual(['one', '', 'two'])
  })

  it('BREAKS a word that cannot fit, instead of hanging it off the sheet', () => {
    // The bug this replaces: the old loop appended a word whenever the line
    // was empty, on the theory that one word always fits. A long URL on a
    // narrow banner does not, and it ran off the edge with nothing to stop
    // it. A sheet is a physical object — type that leaves it has left it.
    const lines = wrapLines(fakeCtx(), 'aaaaaaaaaaaa', 5, '10px x')
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(5)
    expect(lines.join('')).toBe('aaaaaaaaaaaa')
  })

  it('breaks an over-long word that follows normal ones, losing nothing', () => {
    const lines = wrapLines(fakeCtx(), 'hi aaaaaaaaaa', 4, '10px x')
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(4)
    expect(lines.join('').replace(/\s/g, '')).toBe('hiaaaaaaaaaa')
  })

  it('restores the font it was handed', () => {
    const ctx = fakeCtx()
    ctx.font = 'original'
    wrapLines(ctx, 'a b c', 3, '10px x')
    expect(ctx.font).toBe('original')
  })

  it('survives the empty cases', () => {
    expect(wrapLines(fakeCtx(), '', 10, '10px x')).toEqual([''])
    expect(wrapLines(fakeCtx(), '   ', 10, '10px x')).toEqual([''])
  })
})

describe('the card content type', () => {
  it('parses from nothing and carries a whole composition', () => {
    const card = contentSchema.parse({ type: 'card' })
    expect(card).toMatchObject({ type: 'card', rule: true, ruled: false, align: 'left' })
  })

  it('sets its body larger than a text block, because a card is read close up', () => {
    const card = contentSchema.parse({ type: 'card' })
    const text = contentSchema.parse({ type: 'text' })
    expect(card.type === 'card' && text.type === 'text' && card.size).toBeGreaterThan(
      text.type === 'text' ? text.size : 0,
    )
  })

  it('round-trips through JSON like every other content type', () => {
    const card = contentSchema.parse({
      type: 'card',
      title: 'Return by',
      body: '12 MAR',
      note: 'Fines accrue daily',
      ruled: true,
    })
    expect(contentSchema.parse(JSON.parse(JSON.stringify(card)))).toEqual(card)
  })

  it('is available on the reverse of a sheet too', () => {
    const parsed = contentSchema.parse({ type: 'text', back: { type: 'card', title: 'Verso' } })
    expect(parsed.back).toMatchObject({ type: 'card', title: 'Verso' })
  })
})

describe('typesetting controls', () => {
  it('tracking and valign default to the old behaviour', () => {
    const text = contentSchema.parse({ type: 'text' })
    expect(text).toMatchObject({ tracking: 0, valign: 'top' })
  })

  it('both serialize, so a look survives a share link', () => {
    const text = contentSchema.parse({ type: 'text', tracking: 0.12, valign: 'center' })
    expect(contentSchema.parse(JSON.parse(JSON.stringify(text)))).toEqual(text)
  })

  it('an image preset may ship with no picture at all', () => {
    // What lets a built-in image preset exist without the library shipping —
    // or fetching — a photograph.
    expect(contentSchema.parse({ type: 'image' })).toMatchObject({ type: 'image', src: '' })
  })
})
