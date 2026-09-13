import { describe, expect, it } from 'vitest'
import { CUT_REACH_MM, cutDistance } from './cutDistance'

const SIZE = 16

/** A field with paper everywhere except where `gone` says. */
function field(gone: (x: number, y: number) => boolean): Uint8Array {
  const pixels = new Uint8Array(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) pixels[(y * SIZE + x) * 4 + 3] = gone(x, y) ? 0 : 255
  }
  return pixels
}

function measure(pixels: Uint8Array, texelMm: [number, number] = [3, 3]): (x: number, y: number) => number {
  const out = new Uint8Array(SIZE * SIZE)
  cutDistance(pixels, SIZE, texelMm, out)
  return (x, y) => (out[y * SIZE + x]! / 255) * CUT_REACH_MM
}

describe('the distance from the cut', () => {
  it('is the whole reach everywhere on a sheet with no cut', () => {
    const out = new Uint8Array(SIZE * SIZE)
    cutDistance(
      field(() => false),
      SIZE,
      [3, 3],
      out,
    )
    expect(out.every((b) => b === 255)).toBe(true)
  })

  it('measures from a straight cut in millimetres, out to the reach', () => {
    const at = measure(field((x) => x < 4))
    expect(at(2, 8)).toBe(0)
    expect(at(4, 8)).toBeCloseTo(3, 0)
    expect(at(6, 8)).toBeCloseTo(9, 0)
    expect(at(15, 8)).toBe(CUT_REACH_MM)
  })

  it('does not take a speck of burnt-through paper for a cut', () => {
    // A speck near the rim used to grow its own ash lip, char and scorch.
    const at = measure(field((x, y) => x === 8 && y === 8))
    expect(at(9, 8)).toBe(CUT_REACH_MM)
    expect(at(8, 8)).toBe(CUT_REACH_MM)
  })

  it('keeps a cut that is thin but long — a real one', () => {
    const at = measure(field((x, y) => x === 8 && y >= 2 && y < 12))
    expect(at(8, 6)).toBe(0)
    expect(at(9, 6)).toBeCloseTo(3, 0)
  })

  it('uses the sheet’s own texel size in each direction', () => {
    // A4's texels are taller than they are wide: a step down is not a step across.
    const at = measure(
      field((_, y) => y < 4),
      [2, 5],
    )
    expect(at(8, 4)).toBeCloseTo(5, 0)
    expect(at(8, 5)).toBeCloseTo(10, 0)
  })
})
