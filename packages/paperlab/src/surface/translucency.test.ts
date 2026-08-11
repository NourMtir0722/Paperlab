import { describe, expect, it } from 'vitest'
import {
  TRANSLUCENCY_FRAGMENT,
  TRANSMISSION_GAIN,
  translucencyUniforms,
  translucencyValues,
  translucencyVertexChunk,
} from './translucency'
import { getLightingPreset, lightingPresets } from '../scene/lighting'
import { stocks } from '../core/stock'
import { lightingNames, paperConfigSchema, surfaceSchema } from '../config/schema'
import { buildDisplacementGLSL, buildFieldFragmentShader, buildFieldVertexShader } from '../field/compose'
import { getDeformer } from '../deformers/registry'

describe('translucency values', () => {
  it('aims at the scene key light, normalized', () => {
    const { direction } = translucencyValues(0.5, 'studio')
    expect(direction.length()).toBeCloseTo(1, 6)
    const key = getLightingPreset('studio').key.position
    expect(direction.x / direction.z).toBeCloseTo(key[0] / key[2], 5)
  })

  it('nave puts its key light BEHIND the walk — the whole point of the mode', () => {
    // The default walk heads down -Z, so a backlight has to sit at -Z too.
    expect(getLightingPreset('nave').key.position[2]).toBeLessThan(0)
    expect(translucencyValues(1, 'nave').direction.z).toBeLessThan(0)
    // Dim room, bright source: nothing else in frame competes with it.
    expect(lightingPresets.nave.ambient).toBeLessThan(0.12)
    expect(lightingPresets.nave.key.intensity).toBeGreaterThan(3)
  })

  it('transmitted color scales with the lamp it comes from', () => {
    const preset = getLightingPreset('noir')
    const { color } = translucencyValues(1, 'noir')
    // White key, so every channel lands on intensity × gain.
    expect(color.r).toBeCloseTo(preset.key.intensity * TRANSMISSION_GAIN, 5)
  })

  it('a key light at the origin still yields a direction', () => {
    const original = lightingPresets.studio.key.position
    lightingPresets.studio.key.position = [0, 0, 0]
    try {
      const { direction } = translucencyValues(1, 'studio')
      expect(direction.length()).toBeCloseTo(1, 6)
      expect(direction.y).toBeCloseTo(1, 6)
    } finally {
      lightingPresets.studio.key.position = original
    }
  })

  it('binds every uniform the program expects', () => {
    const uniforms = translucencyUniforms(0.4, 'nave')
    expect(Object.keys(uniforms).sort()).toEqual([
      'uAmbientTransmission',
      'uBackLightColor',
      'uBackLightDir',
      'uTranslucency',
    ])
    expect(uniforms.uTranslucency!.value).toBe(0.4)
  })

  it('paper edge-on to the only lamp still glows from the room', () => {
    // A banner facing across the aisle catches no diffuse and no directional
    // transmission; without an ambient floor it drops out of the picture.
    expect(translucencyValues(1, 'nave').ambient).toBeGreaterThan(0)
    expect(translucencyValues(1, 'studio').ambient).toBeGreaterThan(translucencyValues(1, 'nave').ambient)
  })
})

describe('translucency shader plumbing', () => {
  it('early-outs at zero so opaque stock costs nothing', () => {
    expect(TRANSLUCENCY_FRAGMENT).toContain('if (uTranslucency <= 0.0) return vec3(0.0);')
  })

  it('filters the transmitted light through the ink — the detail that sells it', () => {
    expect(TRANSLUCENCY_FRAGMENT).toContain('* inkFilter')
  })

  it('flips the normal on back faces, since sheets render double-sided', () => {
    expect(TRANSLUCENCY_FRAGMENT).toContain('if (!gl_FrontFacing) n = -n;')
  })

  it('folds the instance matrix in for the instanced field path', () => {
    const instanced = translucencyVertexChunk({
      model: 'modelMatrix * instanceMatrix',
      position: 'p',
      normal: 'csm_Normal',
    })
    expect(instanced).toContain('modelMatrix * instanceMatrix')
    expect(instanced).toContain('vPlWorldNormal')
    expect(instanced).toContain('vPlViewDir')
  })

  it('the field shaders declare the varyings they exchange', () => {
    const composed = buildDisplacementGLSL([{ type: 'wave', options: getDeformer('wave').defaults }], {
      width: 1,
      height: 3,
    })
    const vertex = buildFieldVertexShader(composed)
    const fragment = buildFieldFragmentShader()
    for (const varying of ['vPlWorldNormal', 'vPlViewDir']) {
      expect(vertex).toContain(varying)
      expect(fragment).toContain(varying)
    }
    // The transmitted term reaches the surface as emission, after the deform.
    expect(vertex.indexOf('csm_Normal =')).toBeLessThan(vertex.indexOf('vPlWorldNormal ='))
    expect(fragment).toContain('csm_Emissive = plTransmission(front.rgb);')
  })
})

describe('translucency as a paper property', () => {
  it('ranks the stocks the way a lightbox would', () => {
    expect(stocks.vellum.translucency).toBeGreaterThan(stocks.newsprint.translucency)
    expect(stocks.newsprint.translucency).toBeGreaterThan(stocks.printer.translucency)
    expect(stocks.printer.translucency).toBeGreaterThan(stocks['photo-gloss'].translucency)
  })

  it('is separate from opacity — newsprint is opaque to look at and still glows', () => {
    expect(stocks.newsprint.opacity).toBe(1)
    expect(stocks.newsprint.translucency).toBeGreaterThan(0.3)
  })

  it('surface config overrides the stock, and serializes', () => {
    expect(surfaceSchema.parse({}).translucency).toBeUndefined()
    const config = paperConfigSchema.parse({
      stock: 'kraft',
      surface: { translucency: 0.9 },
      scene: { lighting: 'nave' },
    })
    expect(config.surface.translucency).toBe(0.9)
    expect(paperConfigSchema.parse(JSON.parse(JSON.stringify(config)))).toEqual(config)
  })

  it('nave is a real lighting name the schema accepts', () => {
    expect(lightingNames).toContain('nave')
    expect(paperConfigSchema.parse({ scene: { lighting: 'nave' } }).scene.lighting).toBe('nave')
  })
})
