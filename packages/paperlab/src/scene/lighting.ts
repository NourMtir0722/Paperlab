import { z } from 'zod'
import type { LightingName } from '../config/schema'

/**
 * Lighting presets: each is a key light + ambient level + contact shadow +
 * optional gobo (a texture the key light projects — window blinds, foliage).
 * Pure data here (testable in node); textures and R3F live in
 * PaperLighting.tsx. Serialized into presets as `scene.lighting`.
 *
 * A preset is the *starting point*, not the ceiling. `lightSchema` below is
 * the art-directable half: a handful of overrides that ride on top of a
 * named preset, so "nave, but the sun is lower and the room is dimmer" is a
 * thing you can say — and serialize — instead of a preset you have to fork.
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
  /**
   * Distance haze. Depth in a deep space is staged almost entirely by fog —
   * it is what turns a row of banners into a receding colonnade instead of
   * a flat row of rectangles.
   */
  fog?: { color: string; near: number; far: number }
  /**
   * The studio light: how strongly the room itself lights the paper.
   *
   * `<ambientLight>` adds brightness with no direction at all, which is the
   * single biggest reason a surface reads flat. This is the same brightness
   * with a SHAPE — an environment built from the sky below, so a sheet
   * turned toward the bright side of the room gets more light than one
   * turned away, and paper's sheen finally has something to reflect.
   */
  studio: number
  /**
   * The room, as three colours. It grades zenith → horizon → floor, carries
   * a soft disc of the key's own colour where the key stands, and becomes
   * both the environment map and (in stage mode) the cyclorama, so the
   * light and the space it is in cannot disagree.
   */
  sky: { zenith: string; horizon: string; ground: string }
}

export const lightingPresets: Record<LightingName, LightingPreset> = {
  studio: {
    id: 'studio',
    label: 'Studio',
    ambient: 0.28,
    key: { color: '#ffffff', intensity: 1.6, position: [2.5, 4, 3] },
    contactShadowOpacity: 0.3,
    contactShadowBlur: 2.4,
    exposure: 1,
    shadow: { mapSize: 1024, radius: 4 },
    studio: 0.9,
    sky: { zenith: '#f6f7f9', horizon: '#e2e2e4', ground: '#b4b1ad' },
  },
  window: {
    id: 'window',
    label: 'Window',
    ambient: 0.22,
    key: { color: '#ffe3c0', intensity: 1.9, position: [3, 2.6, 2.6] },
    contactShadowOpacity: 0.35,
    contactShadowBlur: 2.6,
    exposure: 1,
    shadow: { mapSize: 1024, radius: 5 },
    gobo: { kind: 'blinds', drift: 0.004, angle: 0.62 },
    studio: 0.8,
    sky: { zenith: '#cfd8e6', horizon: '#f4e6d2', ground: '#8e8478' },
  },
  leaves: {
    id: 'leaves',
    label: 'Leaves',
    ambient: 0.2,
    key: { color: '#fff2d8', intensity: 2.0, position: [2.2, 3.6, 2.4] },
    contactShadowOpacity: 0.4,
    contactShadowBlur: 2.8,
    exposure: 1,
    shadow: { mapSize: 1024, radius: 6 },
    gobo: { kind: 'leaves', drift: 0.012, angle: 0.7 },
    studio: 0.85,
    sky: { zenith: '#bcd3c4', horizon: '#eae2c6', ground: '#6f7a5e' },
  },
  goldenhour: {
    id: 'goldenhour',
    label: 'Golden hour',
    ambient: 0.14,
    key: { color: '#ffb066', intensity: 2.4, position: [4, 0.9, 2.2] },
    contactShadowOpacity: 0.45,
    contactShadowBlur: 3.2,
    exposure: 1.15,
    shadow: { mapSize: 1024, radius: 7 },
    studio: 0.7,
    sky: { zenith: '#5d6f96', horizon: '#ffbe86', ground: '#4a3a2e' },
  },
  noir: {
    id: 'noir',
    label: 'Noir',
    ambient: 0.04,
    key: { color: '#ffffff', intensity: 2.6, position: [2, 3, 1.6] },
    contactShadowOpacity: 0.7,
    contactShadowBlur: 1.1,
    exposure: 1.05,
    shadow: { mapSize: 2048, radius: 1 },
    studio: 0.16,
    sky: { zenith: '#0d0d10', horizon: '#26262c', ground: '#050506' },
  },
  nave: {
    id: 'nave',
    label: 'Nave',
    // Dim, and the key sits BEHIND the walk rather than beside it: this mode
    // is carried by light coming through the paper, not off it. Ambient is
    // nearly nothing so the only bright thing in frame is the source itself —
    // what fills the shadow side is the room, which has a direction.
    ambient: 0.03,
    key: { color: '#fff1dc', intensity: 2.8, position: [0, 7, -16] },
    contactShadowOpacity: 0.55,
    contactShadowBlur: 3.6,
    // Printed a stop under. A backlit sheet carries its lamp's whole
    // intensity as transmission, so at 1.0 every banner in the hall clipped
    // to flat white and the folds — the entire reason the paper is draped —
    // vanished into the highlight.
    exposure: 0.8,
    shadow: { mapSize: 2048, radius: 6 },
    // Warm and light, not black: distance in a backlit hall washes TOWARD
    // the source, which is what separates haze from murk. It has to reach
    // past the end of the walk: at `far: 38` the back half of a 36-unit
    // colonnade was uniform fog colour, so the depth cue flattened exactly
    // where depth was the picture.
    fog: { color: '#a08d72', near: 9, far: 70 },
    studio: 0.55,
    sky: { zenith: '#241c17', horizon: '#fff4e2', ground: '#0e0b09' },
  },
}

