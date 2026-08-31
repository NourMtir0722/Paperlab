import * as THREE from 'three'
import {
  paperEdges as paperEdgesOrder,
  type LightingName,
  type PaperEdge,
  type SurfaceConfig,
} from '../config/schema'
import type { Stock } from '../core/stock'
import { resolveCreases, type CreaseShading } from './creases'
import type { LightingPreset } from '../scene/lighting'
import {
  TRANSLUCENCY_FRAGMENT,
  TRANSLUCENCY_VARYINGS,
  translucencyUniforms,
  translucencyVertexChunk,
} from './translucency'

/**
 * Surface effects are fragment-side chunks composed into ONE shader program
 * per effect set (grain + deckle + aging = one program). Uniforms are
 * namespaced per effect; shared helpers (noise) are included once.
 */

export interface ComposedSurface {
  /** Distinguishes shader *structures* — same key ⇒ same program, only uniforms change. */
  structureKey: string
  vertexShader: string
  fragmentShader: string
  uniforms: Record<string, { value: unknown }>
  /** Deckle discards via alphaTest (not blending) so shadows stay correct. */
  alphaTest: number
}

/** Which content textures exist — part of the shader structure. */
export interface SurfaceMaps {
  hasFrontMap: boolean
  hasBackMap: boolean
}

const VERTEX = /* glsl */ `
varying vec2 vPaperUv;
${TRANSLUCENCY_VARYINGS}
void main() {
  vPaperUv = uv;
${translucencyVertexChunk({ model: 'modelMatrix', position: 'position', normal: 'normal' })}
}
`

const HELPERS = /* glsl */ `
varying vec2 vPaperUv;
uniform float uBackDarken;

float plHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float plNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(plHash(i), plHash(i + vec2(1.0, 0.0)), u.x),
    mix(plHash(i + vec2(0.0, 1.0)), plHash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float plFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * plNoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}
`

const edgeFlags = (edges: PaperEdge[]): THREE.Vector4 =>
  new THREE.Vector4(
    edges.includes('top') ? 1 : 0,
    edges.includes('right') ? 1 : 0,
    edges.includes('bottom') ? 1 : 0,
    edges.includes('left') ? 1 : 0,
  )

const GRAIN_CHUNK = /* glsl */ `
uniform float uGrainAmount;
uniform float uGrainBanding;

void plGrain(inout vec4 color, inout float rough) {
  float fiber = plFbm(vPaperUv * 240.0);
  float fleck = plNoise(vPaperUv * 900.0);
  float g = mix(0.5, fiber * 0.75 + fleck * 0.25, uGrainAmount);
  color.rgb *= 0.92 + g * 0.16;
  rough = clamp(rough + (g - 0.5) * uGrainAmount * 0.35, 0.0, 1.0);
  // Thermal-printer banding: faint horizontal density stripes.
  if (uGrainBanding > 0.0) {
    float band = sin(vPaperUv.y * 700.0) * 0.5 + 0.5;
    color.rgb *= 1.0 - uGrainBanding * 0.05 * band;
  }
}
`

const DECKLE_CHUNK = /* glsl */ `
uniform vec4 uDeckleEdges; // top, right, bottom, left
uniform float uDeckleRoughness;

void plDeckle(inout vec4 color) {
  // Distance to each selected edge, gnawed by low-frequency noise.
  float depth = 0.012 + uDeckleRoughness * 0.05;
  float tear = 1.0;
  float fiberBand = 0.0;
  vec4 dists = vec4(1.0 - vPaperUv.y, 1.0 - vPaperUv.x, vPaperUv.y, vPaperUv.x);
  vec4 alongs = vec4(vPaperUv.x, vPaperUv.y, vPaperUv.x, vPaperUv.y);
  for (int e = 0; e < 4; e++) {
    if (uDeckleEdges[e] < 0.5) continue;
    float n = plFbm(vec2(alongs[e] * 26.0, float(e) * 7.31)) - 0.5;
    float boundary = depth * (0.55 + n * 1.6);
    float d = dists[e] - boundary;
    tear = min(tear, step(0.0, d));
    // Lightened fiber band just inside the tear.
    fiberBand = max(fiberBand, smoothstep(depth * 1.4, 0.0, d) * step(0.0, d));
  }
  color.a *= tear;
  color.rgb = mix(color.rgb, vec3(1.0), fiberBand * 0.35);
}
`

