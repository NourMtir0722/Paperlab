import * as THREE from 'three'
import type { LightingName } from '../config/schema'
import { getLightingPreset } from '../scene/lighting'

/**
 * Light passing THROUGH the paper.
 *
 * Every reference image for stage mode is lit from behind: the paper is a
 * filter, not a surface catching a key light. That single change is what
 * separates "a render of some paper" from the look — and it is cheap,
 * because paper is thin and diffuse. No refraction, no transmission pass,
 * no `MeshPhysicalMaterial` (which does not instance): one dot product and
 * an additive emissive term, so it works identically in the instanced field
 * path and the hero path.
 *
 * The detail that sells it is the ink filter. What comes through a backlit
 * sheet is the lamp MINUS whatever is printed on it, which is why the
 * calligraphy on a lit banner reads dark against a glowing field instead of
 * blowing out with everything else.
 */

/** Declared by both stages of both pipelines. */
export const TRANSLUCENCY_VARYINGS = /* glsl */ `
varying vec3 vPlWorldNormal;
varying vec3 vPlViewDir;
`

export interface TranslucencyVertexSlots {
  /** Object → world matrix expression. Instanced meshes must fold in `instanceMatrix`. */
  model: string
  /** Final object-space position expression. */
  position: string
  /** Final object-space normal expression. */
  normal: string
}

/**
 * Vertex side: publish the world-space normal and view vector. Doing this in
 * the vertex shader (rather than reconstructing from `vNormal`) keeps the
 * chunk independent of where in three's fragment pipeline it gets injected.
 */
export function translucencyVertexChunk(slots: TranslucencyVertexSlots): string {
  return /* glsl */ `
  {
    mat4 plModel = ${slots.model};
    vec4 plWorld = plModel * vec4(${slots.position}, 1.0);
    // Uniform scale only — layouts scale sheets evenly, so the plain 3×3 is
    // the correct normal matrix here and skips an inverse-transpose.
    vPlWorldNormal = normalize(mat3(plModel) * ${slots.normal});
    vPlViewDir = cameraPosition - plWorld.xyz;
  }
`
}

/** How much of the incident key light a fully translucent sheet passes on. */
export const TRANSMISSION_GAIN = 0.5

/** Fragment side: uniforms plus `plTransmission(inkFilter)`. */
export const TRANSLUCENCY_FRAGMENT = /* glsl */ `
uniform float uTranslucency;
uniform vec3 uBackLightDir;
uniform vec3 uBackLightColor;
${TRANSLUCENCY_VARYINGS}

vec3 plTransmission(vec3 inkFilter) {
  if (uTranslucency <= 0.0) return vec3(0.0);
  vec3 n = normalize(vPlWorldNormal);
  // Sheets render double-sided; the back face needs the normal it actually shows.
  if (!gl_FrontFacing) n = -n;
  // The lamp is BEHIND this sheet when the face we are looking at points away
  // from it — that is the whole test.
  float behind = clamp(-dot(n, uBackLightDir), 0.0, 1.0);
  // A grazing view looks through more paper, and more paper passes less light.
  float thickness = abs(dot(n, normalize(vPlViewDir)));
  return uBackLightColor * uTranslucency * behind * mix(0.25, 1.0, thickness) * inkFilter;
}
`

export interface TranslucencyValues {
  translucency: number
  /** Unit world direction from the scene toward the key light. */
  direction: THREE.Vector3
  color: THREE.Color
}

/**
 * Resolve the transmission uniforms from the paper and the scene's lighting
 * preset — the key light's own position and color, so translucency can never
 * disagree with the lamp casting the shadows.
 */
export function translucencyValues(translucency: number, lighting: LightingName): TranslucencyValues {
  const preset = getLightingPreset(lighting)
  const [x, y, z] = preset.key.position
  const direction = new THREE.Vector3(x, y, z)
  // A key light at the origin has no direction to give; treat it as overhead.
  if (direction.lengthSq() < 1e-12) direction.set(0, 1, 0)
  direction.normalize()
  const color = new THREE.Color(preset.key.color).multiplyScalar(preset.key.intensity * TRANSMISSION_GAIN)
  return { translucency, direction, color }
}

/** Ready-to-bind uniform objects for a shader program. */
export function translucencyUniforms(
  translucency: number,
  lighting: LightingName,
): Record<string, { value: unknown }> {
  const values = translucencyValues(translucency, lighting)
  return {
    uTranslucency: { value: values.translucency },
    uBackLightDir: { value: values.direction },
    uBackLightColor: { value: values.color },
  }
}
