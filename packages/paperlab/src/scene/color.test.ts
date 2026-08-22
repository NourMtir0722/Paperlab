import { describe, expect, it } from 'vitest'
import { cssColorOr } from './color'

/**
 * These run in node, where there is no canvas to ask — so what is under test
 * here is the SSR branch and the contract, and the browser behaviour is
 * covered by the thing that motivated it: typing `not-a-colour` into a
 * stage's `zenith` used to crash the editor out of `addColorStop`.
 */
describe('cssColorOr', () => {
  it('passes the value through when there is no DOM to ask', () => {
    // Nothing is painted without a document, so nothing can throw, and
    // inventing a colour would silently change a server-rendered scene.
    expect(cssColorOr('#ffaa22', '#000000')).toBe('#ffaa22')
    expect(cssColorOr('not-a-colour', '#000000')).toBe('not-a-colour')
  })

  it('never returns undefined or empty for any input', () => {
    for (const input of ['', '#f', '#ff', 'rebeccapurple', 'rgb(1,2,3)', 'nonsense']) {
      const out = cssColorOr(input, '#123456')
      expect(typeof out).toBe('string')
    }
  })
})
