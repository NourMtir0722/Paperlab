import type { DeformerInstance, SheetDims } from '../deformers/types'
import { getDeformer } from '../deformers/registry'
import {
  TRANSLUCENCY_FRAGMENT,
  TRANSLUCENCY_VARYINGS,
  translucencyVertexChunk,
} from '../surface/translucency'

/**
 * Compose a deformer stack into GLSL — the GPU twin of deformers/compose.ts.
 * Each stack entry gets its own uniform namespace (`uRoll0_angle`,
 * `uFold1_offset`, …) so the same deformer type can appear twice
 * (letter-fold is two folds). Golden-vector parity with the JS path is
 * enforced by the GPU harness test.
 */

export interface ComposedDisplacement {
  /** Uniform declarations + displacement functions. */
  functionsSrc: string
  /** `vec3 plDisplace(vec3 p, vec2 uv, float t)` applying the whole stack. */
  displaceSrc: string
  /** Initial uniform values, keyed by their namespaced GLSL names (uSheet included). */
  uniforms: Record<string, number | number[]>
}

function glslType(value: number | number[]): string {
  if (typeof value === 'number') return 'float'
  return ['float', 'vec2', 'vec3', 'vec4'][value.length - 1]!
}

/**
 * Just the uniform VALUES for a stack (same namespaced keys as
 * buildDisplacementGLSL) — cheap enough to call every frame while a behavior
 * animates. Structure (names) is stable as long as the stack's type order is.
 */
export function stackUniformValues(
  stack: DeformerInstance[],
  sheet: SheetDims,
): Record<string, number | number[]> {
  const uniforms: Record<string, number | number[]> = { uSheet: [sheet.width, sheet.height] }
  stack.forEach((instance, i) => {
    if (instance.enabled === false) return
    const deformer = getDeformer(instance.type)
    if (!deformer.glsl) return
    const ns = `u${cap(instance.type)}${i}_`
    const values = deformer.glsl.uniforms(instance.options) as Record<string, number | number[]>
    for (const [key, value] of Object.entries(values)) uniforms[ns + key] = value
  })
  return uniforms
}

export function buildDisplacementGLSL(stack: DeformerInstance[], sheet: SheetDims): ComposedDisplacement {
  const decls: string[] = ['uniform vec2 uSheet;', 'float plBias = 1.0;']
  const functions: string[] = []
  const calls: string[] = []
  const uniforms: Record<string, number | number[]> = { uSheet: [sheet.width, sheet.height] }

  stack.forEach((instance, i) => {
    if (instance.enabled === false) return
    const deformer = getDeformer(instance.type)
    if (!deformer.glsl) {
      throw new Error(
        `[paperlab] Deformer "${instance.type}" has no GLSL implementation — it can't run in field mode.`,
      )
    }
    const ns = `u${cap(instance.type)}${i}_`
    const fn = `pl_${instance.type}${i}`
    const values = deformer.glsl.uniforms(instance.options) as Record<string, number | number[]>
    for (const [key, value] of Object.entries(values)) {
      decls.push(`uniform ${glslType(value)} ${ns}${key};`)
      uniforms[ns + key] = value
    }
    const strength = deformer.glsl.strength
    functions.push(
      deformer.glsl.chunk.replaceAll('FN', fn).replace(/U_(\w+)/g, (_, name: string) =>
        // The strength uniform reads through the per-instance bias, so one
        // instanced draw call can bend every sheet by a different amount.
        name === strength ? `(${ns}${name} * plBias)` : ns + name,
      ),
    )
    calls.push(`${fn}(q, uv, t);`)
  })

  const displaceSrc = /* glsl */ `
vec3 plDisplace(vec3 p, vec2 uv, float t, float bias) {
  plBias = bias;
  vec3 q = p;
  ${calls.join('\n  ')}
  return q;
}
`

  return { functionsSrc: `${decls.join('\n')}\n${functions.join('\n')}`, displaceSrc, uniforms }
}

/**
 * The field-mode CSM vertex shader: displaced position + numerically
 * recomputed normal (two tangent probes — exact normals of an arbitrary
 * stack have no closed form).
 */
export function buildFieldVertexShader(composed: ComposedDisplacement): string {
  return /* glsl */ `
uniform float uPlTime;
attribute float aPhase;
attribute float aAtlas;
attribute float aBias;
varying vec2 vPaperUv;
varying float vAtlas;
${TRANSLUCENCY_VARYINGS}
${composed.functionsSrc}
${composed.displaceSrc}
void main() {
  float t = uPlTime + aPhase;
  vec3 p = plDisplace(position, uv, t, aBias);
  vec2 step = uSheet * 0.01;
  vec3 px = plDisplace(position + vec3(step.x, 0.0, 0.0), uv + vec2(0.01, 0.0), t, aBias);
  vec3 py = plDisplace(position + vec3(0.0, step.y, 0.0), uv + vec2(0.0, 0.01), t, aBias);
  vec3 n = cross(px - p, py - p);
  csm_Normal = length(n) > 1e-12 ? normalize(n) : vec3(0.0, 0.0, 1.0);
  csm_Position = p;
${translucencyVertexChunk({ model: 'modelMatrix * instanceMatrix', position: 'p', normal: 'csm_Normal' })}
  vPaperUv = uv;
  vAtlas = aAtlas;
}
`
}

/**
 * Field fragment shader: per-instance tile from the shared content atlas on
 * the FRONT face; the BACK face renders the stock with an optional reversed
 * show-through ghost (per-paper back textures are a hero-mode feature).
 */
export function buildFieldFragmentShader(): string {
  return /* glsl */ `
uniform sampler2D uAtlas;
uniform vec2 uAtlasGrid;
uniform float uBackDarken;
uniform vec3 uStockColor;
uniform float uShowThrough;
varying vec2 vPaperUv;
varying float vAtlas;
${TRANSLUCENCY_FRAGMENT}
void main() {
  float col = mod(vAtlas, uAtlasGrid.x);
  float row = floor(vAtlas / uAtlasGrid.x);
  vec2 tiled = (vPaperUv + vec2(col, uAtlasGrid.y - 1.0 - row)) / uAtlasGrid;
  vec4 front = texture2D(uAtlas, tiled);
  if (gl_FrontFacing) {
    csm_DiffuseColor = front;
  } else {
    csm_DiffuseColor = vec4(uStockColor * mix(vec3(1.0), front.rgb, uShowThrough), 1.0);
    csm_DiffuseColor.rgb *= uBackDarken;
  }
  // Light coming through the sheet, filtered by what is printed on it. Same
  // ink either side — the light passes through the same fibres regardless of
  // which face happens to be turned toward the camera.
  csm_Emissive = plTransmission(front.rgb);
}
`
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/-(\w)/g, (_, c: string) => c.toUpperCase())
}
