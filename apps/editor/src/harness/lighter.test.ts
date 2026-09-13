import { describe, expect, it } from 'vitest'
import { LighterWatch } from './lighter'

const W = 64
const H = 48

/** A frame of one colour, with a blob of another painted into it. */
function frame(blob?: { x: number; y: number; r: number; color: [number, number, number] }): Uint8Array {
  const pixels = new Uint8Array(W * H * 4)
  for (let i = 0; i < W * H; i++) pixels[i * 4 + 3] = 255
  if (!blob) return pixels
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (Math.hypot(x - blob.x, y - blob.y) > blob.r) continue
      const i = (y * W + x) * 4
      pixels[i] = blob.color[0]
      pixels[i + 1] = blob.color[1]
      pixels[i + 2] = blob.color[2]
    }
  }
  return pixels
}

const FLAME: [number, number, number] = [255, 170, 40]
const LAMP: [number, number, number] = [250, 250, 245]

/** Watch a few frames of the same thing, wobbling the way a flame does. */
function watch(watcher: LighterWatch, count: number, blob: Parameters<typeof frame>[0], wobble = 0) {
  let last = null
  for (let i = 0; i < count; i++) {
    const r = blob ? blob.r + (i % 2 === 0 ? wobble : 0) : 0
    last = watcher.see(frame(blob ? { ...blob, r } : undefined), W, H)
  }
  return last
}

describe('a lighter, seen by the camera', () => {
  it('sees nothing in an empty room', () => {
    expect(watch(new LighterWatch(), 12, undefined)).toBeNull()
  })

  it('does not call one frame a flame', () => {
    const watcher = new LighterWatch()
    expect(watcher.see(frame({ x: 20, y: 16, r: 4, color: FLAME }), W, H)).toBeNull()
  })

  it('finds a flame once it has flickered, and says where it is', () => {
    const seen = watch(new LighterWatch(), 12, { x: 16, y: 12, r: 4, color: FLAME }, 1)
    expect(seen).not.toBeNull()
    expect(seen?.x).toBeCloseTo(16 / W, 1)
    expect(seen?.y).toBeCloseTo(12 / H, 1)
    expect(seen?.share).toBeGreaterThan(0)
  })

  it('is not fooled by a lamp: white, and it never moves', () => {
    expect(watch(new LighterWatch(), 14, { x: 32, y: 24, r: 5, color: LAMP })).toBeNull()
    // Warm, but as steady as a bulb: no flicker, no flame.
    expect(watch(new LighterWatch(), 14, { x: 32, y: 24, r: 5, color: FLAME })).toBeNull()
  })

  it('is not fooled by a warm wall filling the frame', () => {
    expect(watch(new LighterWatch(), 14, { x: 32, y: 24, r: 40, color: FLAME }, 1)).toBeNull()
  })

  it('forgets what it saw when the camera stops', () => {
    const watcher = new LighterWatch()
    expect(watch(watcher, 12, { x: 16, y: 12, r: 4, color: FLAME }, 1)).not.toBeNull()
    watcher.reset()
    expect(watcher.see(frame({ x: 16, y: 12, r: 4, color: FLAME }), W, H)).toBeNull()
  })
})
