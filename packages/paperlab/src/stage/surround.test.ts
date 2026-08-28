import { describe, expect, it, vi } from 'vitest'
import { makeGlowTexture } from './Surround'

/**
 * A stand-in for the 2D context, recording only what the glow is built from.
 * The library runs its tests in node, and the one thing worth asserting here
 * is what gets written into the gradient — no pixels have to exist for that.
 */
function recordingCanvas() {
  const stops: [number, string][] = []
  const ctx = {
    fillStyle: '' as unknown,
    createRadialGradient: () => ({
      addColorStop: (offset: number, color: string) => {
        stops.push([offset, color])
      },
    }),
    fillRect: () => {},
  }
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  })
  return stops
}

describe('makeGlowTexture', () => {
  /**
   * The regression this file exists for.
   *
   * A fade written into the alpha channel is the obvious way to build this
   * and it is the one that breaks: a 2D canvas holds premultiplied pixels,
   * so an un-premultiplied upload divides the colour back out, and where
   * alpha is near zero that division turns 8-bit rounding into visible
   * off-hue texels — green speckle across the far wall, in WebKit only.
   * Premultiplying it here is the fix, and "every stop is opaque" is the
   * shape of the fix that a test can hold on to.
   */
  it('fades by colour, never by alpha', () => {
    const stops = recordingCanvas()
    makeGlowTexture('#fff4e2')
    expect(stops.length).toBeGreaterThan(2)
    for (const [, color] of stops) expect(color).toMatch(/^rgb\(\d+, \d+, \d+\)$/)
  })

  it('still falls from the source colour to nothing', () => {
    const stops = recordingCanvas()
    makeGlowTexture('#ffffff')
    const levels = stops.map(([, color]) => Number(color.match(/\d+/)?.[0]))
    expect(levels.at(0)).toBe(255)
    expect(levels.at(-1)).toBe(0)
    // Monotonic, or the "long tail" the comment describes is not a tail.
    expect(levels).toEqual([...levels].sort((a, b) => (b ?? 0) - (a ?? 0)))
  })
})