const CREASE_CHUNK = /* glsl */ `
uniform float uCreaseAngles[4];
uniform float uCreaseStrengths[4];
uniform float uCreasePositions[4];
uniform int uCreaseCount;

void plCrease(inout vec4 color, inout float rough) {
  for (int i = 0; i < 4; i++) {
    if (i >= uCreaseCount) break;
    // Per crease rather than once for the set: a remembered crease is placed
    // by the fold that made it, and a sheet folded twice was not necessarily
    // folded twice the same way. A map creased both directions has to draw
    // both, and the trig is four cosines on a shader that only runs at all
    // when the sheet has creases.
    vec2 dir = vec2(cos(uCreaseAngles[i]), sin(uCreaseAngles[i]));
    // Coordinate across this crease line (0..1 over the sheet).
    float t = dot(vPaperUv - 0.5, vec2(-dir.y, dir.x)) + 0.5;
    float strength = uCreaseStrengths[i];
    float d = abs(t - uCreasePositions[i]);
    float shadow = smoothstep(0.014, 0.0, d);
    float sheen = smoothstep(0.02, 0.006, d) - smoothstep(0.006, 0.0, d);
    color.rgb *= 1.0 - shadow * strength * 0.28;
    color.rgb += sheen * strength * 0.05;
    rough = clamp(rough + shadow * strength * 0.2, 0.0, 1.0);
  }
}
`

const PERFORATION_CHUNK = /* glsl */ `
uniform vec4 uPerfEdges;   // top, right, bottom, left enabled
uniform vec4 uPerfTorn;    // 1 = ripped-through profile, 0 = clean punches
uniform float uPerfRadius; // world units
uniform float uPerfSpacing;
uniform vec2 uSheetSize;

void plPerforation(inout vec4 color) {
  // Per-edge distance/along coordinates, converted from UV to world units so
  // hole size is stable across sheet dimensions.
  vec4 dists = vec4(1.0 - vPaperUv.y, 1.0 - vPaperUv.x, vPaperUv.y, vPaperUv.x);
  vec4 alongs = vec4(vPaperUv.x, vPaperUv.y, vPaperUv.x, vPaperUv.y);
  vec4 distScale = vec4(uSheetSize.y, uSheetSize.x, uSheetSize.y, uSheetSize.x);
  vec4 alongScale = vec4(uSheetSize.x, uSheetSize.y, uSheetSize.x, uSheetSize.y);
  float fiber = 0.0;
  for (int e = 0; e < 4; e++) {
    if (uPerfEdges[e] < 0.5) continue;
    float d = dists[e] * distScale[e];
    float a = alongs[e] * alongScale[e];
    // Signed distance along the edge to the nearest hole center.
    float cell = mod(a + uPerfSpacing * 0.5, uPerfSpacing) - uPerfSpacing * 0.5;
    if (uPerfTorn[e] < 0.5) {
      // Intact: clean semicircular punches on the edge line (alphaTest, not
      // blending — shadow correctness).
      if (length(vec2(cell, d)) < uPerfRadius) color.a = 0.0;
    } else {
      // Torn: ripped profile following the hole rhythm — alternating tabs and
      // notches, gnawed by noise, with a lightened fiber band along the tear.
      float rhythm = abs(sin(a / uPerfSpacing * 3.14159265));
      float n = plNoise(vec2(a * 40.0, float(e) * 7.31)) - 0.5;
      float cut = uPerfRadius * (0.35 + rhythm * 1.35 + n * 0.9);
      if (d < cut) color.a = 0.0;
      fiber = max(fiber, smoothstep(uPerfRadius * 2.4, 0.0, d - cut) * step(cut, d));
    }
  }
  color.rgb = mix(color.rgb, vec3(1.0), fiber * 0.4);
}
`

