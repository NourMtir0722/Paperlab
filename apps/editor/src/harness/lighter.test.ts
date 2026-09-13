import { describe, expect, it } from 'vitest'
import { LighterWatch } from './lighter'

const W = 64
const H = 48

type Rgb = [number, number, number]
interface Blob {
  x: number
  y: number
  r: number
  color: Rgb
  /** A white-hot middle, as a webcam clips a flame to — radius and colour. */
  core?: { r: number; color: Rgb }
}

/** A dark frame with a blob painted into it. */
function frame(blob?: Blob): Uint8Array {
  const pixels = new Uint8Array(W * H * 4)
  for (let i = 0; i < W * H; i++) pixels[i * 4 + 3] = 255
  if (!blob) return pixels
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - blob.x, y - blob.y)
      if (d > blob.r) continue
      const color = blob.core && d <= blob.core.r ? blob.core.color : blob.color
      const i = (y * W + x) * 4
      pixels[i] = color[0]
      pixels[i + 1] = color[1]
      pixels[i + 2] = color[2]
    }
  }
  return pixels
}

const FLAME: Rgb = [255, 170, 40]
const LAMP: Rgb = [250, 250, 245]
/** A face under a warm bulb: warm, bright, moving — and too blue to be a flame. */
const WARM_SKIN: Rgb = [245, 185, 120]

/** Every answer the watch gives over a few frames, wobbling the way a flame does. */
function answers(watcher: LighterWatch, count: number, blob: Blob | undefined, wobble = 0) {
  const out = []
  for (let i = 0; i < count; i++) {
    const r = blob ? blob.r + (i % 2 === 0 ? wobble : 0) : 0
    out.push(watcher.see(frame(blob ? { ...blob, r } : undefined), W, H))
  }
  return out
}

const last = <T>(list: T[]) => list[list.length - 1] ?? null

describe('a lighter, seen by the camera', () => {
  it('sees nothing in an empty room', () => {
    expect(last(answers(new LighterWatch(), 12, undefined))).toBeNull()
  })

  it('does not call one frame a flame', () => {
    const watcher = new LighterWatch()
    expect(watcher.see(frame({ x: 20, y: 16, r: 4, color: FLAME }), W, H)).toBeNull()
  })

  it('finds a flame once it has flickered, and says where it is', () => {
    const seen = last(answers(new LighterWatch(), 12, { x: 16, y: 12, r: 4, color: FLAME }, 1))
    expect(seen).not.toBeNull()
    expect(seen?.x).toBeCloseTo(16 / W, 1)
    expect(seen?.y).toBeCloseTo(12 / H, 1)
    expect(seen?.share).toBeGreaterThan(0)
  })

  it('draws a box round what it found, and says how sure it is', () => {
    const seen = last(answers(new LighterWatch(), 12, { x: 16, y: 12, r: 4, color: FLAME }, 1))
    expect(seen?.box.x0).toBeLessThan(16 / W)
    expect(seen?.box.x1).toBeGreaterThan(16 / W)
    expect(seen?.box.y0).toBeLessThan(12 / H)
    expect(seen?.box.y1).toBeGreaterThan(12 / H)
    expect(seen?.confidence).toBeGreaterThan(0.6)
    expect(seen?.confidence).toBeLessThan(1)
  })

  it('catches within a handful of frames', () => {
    const all = answers(new LighterWatch(), 8, { x: 16, y: 12, r: 4, color: FLAME }, 1)
    expect(all.findIndex((a) => a !== null)).toBeLessThanOrEqual(4)
  })

  it('sees a flame whose middle the camera has clipped to white', () => {
    const clipped = { x: 30, y: 20, r: 5, color: FLAME, core: { r: 3, color: LAMP } }
    const seen = last(answers(new LighterWatch(), 12, clipped, 1))
    expect(seen).not.toBeNull()
    // The white core counts toward the flame, beside its warm fringe.
    const fringeOnly = last(
      answers(new LighterWatch(), 12, { ...clipped, core: { r: 3, color: [0, 0, 0] } }, 1),
    )
    expect(seen?.share).toBeGreaterThan(fringeOnly?.share ?? 1)
  })

  it('is not fooled by a lamp: white, and it never moves', () => {
    expect(last(answers(new LighterWatch(), 14, { x: 32, y: 24, r: 5, color: LAMP }, 1))).toBeNull()
  })

  it('never reports a steady warm light, not even for a moment', () => {
    // The first frames matter as much as the last: a sighting starts a burn,
    // so a lamp called a flame for a third of a second sets the sheet alight.
    const all = answers(new LighterWatch(), 14, { x: 32, y: 24, r: 5, color: FLAME })
    expect(all.every((a) => a === null)).toBe(true)
  })

  it('is not fooled by a face under a warm bulb, however it moves', () => {
    expect(last(answers(new LighterWatch(), 14, { x: 32, y: 24, r: 6, color: WARM_SKIN }, 2))).toBeNull()
  })

  it('is not fooled by a warm wall filling the frame', () => {
    expect(last(answers(new LighterWatch(), 14, { x: 32, y: 24, r: 40, color: FLAME }, 1))).toBeNull()
  })

  it('forgets what it saw when the camera stops', () => {
    const watcher = new LighterWatch()
    expect(last(answers(watcher, 12, { x: 16, y: 12, r: 4, color: FLAME }, 1))).not.toBeNull()
    watcher.reset()
    expect(watcher.see(frame({ x: 16, y: 12, r: 4, color: FLAME }), W, H)).toBeNull()
  })
})
