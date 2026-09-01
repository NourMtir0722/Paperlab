import * as THREE from 'three'
import {
  paperEdges as paperEdgesOrder,
  type LightingName,
  type PaperEdge,
  type SurfaceConfig,
} from '../config/schema'
import type { Stock } from '../core/stock'
import { CREASE_RADIUS } from '../deformers/memory'
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

/**
 * The shaded crease's width, as a fraction of the hinge the geometry bends
 * over.
 *
 * These are two halves of one crease and they are not the same width. The
 * fold deformer rounds a remembered crease over CREASE_RADIUS of
 * world, which is as sharp as a uniform grid can be asked to be; a real crease
 * is a burnished line an order of magnitude finer than that, and the only
 * place it can live is in the normal. So the shading draws the fine line
 * INSIDE the geometric hinge and the two add up.
 *
 * Derived from the deformer's own constant rather than typed out, because the
 * failure it prevents is silent: the shader used to carry its own widths in UV
 * fractions, which agreed with the geometry at exactly one sheet size and
 * drifted apart at every other — and drifted further every time two hands
 * resized the sheet.
 */
const SHADED_CREASE = 0.35

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
uniform vec2 uSheetSize;

/**
 * Where this fragment is on the sheet, in the sheet's OWN local space —
 * the same coordinates the deformers displace, centred on the sheet.
 *
 * Every effect below measures in these rather than in UV, and the difference
 * is not cosmetic. UV divides the sheet's aspect out, so a 1.2 x 1.5 sheet is
 * a unit square as far as the shader is concerned: fibre drawn round comes out
 * stretched, a tear bites deeper into the short edge than the long one, and a
 * crease line scored at 45 degrees renders at 51. Worse, all three change when
 * the sheet is RESIZED, which makes the paper's own material a function of how
 * big the piece is. Grain is a property of the stock and a crease is a broken
 * fibre; neither knows how large a sheet it was cut from.
 */
vec2 plLocal() {
  return (vPaperUv - 0.5) * uSheetSize;
}

/**
 * The paper's relief, in world units above the sheet the mesh describes.
 *
 * Accumulated by whichever effects have a shape as well as a colour, and
 * spent once at the end of main by {@link plPerturb}. One shared field rather
 * than a perturbation per effect, because two effects that both tilt the
 * surface tilt it TOGETHER — a crease across a grained sheet is one surface,
 * not a crease lit on top of a grain lit on top of the paper.
 */
float plHeight;

/**
 * The relief, turned into the normal the lighting actually runs on.
 *
 * This is the change that makes the surface effects respond to light at all.
 * They used to be painted: a crease multiplied a grey band into the albedo
 * and added a fixed white sheen beside it, so the mark looked identical from
 * every angle and under every rig, and turning the sheet under the key light
 * did nothing to it. Real creased paper is two facets meeting at a line —
 * swing it and the crease flips from a dark line to a bright one. Only a
 * normal can do that, so now the effects describe a HEIGHT and the standard
 * material lights it.
 *
 * The maths is Mikkelsen's surface-gradient bump, which is what three's own
 * perturbNormalArb implements, with one deliberate difference: three
 * normalises the screen-space position derivatives, which makes a bump map
 * look the same at any scale and is the right call for a texture. Ours is a
 * real depth in world units — a crease is as deep as it is however close you
 * stand — so the raw derivatives stay, and the ratio between them and the
 * height's is a true surface slope.
 *
 * Analytic height plus screen derivatives also anti-aliases itself for free:
 * as a crease shrinks below a pixel the derivative flattens and the mark
 * fades, rather than crawling.
 */
vec3 plPerturb(vec3 n, float height) {
  vec2 dH = vec2(dFdx(height), dFdy(height));
  if (dH.x == 0.0 && dH.y == 0.0) return n;
  // View-space position: the varying is its negation, by three's convention.
  vec3 sigmaX = dFdx(-vViewPosition);
  vec3 sigmaY = dFdy(-vViewPosition);
  vec3 r1 = cross(sigmaY, n);
  vec3 r2 = cross(n, sigmaX);
  float det = dot(sigmaX, r1) * (gl_FrontFacing ? 1.0 : -1.0);
  if (abs(det) < 1e-12) return n;
  vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
  return normalize(abs(det) * n - grad);
}

/**
 * A gaussian bell of unit width, pre-filtered against this fragment's own
 * footprint.
 *
 * Convolving a gaussian with the pixel broadens it and flattens it by the
 * same factor, which conserves the integral: a crease seen from across the
 * room dims instead of breaking into a dotted line. s is the distance
 * across the feature in units of its own width, so a caller only ever has to
 * decide how wide the thing is.
 */