const AGING_CHUNK = /* glsl */ `
uniform float uAgingAmount;

void plAging(inout vec4 color) {
  // Yellowing deepens toward the edges, like light exposure.
  float edge = max(abs(vPaperUv.x - 0.5), abs(vPaperUv.y - 0.5)) * 2.0;
  vec3 yellowed = color.rgb * vec3(1.0, 0.94, 0.78);
  color.rgb = mix(color.rgb, yellowed, uAgingAmount * (0.45 + edge * 0.55));
  // Foxing: sparse rusty blotches.
  float fox = plFbm(vPaperUv * 14.0 + 3.7);
  float spots = smoothstep(0.62, 0.78, fox) * uAgingAmount;
  color.rgb = mix(color.rgb, vec3(0.62, 0.45, 0.26), spots * 0.5);
}
`

/**
 * Compose the enabled effects into one program. The shader owns the base
 * color entirely: the FRONT face samples the content texture, the BACK face
 * renders the stock (or content.back) with an optional reversed show-through
 * ghost — a single DoubleSide map would mirror the front content onto the
 * back, which real paper doesn't do.
 */
export function composeSurface(
  surface: SurfaceConfig,
  stock: Stock,
  thickness: number,
  maps: SurfaceMaps = { hasFrontMap: false, hasBackMap: false },
  /** World dims — perforation holes are sized in world units. */
  sheet: { width: number; height: number } = { width: 1, height: 1.4 },
  /** Whose key light transmission is measured against — a preset name or the scene's resolved rig. */
  lighting: LightingName | LightingPreset = 'studio',
  /**
   * The crease lines to draw, already resolved. Authored `surface.creaseLines`
   * and the sheet's remembered creases both arrive here as the same thing —
   * see `resolveCreases`, which is the only place that knows they came from
   * two different questions.
   */
  creases: CreaseShading[] = resolveCreases(surface, [], sheet),
): ComposedSurface {
  const grain = surface.grain ?? stock.defaultSurface.grain
  const aging = surface.aging ?? stock.defaultSurface.aging
  const deckle = surface.deckle
  const perforation = surface.perforation
  const banding = stock.banding
  // Adhesive undersides are opaque backing-paper white — nothing shows through.
  const showThrough = stock.adhesive ? 0 : (surface.showThrough ?? stock.showThrough)

  const chunks: string[] = []
  const calls: string[] = []
  const uniforms: Record<string, { value: unknown }> = {
    // Backside darkening: thicker/opaque stock lets less light through.
    // Adhesive backs skip it — the glue layer is its own bright surface.
    uBackDarken: {
      value: stock.adhesive ? 1 : 1 - Math.min(0.45, 0.12 + thickness * 0.9) * stock.opacity,
    },
    uStockColor: { value: new THREE.Color(stock.color) },
    uOpacity: { value: stock.opacity },
    uShowThrough: { value: showThrough },
    // Always compiled in: the shader early-outs at zero translucency, which
    // is cheaper than carrying a second program structure for it.
    ...translucencyUniforms(surface.translucency ?? stock.translucency, lighting),
  }
  if (maps.hasFrontMap) uniforms.uFrontMap = { value: null }
  if (maps.hasBackMap) uniforms.uBackMap = { value: null }

  if (grain !== undefined || banding > 0) {
    chunks.push(GRAIN_CHUNK)
    calls.push('plGrain(csm_DiffuseColor, csm_Roughness);')
    uniforms.uGrainAmount = { value: grain ?? 0 }
    uniforms.uGrainBanding = { value: banding }
  }
  if (deckle) {
    chunks.push(DECKLE_CHUNK)
    calls.push('plDeckle(csm_DiffuseColor);')
    uniforms.uDeckleEdges = { value: edgeFlags(deckle.edges) }
    uniforms.uDeckleRoughness = { value: deckle.roughness }
  }
  if (perforation) {
    const edges = perforation.edges === 'all' ? [...paperEdgesOrder] : perforation.edges
    chunks.push(PERFORATION_CHUNK)
    calls.push('plPerforation(csm_DiffuseColor);')
    uniforms.uPerfEdges = { value: edgeFlags(edges) }
    uniforms.uPerfTorn = {
      value: new THREE.Vector4(
        ...paperEdgesOrder.map((e) => (edges.includes(e) && perforation.state[e] === 'torn' ? 1 : 0)),
      ),
    }
    uniforms.uPerfRadius = { value: perforation.holeRadius }
    uniforms.uPerfSpacing = { value: perforation.spacing }
    uniforms.uSheetSize = { value: new THREE.Vector2(sheet.width, sheet.height) }
  }
  if (creases.length > 0) {
    chunks.push(CREASE_CHUNK)
    calls.push('plCrease(csm_DiffuseColor, csm_Roughness);')
    uniforms.uCreaseAngles = { value: pad(creases.map((c) => (c.angle * Math.PI) / 180)) }
    uniforms.uCreaseStrengths = { value: pad(creases.map((c) => c.strength)) }
    uniforms.uCreasePositions = {
      value: pad(
        creases.map((c) => c.position),
        -1,
      ),
    }
    uniforms.uCreaseCount = { value: Math.min(creases.length, 4) }
  }
  if (aging !== undefined) {
    chunks.push(AGING_CHUNK)
    calls.push('plAging(csm_DiffuseColor);')
    uniforms.uAgingAmount = { value: aging }
  }

  const frontExpr = maps.hasFrontMap ? 'texture2D(uFrontMap, vPaperUv).rgb' : 'uStockColor'
  // The back reads correctly when the sheet is flipped → mirror x. Adhesive
  // undersides (sticker stock) are glossy near-white regardless of the front.
  const backBaseExpr = stock.adhesive
    ? 'vec3(0.965, 0.96, 0.945)'
    : maps.hasBackMap
      ? 'texture2D(uBackMap, vec2(1.0 - vPaperUv.x, vPaperUv.y)).rgb'
      : 'uStockColor'

  const fragmentShader = /* glsl */ `
${HELPERS}
uniform vec3 uStockColor;
uniform float uOpacity;
uniform float uShowThrough;
${maps.hasFrontMap ? 'uniform sampler2D uFrontMap;' : ''}
${maps.hasBackMap && !stock.adhesive ? 'uniform sampler2D uBackMap;' : ''}
${TRANSLUCENCY_FRAGMENT}
${chunks.join('\n')}
void main() {
  vec3 front = ${frontExpr};
  if (gl_FrontFacing) {
    csm_DiffuseColor = vec4(front, uOpacity);
  } else {
    vec3 backBase = ${backBaseExpr};
    csm_DiffuseColor = vec4(backBase * mix(vec3(1.0), front, uShowThrough), uOpacity);
  }
  ${calls.join('\n  ')}
  if (!gl_FrontFacing) csm_DiffuseColor.rgb *= uBackDarken;
  ${stock.adhesive ? '// Adhesive underside: higher specular than the printed face.\n  if (!gl_FrontFacing) csm_Roughness = 0.18;' : ''}
  // What the key light pushes through the sheet, filtered by the ink on it.
  csm_Emissive = plTransmission(front);
}
`

  return {
    structureKey: `${[
      grain !== undefined || banding > 0 ? 'g' : '',
      deckle ? 'd' : '',
      creases.length > 0 ? 'c' : '',
      aging !== undefined ? 'a' : '',
      perforation ? 'p' : '',
      stock.adhesive ? 'A' : '',
    ].join('')}:${maps.hasFrontMap ? 'F' : ''}${maps.hasBackMap ? 'B' : ''}`,
    vertexShader: VERTEX,
    fragmentShader,
    uniforms,
    alphaTest: deckle || perforation ? 0.5 : 0,
  }
}

function pad(values: number[], fill = 0): number[] {
  const out = values.slice(0, 4)
  while (out.length < 4) out.push(fill)
  return out
}
