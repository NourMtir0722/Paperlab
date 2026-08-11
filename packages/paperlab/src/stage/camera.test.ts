import { describe, expect, it } from 'vitest'
import { createWalkPath, walkPathSchema } from './path'
import { shotSchema, stageCamera, walkPoint } from './camera'
import { bannerTextSize, splitAcrossBanners } from './PaperStage'

const HEIGHT = 1.75
const path = (o: Record<string, unknown> = {}) => createWalkPath(walkPathSchema.parse(o))
const shot = (o: Record<string, unknown> = {}) => shotSchema.parse(o)

describe('walkPoint', () => {
  it('extrapolates past both ends of an open walk instead of clamping', () => {
    // The default walk runs from z = 9 to z = -9 down -Z.
    const walk = path()
    expect(walkPoint(walk, -5)[1]).toBeCloseTo(14, 4)
    expect(walkPoint(walk, walk.length + 5)[1]).toBeCloseTo(-14, 4)
  })

  it('wraps a closed walk rather than running off it', () => {
    const ring = path({
      points: [
        [4, 0],
        [0, 4],
        [-4, 0],
        [0, -4],
      ],
      closed: true,
    })
    const [x, z] = walkPoint(ring, 2)
    const [wx, wz] = walkPoint(ring, 2 + ring.length)
    expect(wx).toBeCloseTo(x, 5)
    expect(wz).toBeCloseTo(z, 5)
  })
})

describe('stage camera', () => {
  it('follow stands behind the figure and looks up the walk past it', () => {
    const walk = path()
    const camera = stageCamera(walk, 6, HEIGHT, shot())
    const figure = walkPoint(walk, 6)
    // Walking down -Z, so "behind" is a LARGER z and "ahead" is smaller.
    expect(camera.position[2]).toBeGreaterThan(figure[1])
    expect(camera.target[2]).toBeLessThan(figure[1])
    expect(camera.position[1]).toBeCloseTo(HEIGHT * 0.95, 5)
  })

  it('does not sit on the figure at the very start of an open walk', () => {
    const walk = path()
    const camera = stageCamera(walk, 0, HEIGHT, shot({ distance: 4.5 }))
    const start = walkPoint(walk, 0)
    expect(Math.abs(camera.position[2] - start[1])).toBeCloseTo(4.5, 4)
  })

  it('lead walks backward in front, framing the figure itself', () => {
    const walk = path()
    const camera = stageCamera(walk, 6, HEIGHT, shot({ shot: 'lead' }))
    const figure = walkPoint(walk, 6)
    expect(camera.position[2]).toBeLessThan(figure[1])
    expect(camera.target[2]).toBeCloseTo(figure[1], 4)
  })

  it('low drops to the floor and looks up the banners', () => {
    const camera = stageCamera(path(), 6, HEIGHT, shot({ shot: 'low' }))
    expect(camera.position[1]).toBeLessThan(HEIGHT * 0.2)
    // Aiming well over the figure's head is what makes paper read as architecture.
    expect(camera.target[1]).toBeGreaterThan(HEIGHT * 2)
  })

  it('wide steps off the walk line by its full distance', () => {
    const walk = path()
    const camera = stageCamera(walk, 6, HEIGHT, shot({ shot: 'wide', distance: 8 }))
    const figure = walkPoint(walk, 6)
    expect(Math.abs(camera.position[0])).toBeCloseTo(8, 4)
    // Level with the figure along the walk, not behind it.
    expect(camera.position[2]).toBeCloseTo(figure[1], 4)
  })

  it('offset steps the camera sideways off the walk', () => {
    const walk = path()
    const centered = stageCamera(walk, 6, HEIGHT, shot())
    const stepped = stageCamera(walk, 6, HEIGHT, shot({ offset: 2 }))
    expect(Math.abs(stepped.position[0] - centered.position[0])).toBeCloseTo(2, 4)
  })

  it('every height is a multiple of the figure, so the shot survives a rescale', () => {
    const small = stageCamera(path(), 6, 1, shot())
    const large = stageCamera(path(), 6, 3, shot())
    expect(large.position[1] / small.position[1]).toBeCloseTo(3, 5)
    expect(large.target[1] / small.target[1]).toBeCloseTo(3, 5)
  })

  it('the height multiplier scales the shot without moving it', () => {
    const base = stageCamera(path(), 6, HEIGHT, shot())
    const raised = stageCamera(path(), 6, HEIGHT, shot({ height: 2 }))
    expect(raised.position[1]).toBeCloseTo(base.position[1] * 2, 5)
    expect(raised.position[2]).toBeCloseTo(base.position[2], 5)
  })

  it('turns with a curved walk instead of pointing down a fixed axis', () => {
    const curve = path({
      points: [
        [0, 9],
        [5, 0],
        [0, -9],
      ],
    })
    const early = stageCamera(curve, 3, HEIGHT, shot())
    const late = stageCamera(curve, curve.length - 3, HEIGHT, shot())
    expect(early.target[0]).not.toBeCloseTo(late.target[0], 1)
  })
})

describe('banner typography', () => {
  it('sizes a column to fill the drop, not to stop a third of the way down', () => {
    // lines × size × 1.25 lands near the 900px of usable texture height.
    for (const lines of [6, 10, 18, 28]) {
      const filled = lines * bannerTextSize(lines) * 1.25
      expect(filled).toBeGreaterThan(700)
      expect(filled).toBeLessThan(1250)
    }
  })

  it('clamps at both ends — two words are huge, a dense column stays legible', () => {
    expect(bannerTextSize(1)).toBe(150)
    expect(bannerTextSize(200)).toBe(26)
    expect(bannerTextSize(4)).toBeGreaterThan(bannerTextSize(20))
  })

  it('stacks each banner share DOWN the drop, never across the width', () => {
    const columns = splitAcrossBanners('one two three four five six', 3)
    expect(columns).toHaveLength(3)
    // Two words per banner, one above the other.
    expect(columns[0]).toBe('one\ntwo')
    expect(columns.every((c) => !c.includes(' '))).toBe(true)
  })

  it('survives text with nothing in it', () => {
    expect(splitAcrossBanners('   ', 8)).toEqual([])
    expect(splitAcrossBanners('word', 0)).toEqual([])
  })
})