export function getLightingPreset(name: LightingName): LightingPreset {
  return lightingPresets[name]
}

// ── The authorable half ─────────────────────────────────────────────────────

/**
 * Overrides on top of a named preset — the Blender-panel half of lighting.
 *
 * Every field is optional ON PURPOSE. An unset field means "whatever the
 * preset says", so a shared link carries the two sliders you actually moved
 * rather than a frozen copy of a rig you never touched, and re-basing onto
 * another preset keeps your intent instead of your numbers.
 */
export const lightSchema = z.object({
  /** Tone-mapping exposure — the stop the whole picture is printed at. */
  exposure: z.number().min(0.1).max(4).optional(),
  /** Key light strength. */
  key: z.number().min(0).max(12).optional(),
  /** Key light colour. */
  color: z.string().optional(),
  /**
   * Where the key stands, degrees around the vertical. 0° is straight in
   * front of the paper (+Z, beside the camera), 90° is off to the right,
   * and ±180° is directly behind it — which is where `nave` puts it, and
   * why that preset is carried by light coming THROUGH the paper.
   */
  direction: z.number().min(-180).max(180).optional(),
  /** How high the key stands, degrees above the horizon. */
  height: z.number().min(-30).max(89).optional(),
  /** Flat fill from every direction at once. Cheap, and it kills form — reach for `studio` first. */
  ambient: z.number().min(0).max(2).optional(),
  /** The room's own light: an environment map built from `sky`. Directional fill, and the only thing paper's sheen has to reflect. */
  studio: z.number().min(0).max(3).optional(),
  /** Distance haze, as a multiple of the preset's. 0 clears the air entirely; 2 halves the distance you can see. */
  haze: z.number().min(0).max(3).optional(),
})

export type LightOverrides = z.infer<typeof lightSchema>
export type LightOverridesInput = z.input<typeof lightSchema>

/** Where a light stands, in the terms a person would say it in. */
export interface LightAngles {
  /** Degrees around the vertical: 0 = in front (+Z), 90 = right (+X), ±180 = behind. */
  azimuth: number
  /** Degrees above the horizon. */
  elevation: number
  /** Distance from the origin. Only the direction matters to a directional light; this keeps round-trips exact. */
  distance: number
}

const DEG = 180 / Math.PI

/**
 * Decompose a key light's position into the two angles the panel edits.
 *
 * A light at the origin has no direction to give, so it is reported as
 * straight overhead — the same fallback the transmission model makes, and
 * they have to agree.
 */
export function lightAngles(position: readonly [number, number, number]): LightAngles {
  const [x, y, z] = position
  const distance = Math.hypot(x, y, z)
  if (distance < 1e-9) return { azimuth: 0, elevation: 90, distance: 0 }
  const ground = Math.hypot(x, z)
  return {
    azimuth: ground < 1e-9 ? 0 : Math.atan2(x, z) * DEG,
    elevation: Math.atan2(y, ground) * DEG,
    distance,
  }
}

/** The inverse: put a light back where those angles say it stands. */
export function lightPosition(angles: LightAngles): [number, number, number] {
  const azimuth = angles.azimuth / DEG
  const elevation = angles.elevation / DEG
  const ground = Math.cos(elevation) * angles.distance
  return [Math.sin(azimuth) * ground, Math.sin(elevation) * angles.distance, Math.cos(azimuth) * ground]
}

/**
 * A preset with the overrides applied — the rig everything else reads.
 *
 * This is deliberately the ONLY way a light gets resolved. The transmission
 * uniforms, the shadow-casting lamp, the environment and the exposure all
 * come out of one object, because the bug this replaces was exactly that
 * disagreement: the banners computed their backlit glow from `studio` while
 * the hall was lit by `nave`, and a sheet lit from behind by a lamp that is
 * actually in front of it is not a subtle error.
 */
export function resolveLighting(
  base: LightingName | LightingPreset,
  overrides?: LightOverrides,
): LightingPreset {
  const preset = typeof base === 'string' ? getLightingPreset(base) : base
  if (!overrides) return preset

  const { exposure, key, color, direction, height, ambient, studio, haze } = overrides
  const moved = direction !== undefined || height !== undefined
  const angles = moved ? lightAngles(preset.key.position) : null

  return {
    ...preset,
    ambient: ambient ?? preset.ambient,
    studio: studio ?? preset.studio,
    exposure: exposure ?? preset.exposure,
    key: {
      color: color ?? preset.key.color,
      intensity: key ?? preset.key.intensity,
      position: angles
        ? lightPosition({
            azimuth: direction ?? angles.azimuth,
            elevation: height ?? angles.elevation,
            // A key that has been dragged onto the horizon still has to stand
            // somewhere, so a light collapsed to the origin gets a real
            // distance rather than staying at zero and losing its direction.
            distance: angles.distance || 10,
          })
        : preset.key.position,
    },
    fog: resolveFog(preset.fog, haze),
  }
}

/**
 * Haze as a multiplier on the preset's own depth cue, so one slider reads
 * "thicker air" rather than asking for two distances in world units. It
 * pulls both ends in together: at 2× you see half as far, and the wash
 * starts half as far out, which is what actual haze does.
 */
function resolveFog(fog: LightingPreset['fog'], haze: number | undefined): LightingPreset['fog'] {
  if (!fog || haze === undefined || haze === 1) return fog
  if (haze <= 0) return undefined
  return { color: fog.color, near: fog.near / haze, far: fog.far / haze }
}
