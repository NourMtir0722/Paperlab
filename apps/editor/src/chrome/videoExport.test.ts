import { describe, expect, it } from 'vitest'
import { clipFilename, frameTimes, pickClipFormat } from './videoExport'

describe('pickClipFormat', () => {
  it('prefers mp4, which is what plays where clips get posted', () => {
    expect(pickClipFormat(() => true)?.extension).toBe('mp4')
  })

  it('falls back to webm rather than to nothing', () => {
    const format = pickClipFormat((m) => m.startsWith('video/webm'))
    expect(format?.extension).toBe('webm')
  })

  it('prefers vp9 over vp8 when both are offered', () => {
    expect(pickClipFormat((m) => m.startsWith('video/webm'))?.mimeType).toContain('vp9')
  })

  it('returns null where nothing can be recorded, so the caller can say so', () => {
    expect(pickClipFormat(() => false)).toBeNull()
  })
})

describe('frameTimes', () => {
  it('starts at the beginning of the motion', () => {
    expect(frameTimes(10, 'loop')[0]).toBe(0)
    expect(frameTimes(10, 'pingpong')[0]).toBe(0)
  })

  it('never ends ON the loop point, which would show one frame twice', () => {
    // A clip whose last frame equals its first stutters once per repeat.
    expect(frameTimes(10, 'loop').at(-1)).toBeLessThan(1)
    expect(frameTimes(10, 'pingpong').at(-1)).toBeGreaterThan(0)
  })

  it('reaches the far end of the motion halfway through a ping-pong', () => {
    const times = frameTimes(10, 'pingpong')
    expect(Math.max(...times)).toBeCloseTo(1)
    expect(times.indexOf(Math.max(...times))).toBe(5)
  })

  it('comes back the way it went out', () => {
    // What closes the loop: frame i and frame (count - i) are the same pose.
    const times = frameTimes(12, 'pingpong')
    expect(times[1]).toBeCloseTo(times[11]!)
    expect(times[4]).toBeCloseTo(times[8]!)
  })

  it('runs one way for a motion that has somewhere to be', () => {
    const times = frameTimes(8, 'loop')
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  it('stays inside the motion for every frame it emits', () => {
    for (const style of ['loop', 'pingpong'] as const) {
      for (const t of frameTimes(97, style)) {
        expect(t).toBeGreaterThanOrEqual(0)
        expect(t).toBeLessThanOrEqual(1)
      }
    }
  })

  it('emits the number of frames it was asked for', () => {
    expect(frameTimes(72, 'pingpong')).toHaveLength(72)
    expect(frameTimes(1, 'loop')).toHaveLength(1)
    // A zero-length clip is a file nobody can play; one frame is the floor.
    expect(frameTimes(0, 'loop')).toHaveLength(1)
  })
})

describe('clipFilename', () => {
  it('matches the picture export, so a clip and a still sit together', () => {
    expect(clipFilename('Receipt unroll', 'story', 'mp4')).toBe('receipt-unroll-story.mp4')
  })

  it('falls back rather than producing a dotfile', () => {
    expect(clipFilename('  ', 'square', 'webm')).toBe('paper-square.webm')
  })
})