float plBell(float s) {
  float px = fwidth(s);
  float widen = sqrt(1.0 + px * px);
  return exp(-(s * s) / (widen * widen)) / widen;
}

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

/**
 * Fibre density, per world unit.
 *
 * Per WORLD UNIT and not per UV, which is the whole fix: the fibre in a sheet
 * is the stock's, and it does not get coarser because someone cut a bigger
 * piece or stretch oval because the piece is taller than it is wide.
 *
 * The number is carried over from when it was a UV frequency, so a sheet one
 * world unit wide is unchanged across its width. Its height is not, and that
 * is the point: a 1.4-tall sheet used to fit the same 240 cycles into a
 * longer span and its fibre ran visibly coarser the other way.
 */
const float PL_FIBRE = 240.0;

/**
 * The coarser structure underneath it — paper's tooth, the part that has a
 * SHAPE and not just a colour.
 *
 * Separate from the fibre, and much lower, for a reason worth writing down:
 * the relief is differentiated in screen space, and a field at the fibre's own
 * frequency is a few pixels per cycle at any sane viewing distance, so its
 * derivative is noise and the sheet would sparkle. The tooth is safely above
 * the sampling rate, and it is the scale at which paper actually catches a
 * raking light anyway.
 */
const float PL_TOOTH = 70.0;

/**
 * How far the tooth stands proud, in world units, at full grain.
 *
 * Real paper's surface relief is tens of microns. Against a sheet whose width
 * is one world unit — call it A4 — 0.00035 is about 70 microns, and at the
 * tooth's wavelength that is a surface tilting by four degrees or so. Enough
 * to break a specular highlight into paper, not enough to look pebbled.
 */
const float PL_TOOTH_RELIEF = 0.00035;

