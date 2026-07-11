import { describe, expect, it } from 'vitest'
import { getLightingPreset, lightingPresets } from './lighting'
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
