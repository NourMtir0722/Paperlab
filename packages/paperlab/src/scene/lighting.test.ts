import { describe, expect, it } from 'vitest'
import {
  getLightingPreset,
  lightAngles,
  lightPosition,
  lightSchema,
  lightingPresets,
  resolveLighting,
} from './lighting'
import { filmNames, lightingNames, paperConfigSchema } from '../config/schema'
import { diffConfig } from '../config/diff'
import { buildAgentPayload } from '../config/agent-payload'

describe('lighting presets', () => {
  it('every schema name has a preset definition', () => {
    for (const name of lightingNames) {
      const preset = getLightingPreset(name)
      expect(preset.id).toBe(name)
      expect(preset.key.intensity).toBeGreaterThan(0)
      expect(preset.contactShadowOpacity).toBeGreaterThan(0)
    }
  })

  it('window and leaves carry gobos; noir is the hard single key', () => {
    expect(lightingPresets.window.gobo?.kind).toBe('blinds')
    expect(lightingPresets.leaves.gobo?.kind).toBe('leaves')
    expect(lightingPresets.leaves.gobo!.drift).toBeGreaterThan(0)
    expect(lightingPresets.noir.gobo).toBeUndefined()
    expect(lightingPresets.noir.ambient).toBeLessThan(0.1)
    expect(lightingPresets.noir.shadow.radius).toBeLessThanOrEqual(1)
    expect(lightingPresets.goldenhour.exposure).toBeGreaterThan(1)
  })

  it('nave is the backlit one: key behind, ambient near zero, and haze', () => {
    const nave = lightingPresets.nave
    // The default walk heads down -Z; a key light there is BEHIND the paper.
    expect(nave.key.position[2]).toBeLessThan(0)
    expect(nave.ambient).toBeLessThan(0.12)
    expect(nave.fog).toBeDefined()
    expect(nave.fog!.far).toBeGreaterThan(nave.fog!.near)
    // Every other preset lights paper from the front and needs no haze.
    expect(lightingPresets.studio.fog).toBeUndefined()
  })

  it('scene.lighting serializes, defaults to studio, and survives round-trip', () => {
    expect(paperConfigSchema.parse({}).scene.lighting).toBe('studio')
    const config = paperConfigSchema.parse({ scene: { lighting: 'goldenhour' } })
    expect(paperConfigSchema.parse(JSON.parse(JSON.stringify(config)))).toEqual(config)
  })

  it('diffConfig carries scene.lighting only when non-default, and the payload inlines it', () => {
    expect(diffConfig(paperConfigSchema.parse({}))).not.toHaveProperty('scene')
    const noir = paperConfigSchema.parse({ scene: { lighting: 'noir' } })
    expect(diffConfig(noir)).toMatchObject({ scene: { lighting: 'noir' } })
    expect(buildAgentPayload(noir)).toContain('"lighting": "noir"')
  })
})

describe('the film', () => {
  it('every preset names a film, and they all print on neutral', () => {
    for (const name of lightingNames) {
      const preset = getLightingPreset(name)
      expect(filmNames).toContain(preset.film)
      // Not a stylistic default, and measured rather than assumed: rendered
      // through all three on `nave`, `neutral` is the only one that keeps a
      // clipping warm source WARM. `agx` and `filmic` both bleach it toward
      // grey-white, which on a hall whose subject is light through paper is
      // the one thing that must not happen.
      expect(preset.film).toBe('neutral')
    }
  })

  it('film is an override like any other, and an unset one keeps the preset', () => {
    expect(resolveLighting('nave').film).toBe('neutral')
    expect(resolveLighting('nave', {}).film).toBe('neutral')
    expect(resolveLighting('nave', { film: 'filmic' }).film).toBe('filmic')
    // Overriding the film must not disturb the stop, and vice versa.
    expect(resolveLighting('nave', { film: 'filmic' }).exposure).toBe(lightingPresets.nave.exposure)
    expect(resolveLighting('nave', { exposure: 1.4 }).film).toBe('neutral')
  })

  it('film round-trips through the override schema and stays optional', () => {
    expect(lightSchema.parse({})).not.toHaveProperty('film')
    expect(lightSchema.parse({ film: 'agx' }).film).toBe('agx')
    expect(lightSchema.safeParse({ film: 'aces' }).success).toBe(false)
  })
})

