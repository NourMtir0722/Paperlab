import { describe, expect, it } from 'vitest'
import { createWalkPath, walkPathSchema } from './path'
import { DEFAULT_PAPER_RATIO, shotSchema, stageCamera, walkPoint } from './camera'
import { bannerMeasure, bannerTextSize, splitAcrossBanners } from './PaperStage'

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

  it('wide clears the paper rather than standing inside the colonnade', () => {
    const walk = path()
    const scale = { figure: 1.75, paper: 8.5 }
    const camera = stageCamera(walk, 6, scale, shot({ shot: 'wide', distance: 8 }))
    // An aisle is a couple of units across, so a sideways step measured in
    // walk-distance drops the camera among the banners looking at the back
    // of one. It has to be measured against the thing it must clear.
    expect(Math.abs(camera.position[0])).toBeGreaterThan(scale.paper)
    // And it stands BACK along the walk as well — a 3/4 establishing shot.
    expect(camera.position[2]).toBeGreaterThan(walkPoint(walk, 6)[1])
    expect(camera.target[2]).toBeCloseTo(walkPoint(walk, 6)[1], 4)
  })

  it('taller paper pushes wide further out', () => {
    const walk = path()
    const near = stageCamera(walk, 6, { figure: 1.75, paper: 4 }, shot({ shot: 'wide' }))
    const far = stageCamera(walk, 6, { figure: 1.75, paper: 12 }, shot({ shot: 'wide' }))
    expect(Math.abs(far.position[0])).toBeGreaterThan(Math.abs(near.position[0]))
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

describe('framing the architecture', () => {
  const walk = path()
  const scale = { figure: 1.75, paper: 8.5 }

  it('aims above the figure, because the paper is what fills the frame', () => {
    // The bug: a shot that only knew the body aimed at chest height, and a
    // colonnade of 8.5-unit banners showed its bottom third.
    const camera = stageCamera(walk, 6, scale, shot())
    expect(camera.target[1]).toBeGreaterThan(scale.figure)
    expect(camera.target[1]).toBeLessThan(scale.paper)
  })

  it('taller paper lifts the aim; the camera stays at eye level', () => {
    const short = stageCamera(walk, 6, { figure: 1.75, paper: 3 }, shot())
    const tall = stageCamera(walk, 6, { figure: 1.75, paper: 12 }, shot())
    expect(tall.target[1]).toBeGreaterThan(short.target[1])
    // Where you STAND is a body measurement and must not move with the paper.
    expect(tall.position[1]).toBeCloseTo(short.position[1], 6)
  })

  it('low looks up the banners and barely acknowledges the figure', () => {
    const low = stageCamera(walk, 6, scale, shot({ shot: 'low' }))
    expect(low.target[1]).toBeGreaterThan(scale.paper * 0.5)
    // Same shot with a different sized person aims at the same place.
    const bigger = stageCamera(walk, 6, { figure: 2.1, paper: 8.5 }, shot({ shot: 'low' }))
    expect(bigger.target[1]).toBeCloseTo(low.target[1], 6)
  })

  it('lead still frames the person — it is their shot', () => {
    const lead = stageCamera(walk, 6, scale, shot({ shot: 'lead' }))
    expect(lead.target[1]).toBeLessThan(stageCamera(walk, 6, scale, shot()).target[1])
  })

  it('a bare number assumes banner-ish paper, so old call sites still frame', () => {
    const bare = stageCamera(walk, 6, 1.75, shot())
    const explicit = stageCamera(walk, 6, { figure: 1.75, paper: 1.75 * DEFAULT_PAPER_RATIO }, shot())
    expect(bare.target[1]).toBeCloseTo(explicit.target[1], 9)
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

  /**
   * A stage that asks for twelve banners and is handed a paragraph must get
   * twelve columns. Slicing at `ceil(words / banners)` left the remainder
   * unallocated — the ribbon stage's twenty words over twelve banners
   * produced ten columns, and two banners hung blank.
   */
  it('gives every banner a share, however the words divide', () => {
    for (const banners of [3, 5, 7, 12, 20]) {
      const words = Array.from({ length: 20 }, (_, i) => `w${i}`).join(' ')
      const columns = splitAcrossBanners(words, banners)
      expect(columns, `${banners} banners`).toHaveLength(Math.min(banners, 20))
      // Nothing dropped, nothing duplicated.
      expect(columns.join('\n').split('\n')).toHaveLength(20)
    }
  })

  it('never leaves a banner one word while another carries three', () => {
    const columns = splitAcrossBanners('a b c d e f g h i j', 4)
    const lengths = columns.map((c) => c.split('\n').length)
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThanOrEqual(1)
  })

  it('has fewer columns than banners only when there are fewer words', () => {
    expect(splitAcrossBanners('one two', 9)).toHaveLength(2)
  })

  /**
   * The bug this pair guards: the sizer knew how tall a banner was and not
   * how WIDE. On the ribbon stage's 1.05 x 9 strip it asked for 150px type
   * on about 105px of measure, so every word broke to one letter a line and
   * the column then overran the drop and was clipped. The frame showed a
   * single enormous letter per strip.
   */
  it('caps the size at something the longest word can sit on', () => {
    const strip = bannerMeasure({ width: 1.05, height: 9 })
    // Two words on a nine-metre drop still wants 150 on the drop alone…
    expect(bannerTextSize(2)).toBe(150)
    // …and cannot have it on a strip this narrow.
    const sized = bannerTextSize(2, 'paper'.length, strip)
    expect(sized).toBeLessThan(150)
    expect(sized * 'paper'.length * 0.62).toBeLessThanOrEqual(strip)
  })

  it('leaves a wide banner alone — the width only binds when it is the tighter limit', () => {
    // 520px of measure holds a four-letter word at the drop's own 120px.
    const wide = bannerMeasure({ width: 1.5, height: 2.6 })
    expect(bannerTextSize(6, 4, wide)).toBe(bannerTextSize(6))
    // …and a long word on the same banner is still capped, because the
    // constraint is the word, not the shape.
    expect(bannerTextSize(6, 12, wide)).toBeLessThan(bannerTextSize(6))
  })

  it('still answers without a measure, so an old call site keeps its size', () => {
    expect(bannerTextSize(6)).toBe(bannerTextSize(6, 0, 10))
  })

  it('measures the strip inside its margins, not edge to edge', () => {
    // 1024 on the long edge, inset 6% of the short side at each margin.
    expect(bannerMeasure({ width: 1.05, height: 9 })).toBeCloseTo((1.05 / 9) * 1024 * 0.88, 6)
    expect(bannerMeasure({ width: 0, height: 0 })).toBe(Number.POSITIVE_INFINITY)
  })
})
