import { describe, expect, it } from 'vitest'
import { roomLight, type DamageSource } from './damageContract'

const source = (firelight?: DamageSource['firelight']): DamageSource => ({
  size: 1,
  pixels: new Uint8Array(4),
  version: 0,
  ...(firelight ? { firelight } : {}),
})

describe('firelight', () => {
  it('leaves the room alone when there is no fire to speak of', () => {
    expect(roomLight(null)).toBe(1)
    expect(roomLight(undefined)).toBe(1)
    expect(roomLight(source())).toBe(1)
    expect(roomLight(source({}))).toBe(1)
  })

  it('dims the room by as much as the source says', () => {
    expect(roomLight(source({ room: 0.33 }))).toBe(0.33)
    expect(roomLight(source({ room: 0 }))).toBe(0)
  })

  it('reads a bad value as no dimming at all, never as more light', () => {
    expect(roomLight(source({ room: Number.NaN }))).toBe(1)
    expect(roomLight(source({ room: -0.5 }))).toBe(1)
    expect(roomLight(source({ room: 3 }))).toBe(1)
  })
})
