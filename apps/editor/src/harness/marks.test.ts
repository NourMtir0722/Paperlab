import { describe, expect, it } from 'vitest'
import {
  CORNER_MARGIN,
  EDGE_MARGIN,
  MAX_SCORE_STEP,
  MIN_SCORE_LENGTH,
  PERF_PULL,
  SCORE_DEPTH,
  addCrease,
  continuesScore,
  creaseFromDrag,
  foldAlong,
  nearestCorner,
  nearestEdge,
  ripsApart,
} from './marks'

/** The pinned-sheet preset's dimensions — deliberately not square. */
const SHEET = { width: 1.2, height: 1.5 }

/**
 * The library's own conversion, inlined, so these tests assert where the
 * crease actually LANDS rather than only what the triple contains. Keeping a
 * copy here is the point: if the library changes its convention, this
 * disagrees loudly instead of the harness drawing lines in the wrong place.
 */
function shadedPosition(crease: { angle: number; offset: number }) {
  const rad = (crease.angle * Math.PI) / 180
  const span = Math.abs(SHEET.width * Math.cos(rad)) + Math.abs(SHEET.height * Math.sin(rad))
  return span > 0 ? 0.5 + crease.offset / span : 0.5
}

describe('creaseFromDrag', () => {
  it('scores a horizontal line as a fold travelling vertically', () => {
    // Drawn straight across the middle: the LINE is horizontal, so the fold
    // travels at 90°, and it sits halfway up the sheet.
    const crease = creaseFromDrag({ u: 0.1, v: 0.5 }, { u: 0.9, v: 0.5 }, SHEET)!
    expect(crease.angle).toBeCloseTo(90, 6)
    expect(crease.offset).toBeCloseTo(0, 6)
    expect(shadedPosition(crease)).toBeCloseTo(0.5, 6)
  })

  it('scores a vertical line as a fold travelling across', () => {
    const crease = creaseFromDrag({ u: 0.5, v: 0.1 }, { u: 0.5, v: 0.9 }, SHEET)!
    expect(crease.angle).toBeCloseTo(0, 6)
    expect(shadedPosition(crease)).toBeCloseTo(0.5, 6)
  })

  it('puts the line where it was drawn, not at the centre', () => {
    // A quarter of the way up. The shader works in fractions across the
    // sheet, so this is the assertion that catches an offset in the wrong
    // units — a world distance passed off as a fraction lands at 0.5 + 0.25.
    const low = creaseFromDrag({ u: 0.1, v: 0.25 }, { u: 0.9, v: 0.25 }, SHEET)!
    expect(shadedPosition(low)).toBeCloseTo(0.25, 6)
    const high = creaseFromDrag({ u: 0.1, v: 0.8 }, { u: 0.9, v: 0.8 }, SHEET)!
    expect(shadedPosition(high)).toBeCloseTo(0.8, 6)
  })

  it('does not care which way the finger travelled', () => {
    // The same line drawn backwards is the same crease. Without the canonical
    // wrap this comes back as angle + 180 with the offset negated, which the
    // renderer happens to survive and every test of it does not.
    const there = creaseFromDrag({ u: 0.1, v: 0.3 }, { u: 0.9, v: 0.3 }, SHEET)!
    const back = creaseFromDrag({ u: 0.9, v: 0.3 }, { u: 0.1, v: 0.3 }, SHEET)!
    expect(back.angle).toBeCloseTo(there.angle, 6)
    expect(back.offset).toBeCloseTo(there.offset, 6)
  })

  it('keeps a diagonal in the canonical half-turn', () => {
    const crease = creaseFromDrag({ u: 0.2, v: 0.2 }, { u: 0.8, v: 0.8 }, SHEET)!
    expect(crease.angle).toBeGreaterThanOrEqual(0)
    expect(crease.angle).toBeLessThan(180)
  })

  it('marks the paper rather than folding it', () => {
    const crease = creaseFromDrag({ u: 0.1, v: 0.5 }, { u: 0.9, v: 0.5 }, SHEET)!
    expect(crease.depth).toBe(SCORE_DEPTH)
    // Well under the 90° that saturates the crease shading.
    expect(Math.abs(crease.depth)).toBeLessThan(90)
  })

  it('ignores a tap', () => {
    expect(creaseFromDrag({ u: 0.5, v: 0.5 }, { u: 0.5, v: 0.5 }, SHEET)).toBeNull()
    const tiny = MIN_SCORE_LENGTH / SHEET.width / 4
    expect(creaseFromDrag({ u: 0.5, v: 0.5 }, { u: 0.5 + tiny, v: 0.5 }, SHEET)).toBeNull()
  })
})

describe('addCrease', () => {
  const crease = (offset: number) => ({ angle: 90, offset, depth: SCORE_DEPTH })

  it('keeps the newest four', () => {
    let creases = [crease(1), crease(2), crease(3), crease(4)]
    creases = addCrease(creases, crease(5))
    expect(creases).toHaveLength(4)
    expect(creases.map((c) => c.offset)).toEqual([2, 3, 4, 5])
  })

  it('does not mutate what it was given', () => {
    const before = [crease(1)]
    addCrease(before, crease(2))
    expect(before).toHaveLength(1)
  })
})

