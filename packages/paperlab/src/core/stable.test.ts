import { describe, expect, it } from 'vitest'
import { deepEqual } from './stable'

/**
 * `deepEqual` replaced a `JSON.stringify` comparison in the field's memo
 * deps, so the bar is not "is it a reasonable deep-equal" — it is **does it
 * draw the same line stringify drew**. Anything it calls equal that
 * stringify called different would stop the field rebuilding when it should;
 * anything the other way rebuilds it constantly, which is the cost this was
 * meant to remove.
 */
describe('deepEqual', () => {
  it('agrees with JSON.stringify across config-shaped values', () => {
    const cases: [unknown, unknown][] = [
      [{ a: 1 }, { a: 1 }],
      [{ a: 1 }, { a: 2 }],
      [
        { a: 1, b: 2 },
        { b: 2, a: 1 },
      ],
      [{ a: [1, 2, 3] }, { a: [1, 2, 3] }],
      [{ a: [1, 2, 3] }, { a: [1, 2] }],
      [{ a: [1, 2] }, { a: [2, 1] }],
      [{ a: { b: { c: 'x' } } }, { a: { b: { c: 'x' } } }],
      [{ a: { b: { c: 'x' } } }, { a: { b: { c: 'y' } } }],
      [null, null],
      [null, {}],
      ['x', 'x'],
      ['x', 'y'],
      [1, '1'],
      [true, false],
      [[], {}],
      [{ src: 'data:image/png;base64,AAAA' }, { src: 'data:image/png;base64,AAAA' }],
      [{ src: 'data:image/png;base64,AAAA' }, { src: 'data:image/png;base64,AAAB' }],
    ]
    for (const [a, b] of cases) {
      // Key order is the one place they legitimately differ: stringify is
      // order-sensitive and a structural compare is not. Sort both sides so
      // the oracle answers the question actually being asked.
      const oracle = JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b))
      expect(deepEqual(a, b), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toBe(oracle)
    }
  })

  it('ignores key order, which a serialized dep could not', () => {
    expect(deepEqual({ width: 1, height: 2 }, { height: 2, width: 1 })).toBe(true)
  })

  it('treats an explicit undefined as an absent key, the way stringify did', () => {
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true)
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true)
    expect(deepEqual({ a: 1, b: undefined }, { a: 1, b: null })).toBe(false)
  })

  it('compares a fresh wrapper around shared inner objects without walking them', () => {
    // The hot case: the editor rebuilds the slot array every render while the
    // configs inside it are the very same objects.
    const config = { content: { type: 'image', src: 'data:image/png;base64,AAAA' } }
    expect(deepEqual([{ preset: config }], [{ preset: config }])).toBe(true)
  })

  it('separates arrays from objects with the same indices', () => {
    expect(deepEqual([1, 2], { 0: 1, 1: 2 })).toBe(false)
  })

  it('handles nested arrays of objects, which is what a slot list is', () => {
    const a = [{ preset: 'card', states: { states: { hover: { overrides: { x: 1 } } } } }]
    const b = [{ preset: 'card', states: { states: { hover: { overrides: { x: 1 } } } } }]
    const c = [{ preset: 'card', states: { states: { hover: { overrides: { x: 2 } } } } }]
    expect(deepEqual(a, b)).toBe(true)
    expect(deepEqual(a, c)).toBe(false)
  })
})

/** Recursively sort object keys, so stringify can act as an order-blind oracle. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = sortKeys((value as Record<string, unknown>)[key])
  }
  return out
}
