import { describe, expect, it } from 'vitest'
import { mountSchema } from 'paperlab'
import { freeSpot, stickerControls } from './mountControls'

describe('freeSpot', () => {
  it('puts the first sticker on the side facing the camera', () => {
    const spot = freeSpot([{ azimuth: 0, elevation: 0 }])
    expect(Math.abs(spot.azimuth)).toBeLessThan(120)
  })

  it('never lands on top of a sticker that is already there', () => {
    const taken = [{ azimuth: 0, elevation: 0 }]
    for (let i = 0; i < 10; i++) {
      const spot = freeSpot(taken)
      for (const t of taken) {
        const same = Math.abs(spot.azimuth - t.azimuth) < 1 && Math.abs(spot.elevation - t.elevation) < 1
        expect(same).toBe(false)
      }
      taken.push(spot)
    }
  })

  it('keeps off the ends, where the stem and the tip are', () => {
    const taken = [{ azimuth: 0, elevation: 0 }]
    for (let i = 0; i < 12; i++) {
      const spot = freeSpot(taken)
      expect(Math.abs(spot.elevation)).toBeLessThanOrEqual(58)
      taken.push(spot)
    }
  })
})

describe('the object picker', () => {
  const rows = (object: 'lemon' | 'model') =>
    stickerControls(
      mountSchema.parse({ object, model: object === 'model' ? 'data:,x' : undefined }),
      () => {},
      () => {},
    )

  it('lists your own model as coming soon, and draws no upload button', () => {
    const picker = rows('lemon').find((c) => c.kind === 'select' && c.key === 'object')
    expect(picker?.kind === 'select' && picker.unavailable?.('model')).toBe('Coming soon')
    expect(rows('lemon').some((c) => c.kind === 'button' && /\.glb/.test(c.label))).toBe(false)
  })

  it('shows a mount that already carries a model as the lemon, and will not switch to it', () => {
    let wrote = false
    const picker = stickerControls(
      mountSchema.parse({ object: 'model', model: 'data:,x' }),
      () => {
        wrote = true
      },
      () => {},
    ).find((c) => c.kind === 'select' && c.key === 'object')
    expect(picker?.kind === 'select' && picker.value).toBe('lemon')
    if (picker?.kind === 'select') picker.onChange('model')
    expect(wrote).toBe(false)
  })
})
