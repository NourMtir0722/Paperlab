import type { LightingName } from '../config/schema'

/**
 * Lighting presets: each is a key light + ambient level + contact shadow +
 * optional gobo (a texture the key light projects — window blinds, foliage).
 * Pure data here (testable in node); textures and R3F live in
 * PaperLighting.tsx. Serialized into presets as `scene.lighting`.
 */

export interface LightingPreset {
  id: LightingName
  label: string
  ambient: number
  key: { color: string; intensity: number; position: [number, number, number] }
  contactShadowOpacity: number
  /** Contact shadow blur — hard for noir, long and soft for golden hour. */
  contactShadowBlur: number
  /** Renderer tone-mapping exposure while active. */
  exposure: number
  shadow: { mapSize: number; radius: number }
  gobo?: { kind: 'blinds' | 'leaves'; drift: number; angle: number }
}

export const lightingPresets: Record<LightingName, LightingPreset> = {
  studio: {
    id: 'studio',
    label: 'Studio',
    ambient: 0.65,
    key: { color: '#ffffff', intensity: 1.6, position: [2.5, 4, 3] },
    contactShadowOpacity: 0.3,
    contactShadowBlur: 2.4,
    exposure: 1,
    shadow: { mapSize: 1024, radius: 4 },
  },
  window: {
    id: 'window',
    label: 'Window',
    ambient: 0.5,
    key: { color: '#ffe3c0', intensity: 1.9, position: [3, 2.6, 2.6] },
    contactShadowOpacity: 0.35,
    contactShadowBlur: 2.6,
    exposure: 1,
    shadow: { mapSize: 1024, radius: 5 },
    gobo: { kind: 'blinds', drift: 0.004, angle: 0.62 },
  },
  leaves: {
    id: 'leaves',
    label: 'Leaves',
    ambient: 0.45,
    key: { color: '#fff2d8', intensity: 2.0, position: [2.2, 3.6, 2.4] },
    contactShadowOpacity: 0.4,
    contactShadowBlur: 2.8,
    exposure: 1,
    shadow: { mapSize: 1024, radius: 6 },
    gobo: { kind: 'leaves', drift: 0.012, angle: 0.7 },
  },
  goldenhour: {
    id: 'goldenhour',
    label: 'Golden hour',
    ambient: 0.32,
    key: { color: '#ffb066', intensity: 2.4, position: [4, 0.9, 2.2] },
    contactShadowOpacity: 0.45,
    contactShadowBlur: 3.2,
    exposure: 1.15,
    shadow: { mapSize: 1024, radius: 7 },
  },
  noir: {
    id: 'noir',
    label: 'Noir',
    ambient: 0.07,
    key: { color: '#ffffff', intensity: 2.6, position: [2, 3, 1.6] },
    contactShadowOpacity: 0.7,
    contactShadowBlur: 1.1,
    exposure: 1.05,
    shadow: { mapSize: 2048, radius: 1 },
  },
}

export function getLightingPreset(name: LightingName): LightingPreset {
  return lightingPresets[name]
}
