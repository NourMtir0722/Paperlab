import { describe, expect, it } from 'vitest'
import { getWalk, walkNames, walks } from './walks'
import { createWalkPath, walkPathSchema } from './path'

describe('named walks', () => {
  it('every name resolves to a path the schema accepts', () => {
    for (const name of walkNames) {
      const path = createWalkPath(walkPathSchema.parse(getWalk(name)))
      expect(path.length).toBeGreaterThan(8)
    }
  })

  it('ring is the closed one — the only walk phase can slide', () => {
    expect(walks.ring.closed).toBe(true)
    for (const name of walkNames) {
      if (name !== 'ring') expect(walks[name].closed).toBe(false)
    }
  })

  it('straight really is straight, and the curved ones really turn', () => {
    const straight = createWalkPath(walkPathSchema.parse(walks.straight))
    expect(straight.tangentAt(0.1)[0]).toBeCloseTo(straight.tangentAt(0.9)[0], 5)

    for (const name of ['bend', 'ess', 'spiral'] as const) {
      const path = createWalkPath(walkPathSchema.parse(walks[name]))
      const start = path.tangentAt(0)
      // Deviation ANYWHERE along the walk, not between its ends: an S-curve
      // finishes on roughly the heading it started on and still turns twice.
      let turned = 0
      for (let i = 1; i <= 40; i++) {
        const here = path.tangentAt(i / 40)
        turned = Math.max(turned, Math.hypot(here[0] - start[0], here[1] - start[1]))
      }
      expect(turned).toBeGreaterThan(0.3)
    }
  })

  it('ess turns twice, which is what separates it from a bend', () => {
    const path = createWalkPath(walkPathSchema.parse(walks.ess))
    const turns: number[] = []
    let previous = path.tangentAt(0)
    for (let i = 1; i <= 40; i++) {
      const next = path.tangentAt(i / 40)
      // 2D cross product: its sign is which way the walk is bending.
      turns.push(previous[0] * next[1] - previous[1] * next[0])
      previous = next
    }
    expect(turns.some((t) => t > 1e-4)).toBe(true)
    expect(turns.some((t) => t < -1e-4)).toBe(true)
  })
})
