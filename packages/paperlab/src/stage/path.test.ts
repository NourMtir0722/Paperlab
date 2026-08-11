import { describe, expect, it } from 'vitest'
import { createWalkPath, getWalkPath, walkPathSchema, type Ground } from './path'

const parse = (input: unknown = {}) => walkPathSchema.parse(input)

function distance(a: Ground, b: Ground): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

describe('walk path', () => {
  it('defaults to a straight 18-unit walk away from the camera', () => {
    const path = createWalkPath(parse())
    expect(path.length).toBeCloseTo(18, 5)
    expect(path.pointAt(0)).toEqual([0, 9])
    const middle = path.pointAt(0.5)
    expect(middle[0]).toBeCloseTo(0, 6)
    expect(middle[1]).toBeCloseTo(0, 6)
  })

  it('walks at a constant speed — equal steps in s cover equal ground', () => {
    // An S-bend: a raw spline parameter would sprint the straights and crawl
    // the corners. Arc-length reparameterization is what removes that.
    const path = createWalkPath(
      parse({
        points: [
          [-6, 6],
          [-2, 1],
          [2, -1],
          [6, -6],
        ],
      }),
    )
    const steps = 60
    const spans: number[] = []
    for (let i = 0; i < steps; i++) {
      spans.push(distance(path.pointAt(i / steps), path.pointAt((i + 1) / steps)))
    }
    const expected = path.length / steps
    for (const span of spans) expect(span).toBeCloseTo(expected, 2)
  })

  it('tangent points along the walk, normal points to the walker left', () => {
    const path = createWalkPath(parse())
    const [tx, tz] = path.tangentAt(0.5)
    expect(tx).toBeCloseTo(0, 6)
    expect(tz).toBeCloseTo(-1, 6)
    // Facing -Z with +Y up, the left hand points down -X.
    const [nx, nz] = path.normalAt(0.5)
    expect(nx).toBeCloseTo(-1, 6)
    expect(nz).toBeCloseTo(0, 6)
  })

  it('open paths clamp past their ends, closed paths wrap', () => {
    const open = createWalkPath(parse())
    expect(open.pointAt(-3)).toEqual(open.pointAt(0))
    expect(open.pointAt(4)).toEqual(open.pointAt(1))

    const ring = createWalkPath(
      parse({
        points: [
          [3, 0],
          [0, 3],
          [-3, 0],
          [0, -3],
        ],
        closed: true,
      }),
    )
    expect(ring.closed).toBe(true)
    const [x0, z0] = ring.pointAt(0.25)
    const [x1, z1] = ring.pointAt(1.25)
    expect(x1).toBeCloseTo(x0, 6)
    expect(z1).toBeCloseTo(z0, 6)
  })

  it('a closed ring of four points measures about its circumference', () => {
    const ring = createWalkPath(
      parse({
        points: [
          [3, 0],
          [0, 3],
          [-3, 0],
          [0, -3],
        ],
        closed: true,
      }),
    )
    expect(ring.length).toBeGreaterThan(2 * Math.PI * 3 * 0.9)
    expect(ring.length).toBeLessThan(2 * Math.PI * 3 * 1.1)
  })

  it('centripetal parameterization does not loop back on bunched points', () => {
    // Two control points nearly on top of each other: a uniform Catmull-Rom
    // throws a cusp here and the walk briefly reverses.
    const path = createWalkPath(
      parse({
        points: [
          [0, 6],
          [0, 0],
          [0.02, -0.02],
          [0, -6],
        ],
      }),
    )
    let previous = path.pointAt(0)
    for (let i = 1; i <= 200; i++) {
      const point = path.pointAt(i / 200)
      // Never turns around: every step keeps heading down -Z.
      expect(point[1]).toBeLessThanOrEqual(previous[1] + 1e-6)
      previous = point
    }
  })

  it('degenerate paths report a direction instead of NaN', () => {
    const path = createWalkPath(
      parse({
        points: [
          [2, 2],
          [2, 2],
        ],
      }),
    )
    expect(path.length).toBeCloseTo(0, 6)
    expect(path.pointAt(0.5)).toEqual([2, 2])
    expect(path.tangentAt(0.5)).toEqual([0, -1])
  })

  it('memoizes by value so a pure pose() can build one per call', () => {
    const options = parse({
      points: [
        [0, 4],
        [1, -4],
      ],
    })
    expect(getWalkPath(options)).toBe(
      getWalkPath(
        parse({
          points: [
            [0, 4],
            [1, -4],
          ],
        }),
      ),
    )
    expect(getWalkPath(options)).not.toBe(
      getWalkPath(
        parse({
          points: [
            [0, 4],
            [2, -4],
          ],
        }),
      ),
    )
  })
})