void plGrain(inout vec4 color, inout float rough) {
  vec2 local = plLocal();
  float fiber = plFbm(local * PL_FIBRE);
  float fleck = plNoise(local * (PL_FIBRE * 3.75));
  float g = mix(0.5, fiber * 0.75 + fleck * 0.25, uGrainAmount);
  color.rgb *= 0.92 + g * 0.16;
  rough = clamp(rough + (g - 0.5) * uGrainAmount * 0.35, 0.0, 1.0);
  // The tooth, handed to the lighting rather than drawn. A single octave: the
  // relief only needs the scale the eye reads as texture, and the fbm above
  // is already carrying everything finer as colour.
  plHeight += (plNoise(local * PL_TOOTH) - 0.5) * PL_TOOTH_RELIEF * uGrainAmount;
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

/** Gnaw frequency along a torn edge, per world unit — see {@link plLocal}. */
const float PL_DECKLE_GNAW = 26.0;

void plDeckle(inout vec4 color) {
  // Distance to each selected edge, gnawed by low-frequency noise.
  //
  // The depth is in world units, taken against the sheet's mean dimension.
  // Against the MEAN rather than each edge's own span, which is what UV
  // amounted to: one roughness used to bite a third deeper into the short
  // edges of a 1 x 1.4 sheet than the long ones, for no reason anybody chose.
  //
  // Still proportional to the sheet rather than absolute, which is a decision
  // and not an oversight. A real deckle is a fibre length and would be the
  // same depth on any size of sheet; roughness is a 0..1 knob someone types,
  // and an absolute one would vanish on a poster and swallow a stamp.
  float depth = (0.012 + uDeckleRoughness * 0.05) * (uSheetSize.x + uSheetSize.y) * 0.5;
  float tear = 1.0;
  float fiberBand = 0.0;
  vec4 dists = vec4(1.0 - vPaperUv.y, 1.0 - vPaperUv.x, vPaperUv.y, vPaperUv.x);
  vec4 alongs = vec4(vPaperUv.x, vPaperUv.y, vPaperUv.x, vPaperUv.y);
  vec4 distScale = vec4(uSheetSize.y, uSheetSize.x, uSheetSize.y, uSheetSize.x);
  vec4 alongScale = vec4(uSheetSize.x, uSheetSize.y, uSheetSize.x, uSheetSize.y);
  for (int e = 0; e < 4; e++) {
    if (uDeckleEdges[e] < 0.5) continue;
    float n = plFbm(vec2(alongs[e] * alongScale[e] * PL_DECKLE_GNAW, float(e) * 7.31)) - 0.5;
    float boundary = depth * (0.55 + n * 1.6);
    float d = dists[e] * distScale[e] - boundary;
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
uniform float uCreaseOffsets[4];
uniform float uCreaseWidth;
uniform int uCreaseCount;

/**
 * Peak tilt of a crease's own facets, as a slope.
 *
 * A gaussian groove of amplitude A and width w reaches a maximum slope of
 * about 0.86 A/w, so an amplitude of 0.55 w peaks near 25 degrees — steep
 * enough that turning the sheet visibly flips the line from dark to bright,
 * shallow enough that it never reads as a fold in its own right. Held as a
 * SLOPE rather than a depth because that is the quantity the lighting
 * responds to, and the only one that stays honest when the width changes.
 */
const float PL_CREASE_TILT = 0.55;

/** How much grime a crease traps, at full strength. */
const float PL_CREASE_SOIL = 0.1;

void plCrease(inout vec4 color, inout float rough) {
  vec2 p = plLocal();
  for (int i = 0; i < 4; i++) {
    if (i >= uCreaseCount) break;
    vec2 dir = vec2(cos(uCreaseAngles[i]), sin(uCreaseAngles[i]));
    // The identical measurement the fold deformer displaces by: signed
    // distance across the line, in the sheet's own space. Shading and
    // geometry cannot place a crease differently when the number they place
    // it by is the same number.
    float s = (dot(p, dir) - uCreaseOffsets[i]) / uCreaseWidth;
    float strength = uCreaseStrengths[i];
    float bell = plBell(s);

    // The relief. This is the fine burnished line where the fibres broke, and
    // it is deliberately narrower than the hinge the fold deformer bends
    // over: the mesh carries the wide bend, the shader carries the crease
    // inside it, and the two add up instead of competing. Signed, so a
    // mountain stands proud and a valley cuts in — the same crease read from
    // the other side of the sheet is the other one.
    plHeight += strength * uCreaseWidth * PL_CREASE_TILT * bell;

    // What is left for the albedo once the lighting is doing the work: a
    // crease collects dirt and its broken fibres scatter wider. The grey band
    // and the painted-on sheen that used to live here were standing in for a
    // normal, and there is one now.
    float mark = bell * abs(strength);
    color.rgb *= 1.0 - mark * PL_CREASE_SOIL;
    rough = clamp(rough + mark * 0.3, 0.0, 1.0);
  }
}
`

const PERFORATION_CHUNK = /* glsl */ `
uniform vec4 uPerfEdges;   // top, right, bottom, left enabled
uniform vec4 uPerfTorn;    // 1 = ripped-through profile, 0 = clean punches
uniform float uPerfRadius; // world units
uniform float uPerfSpacing;

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
    // Always present, not just when something asks for it: every effect that
    // measures anything measures in the sheet's own space now — see plLocal.
    uSheetSize: { value: new THREE.Vector2(sheet.width, sheet.height) },
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
  }
  if (creases.length > 0) {
    chunks.push(CREASE_CHUNK)
    calls.push('plCrease(csm_DiffuseColor, csm_Roughness);')
    uniforms.uCreaseAngles = { value: pad(creases.map((c) => (c.angle * Math.PI) / 180)) }
    uniforms.uCreaseStrengths = { value: pad(creases.map((c) => c.strength)) }
    uniforms.uCreaseOffsets = { value: pad(creases.map((c) => c.offset)) }
    uniforms.uCreaseWidth = { value: CREASE_RADIUS * SHADED_CREASE }
    uniforms.uCreaseCount = { value: Math.min(creases.length, 4) }
  }
  if (aging !== undefined) {
    chunks.push(AGING_CHUNK)
    calls.push('plAging(csm_DiffuseColor);')
    uniforms.uAgingAmount = { value: aging }
  }

  // Whether anything above described a SHAPE and not just a colour. The
  // perturbation is one pair of screen derivatives, which is cheap but not
  // free, and a plain sheet has nothing for it to do.
  const relief = grain !== undefined || creases.length > 0

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
  plHeight = 0.0;
  vec3 front = ${frontExpr};
  if (gl_FrontFacing) {
    csm_DiffuseColor = vec4(front, uOpacity);
  } else {
    vec3 backBase = ${backBaseExpr};
    csm_DiffuseColor = vec4(backBase * mix(vec3(1.0), front, uShowThrough), uOpacity);
  }
  ${calls.join('\n  ')}
${relief ? '  // The relief every effect above described, spent once — see plPerturb.\n  csm_FragNormal = plPerturb(csm_FragNormal, plHeight);' : ''}
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