describe('nearestEdge', () => {
  it('names the edge a grab is on', () => {
    expect(nearestEdge({ u: 0.02, v: 0.5 })).toBe('left')
    expect(nearestEdge({ u: 0.98, v: 0.5 })).toBe('right')
    expect(nearestEdge({ u: 0.5, v: 0.02 })).toBe('bottom')
    expect(nearestEdge({ u: 0.5, v: 0.98 })).toBe('top')
  })

  it('leaves the middle of the sheet alone', () => {
    // Tearing the paper because a grab drifted left would be worse than not
    // tearing it, so the centre is null rather than a nearest guess.
    expect(nearestEdge({ u: 0.5, v: 0.5 })).toBeNull()
    expect(nearestEdge({ u: 0.4, v: 0.6 })).toBeNull()
  })

  it('picks the closer edge in a corner', () => {
    expect(nearestEdge({ u: 0.02, v: 0.1 })).toBe('left')
    expect(nearestEdge({ u: 0.1, v: 0.02 })).toBe('bottom')
  })
})

describe('continuesScore', () => {
  it('accepts a fingertip drawing at speed', () => {
    const step = MAX_SCORE_STEP / 2
    expect(continuesScore({ u: 0.4, v: 0.4 }, { u: 0.4 + step, v: 0.4 })).toBe(true)
  })

  it('rejects the jump a hand makes when it stops pointing', () => {
    // The bug this exists for: the gesture reader debounces, so `point` is
    // still being reported while the hand is already moving away, and the end
    // of the line gets dragged to wherever it relaxed to.
    expect(continuesScore({ u: 0.5, v: 0.447 }, { u: 0.5, v: 0.255 })).toBe(false)
  })

  it('is measured as a distance, not per axis', () => {
    const diagonal = MAX_SCORE_STEP * 0.8
    expect(continuesScore({ u: 0.5, v: 0.5 }, { u: 0.5 + diagonal, v: 0.5 + diagonal })).toBe(false)
  })
})

describe('ripsApart', () => {
  it('needs the hands to travel apart, not just to travel', () => {
    // Two hands crossing the frame together is the sheet being carried; the
    // gap between them growing is the paper being pulled in two.
    expect(ripsApart(1, 1 + PERF_PULL + 0.1)).toBe(true)
    expect(ripsApart(1, 1 + PERF_PULL - 0.1)).toBe(false)
    expect(ripsApart(3, 3)).toBe(false)
  })

  it('does not rip when the hands come together', () => {
    expect(ripsApart(4, 1)).toBe(false)
  })
})

describe('foldAlong', () => {
  it('leaves a line already naming its near edge alone', () => {
    expect(foldAlong({ angle: 90, offset: 0.3, depth: 16 })).toEqual({ angle: 90, offset: 0.3 })
  })

  it('turns a line around so the smaller side is the one that folds', () => {
    // `fold` moves everything beyond the hinge in the travel direction, so a
    // negative offset rotates the BULK of the sheet about a line near its
    // edge — which reads as the paper swinging off its pins, not as a fold.
    expect(foldAlong({ angle: 90, offset: -0.3, depth: 16 })).toEqual({ angle: 270, offset: 0.3 })
  })

  it('describes the same physical line either way', () => {
    // The pair (angle, offset) and (angle + 180, -offset) name one line. If
    // that stops being true, this rule silently folds along a different one.
    const turned = foldAlong({ angle: 40, offset: -0.5, depth: 16 })
    const line = (angle: number, offset: number) => ({
      x: Math.cos((angle * Math.PI) / 180) * offset,
      y: Math.sin((angle * Math.PI) / 180) * offset,
    })
    const before = line(40, -0.5)
    const after = line(turned.angle, turned.offset)
    expect(after.x).toBeCloseTo(before.x, 12)
    expect(after.y).toBeCloseTo(before.y, 12)
  })
})

describe('nearestCorner', () => {
  it('names the corner a grab landed in', () => {
    expect(nearestCorner({ u: 0.02, v: 0.02 })).toBe('bottom-left')
    expect(nearestCorner({ u: 0.98, v: 0.98 })).toBe('top-right')
    expect(nearestCorner({ u: 0.02, v: 0.98 })).toBe('top-left')
    expect(nearestCorner({ u: 0.98, v: 0.02 })).toBe('bottom-right')
  })

  it('is nothing in the middle, and nothing along an edge', () => {
    // An edge is not a corner: a pull on one tears the sheet, and a pinch on
    // one has to be free to mean that instead.
    expect(nearestCorner({ u: 0.5, v: 0.5 })).toBeNull()
    expect(nearestCorner({ u: 0.02, v: 0.5 })).toBeNull()
    expect(nearestCorner({ u: 0.5, v: 0.98 })).toBeNull()
  })

  it('gives a corner more room than an edge gets', () => {
    // You aim at a corner with a whole hand from a metre away.
    expect(CORNER_MARGIN).toBeGreaterThan(EDGE_MARGIN)
  })
})
