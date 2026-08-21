import { describe, expect, it } from 'vitest'
import {
  getLightingPreset,
  lightAngles,
  lightPosition,
  lightSchema,
  lightingPresets,
  resolveLighting,
} from './lighting'
import { lightingNames, paperConfigSchema } from '../config/schema'
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
