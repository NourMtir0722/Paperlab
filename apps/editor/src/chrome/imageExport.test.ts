import { describe, expect, it } from 'vitest'
import { EXPORT_FRAMES, fitFov, imageFilename } from './imageExport'

/** The horizontal half-extent a camera sees at unit distance. */
const horizontal = (fov: number, aspect: number) => Math.tan((fov * Math.PI) / 360) * aspect

describe('fitFov', () => {
  it('leaves a matching aspect alone', () => {
    expect(fitFov(40, 16 / 9, 16 / 9)).toBeCloseTo(40)
  })

  it('leaves a wider target alone — it already shows everything', () => {
    expect(fitFov(40, 1, 16 / 9)).toBe(40)
  })

  it('opens the field for a narrower target', () => {
    expect(fitFov(40, 16 / 9, 9 / 16)).toBeGreaterThan(40)
  })

  it('keeps the horizontal extent exactly, which is the point', () => {
    // Nothing that was on screen to the left or right may leave the frame.
    const from = 16 / 9
    const to = 9 / 16
    expect(horizontal(fitFov(40, from, to), to)).toBeCloseTo(horizontal(40, from), 6)
  })

  it('never crops horizontally for any frame the menu offers', () => {
    const viewport = 1400 / 900
    for (const frame of EXPORT_FRAMES) {
      const to = frame.width / frame.height
      const fitted = horizontal(fitFov(40, viewport, to), to)
      expect(fitted).toBeGreaterThanOrEqual(horizontal(40, viewport) - 1e-9)
    }
  })

  it('returns the fov untouched on degenerate input rather than NaN', () => {
    // A zero-height viewport happens for a frame or two while a panel mounts,
    // and a NaN fov silently blanks the canvas instead of throwing.
    expect(fitFov(40, 0, 1)).toBe(40)
    expect(fitFov(40, 1, 0)).toBe(40)
    expect(fitFov(0, 1, 2)).toBe(0)
  })
})

describe('imageFilename', () => {
  it('slugs a preset name the way the .paper download does', () => {
    expect(imageFilename('Receipt unroll', 'story')).toBe('receipt-unroll-story.png')
  })

  it('falls back rather than producing a dotfile', () => {
    expect(imageFilename('   ', 'square')).toBe('paper-square.png')
    expect(imageFilename('!!!', 'square')).toBe('paper-square.png')
  })

  it('does not leave leading or trailing dashes from stripped punctuation', () => {
    expect(imageFilename('"quoted"', 'wide')).toBe('quoted-wide.png')
  })
})

describe('the frames on offer', () => {
  it('has a unique id per frame, since the id names the file', () => {
    expect(new Set(EXPORT_FRAMES.map((f) => f.id)).size).toBe(EXPORT_FRAMES.length)
  })

  it('is sized for the places people post', () => {
    for (const frame of EXPORT_FRAMES) {
      expect(Math.max(frame.width, frame.height)).toBeLessThanOrEqual(2048)
      expect(Math.min(frame.width, frame.height)).toBeGreaterThanOrEqual(1000)
    }
  })
})
