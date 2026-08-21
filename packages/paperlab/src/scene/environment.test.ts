import { describe, expect, it } from 'vitest'
import { skyU, skyV } from './environment'
import { getLightingPreset, lightAngles } from './lighting'

/**
 * The environment is an image, and where the bright patch lands in it is the
 * one thing about it that can be wrong in a way nobody notices: a room lit
 * from the wrong side still looks like a room. So the mapping is pinned to
 * three's own `equirectUv` here rather than eyeballed in a render.
 */
describe('where the key lands in the room', () => {
  it("matches three's equirect mapping: u = atan2(z, x) / 2π + 0.5", () => {
    for (const azimuth of [-180, -90, -37, 0, 45, 90, 180]) {
      const radians = (azimuth * Math.PI) / 180
      const [x, z] = [Math.sin(radians), Math.cos(radians)]
      const expected = (((Math.atan2(z, x) / (Math.PI * 2) + 0.5) % 1) + 1) % 1
      expect(skyU(azimuth)).toBeCloseTo(expected, 6)
    }
  })

  it('puts the zenith at the top row and the floor at the bottom', () => {
    expect(skyV(90)).toBeCloseTo(0)
    expect(skyV(0)).toBeCloseTo(0.5)
    expect(skyV(-90)).toBeCloseTo(1)
  })

  it("nave's key sits behind the walk, so its patch of sky does too", () => {
    const { azimuth } = lightAngles(getLightingPreset('nave').key.position)
    // Behind is ±180°, which is exactly where the image wraps — the reason
    // the disc is drawn three times rather than once.
    expect(skyU(azimuth)).toBeCloseTo(0.25, 6)
  })
})
