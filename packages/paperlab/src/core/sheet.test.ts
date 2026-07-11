import { describe, expect, it } from 'vitest'
import { sheetSchema } from '../config/schema'
import { createSheetGeometry, resolveSegments } from './sheet'
import { resolveMode } from './modes'

describe('resolveSegments', () => {
  it('gives the long side 72 segments in auto mode', () => {
    const sheet = sheetSchema.parse({ width: 1, height: 2 })
    expect(resolveSegments(sheet)).toEqual([36, 72])
  })

  it('respects explicit segment counts', () => {
    const sheet = sheetSchema.parse({ segments: 24 })
    expect(resolveSegments(sheet)).toEqual([24, 24])
  })

  it('raises the floor to a deformer minSegments requirement', () => {
    const sheet = sheetSchema.parse({ segments: 4 })
    expect(resolveSegments(sheet, 48)).toEqual([48, 48])
  })
})

describe('createSheetGeometry', () => {
  it('creates a centered plane with the right vertex count', () => {
    const sheet = sheetSchema.parse({ width: 1, height: 1, segments: 8 })
    const geo = createSheetGeometry(sheet)
    expect(geo.attributes.position!.count).toBe(9 * 9)
    geo.computeBoundingBox()
    expect(geo.boundingBox!.min.x).toBeCloseTo(-0.5)
    expect(geo.boundingBox!.max.y).toBeCloseTo(0.5)
  })
})

describe('resolveMode', () => {
  it('picks hero for interactive or low counts, field for big passive galleries', () => {
    expect(resolveMode('auto', { interactive: true, physics: 'none', count: 100 })).toBe('hero')
    expect(resolveMode('auto', { interactive: false, physics: 'none', count: 3 })).toBe('hero')
    expect(resolveMode('auto', { interactive: false, physics: 'none', count: 40 })).toBe('field')
    expect(resolveMode('field', { interactive: true, physics: 'none', count: 1 })).toBe('field')
  })
})