describe('the two presets built for paper itself', () => {
  it('raking skims the surface: low, hard, and barely filled', () => {
    const raking = lightingPresets.raking
    // Eight degrees. The whole preset is that number — a key any higher
    // lands ON the sheet instead of skimming across it, and the relief goes.
    expect(lightAngles(raking.key.position).elevation).toBeLessThan(12)
    expect(lightAngles(raking.key.position).elevation).toBeGreaterThan(0)
    // Well off to one side, so the shadows run ACROSS the sheet.
    expect(Math.abs(lightAngles(raking.key.position).azimuth)).toBeGreaterThan(60)
    // Raking light works by the shadows it casts, and fill is the thing that
    // fills them in. Both fills stay below every front-lit preset's.
    expect(raking.ambient).toBeLessThan(lightingPresets.studio.ambient)
    expect(raking.studio).toBeLessThan(lightingPresets.studio.studio)
    // A hard source: the shadow edge is the subject.
    expect(raking.contactShadowBlur).toBeLessThan(lightingPresets.goldenhour.contactShadowBlur)
  })

  it('lightbox is backlit, strong, and printed a stop under', () => {
    const box = lightingPresets.lightbox
    // Behind the paper — which is what `translucencyValues` reads to decide
    // how much light comes THROUGH rather than off.
    expect(box.key.position[2]).toBeLessThan(0)
    expect(Math.abs(lightAngles(box.key.position).azimuth)).toBeCloseTo(180)
    // Level with the sheet, not above it: a lightbox is a panel, not a sun.
    expect(Math.abs(lightAngles(box.key.position).elevation)).toBeLessThan(15)
    expect(box.key.intensity).toBeGreaterThan(lightingPresets.studio.key.intensity)
    // Same lesson `nave` learned: a backlit sheet carries the lamp's whole
    // intensity as transmission and clips to white at 1.0.
    expect(box.exposure).toBeLessThan(1)
    // A sheet standing on a lit panel has almost nothing to cast onto.
    expect(box.contactShadowOpacity).toBeLessThan(lightingPresets.studio.contactShadowOpacity)
  })

  it('both are backlit-or-grazing, so neither is just another front key', () => {
    for (const name of ['raking', 'lightbox'] as const) {
      const angles = lightAngles(lightingPresets[name].key.position)
      // Every pre-existing front-lit preset stands well above the horizon.
      expect(angles.elevation).toBeLessThan(20)
    }
  })
})

describe('lighting as data', () => {
  it('every preset carries a room and a studio level for it', () => {
    for (const name of lightingNames) {
      const preset = getLightingPreset(name)
      expect(preset.studio).toBeGreaterThan(0)
      for (const band of [preset.sky.zenith, preset.sky.horizon, preset.sky.ground]) {
        expect(band).toMatch(/^#[0-9a-f]{6}$/i)
      }
    }
  })

  it('angles and position are inverses, so a slider drag cannot drift', () => {
    for (const name of lightingNames) {
      const position = getLightingPreset(name).key.position
      const back = lightPosition(lightAngles(position))
      for (const axis of [0, 1, 2] as const) expect(back[axis]).toBeCloseTo(position[axis], 6)
    }
  })

  it('reads the angles the way a person would say them', () => {
    // Straight in front, level with the paper.
    expect(lightAngles([0, 0, 5])).toMatchObject({ azimuth: 0, elevation: 0 })
    // Off to the right.
    expect(lightAngles([5, 0, 0]).azimuth).toBeCloseTo(90)
    // Straight overhead has no direction to give, and must not report one.
    expect(lightAngles([0, 4, 0])).toMatchObject({ azimuth: 0, elevation: 90 })
    // Nave: behind the walk and a little above it.
    const nave = lightAngles(getLightingPreset('nave').key.position)
    expect(Math.abs(nave.azimuth)).toBeCloseTo(180)
    expect(nave.elevation).toBeGreaterThan(15)
    expect(nave.elevation).toBeLessThan(30)
  })

  it('an empty override is the preset itself', () => {
    expect(resolveLighting('nave', {})).toEqual(getLightingPreset('nave'))
    expect(resolveLighting('nave')).toBe(getLightingPreset('nave'))
  })

  it('moves only what was set, and moves the lamp without changing its distance', () => {
    const nave = getLightingPreset('nave')
    const rig = resolveLighting('nave', { direction: 0 })
    expect(lightAngles(rig.key.position).azimuth).toBeCloseTo(0)
    // Height, colour, intensity and everything else stay the preset's.
    expect(lightAngles(rig.key.position).elevation).toBeCloseTo(lightAngles(nave.key.position).elevation)
    expect(lightAngles(rig.key.position).distance).toBeCloseTo(lightAngles(nave.key.position).distance)
    expect(rig.key.intensity).toBe(nave.key.intensity)
    expect(rig.key.color).toBe(nave.key.color)
    expect(rig.exposure).toBe(nave.exposure)
  })

  it("haze scales the preset's own depth cue, and clears the air at zero", () => {
    const nave = getLightingPreset('nave')
    expect(resolveLighting('nave', { haze: 2 }).fog).toMatchObject({
      near: nave.fog!.near / 2,
      far: nave.fog!.far / 2,
    })
    expect(resolveLighting('nave', { haze: 0 }).fog).toBeUndefined()
    // A preset with no haze to scale gains none.
    expect(resolveLighting('studio', { haze: 2 }).fog).toBeUndefined()
  })

  it('every override is optional, so a stage carries only what was moved', () => {
    expect(lightSchema.parse({})).toEqual({})
    expect(lightSchema.parse({ exposure: 1.4 })).toEqual({ exposure: 1.4 })
    expect(() => lightSchema.parse({ direction: 400 })).toThrow()
  })
})
