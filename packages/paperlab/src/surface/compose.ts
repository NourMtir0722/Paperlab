import { DAMAGE_LOOK_DEFAULTS } from './damageContract'
import { CUT_REACH_MM } from './cutDistance'
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
  /**
   * Anything that removes paper discards via alphaTest rather than blending.
   * That keeps the depth buffer right for the colour pass; it never made the
   * SHADOW right on its own — three's shadow material ignores alpha computed
   * in shader code. `depth`, below, is what does.
   */
  alphaTest: number
  /**
   * A depth-only program for the SHADOW MAP, or null when nothing on this
   * sheet removes paper and three's own depth material is already right.
   *
   * Shadow maps only. drei's `ContactShadows` renders the whole scene through
   * one override material and never reads a mesh's `customDepthMaterial`, so
   * the soft contact shadow under a `<Paper>` still ignores holes — that is a
   * separate pass and a separate fix.
   */
  depth: { vertexShader: string; fragmentShader: string } | null
}

/** Which content textures exist — part of the shader structure. */
export interface SurfaceMaps {
  hasFrontMap: boolean
  hasBackMap: boolean
  /**
   * A damage texture is attached — see `DamageSource`. Optional and false by
   * default, so a sheet nothing has damaged compiles exactly the program it
   * always did: same chunks, same structure key, same alpha test.
   */
  hasDamage?: boolean
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

/**
 * What happened to the paper, read from the damage texture — the part both
 * programs need: the fray and the cut.
 *
 * Written so that an untouched field is an exact identity — char 0, wet 0,
 * presence 1 multiplies by one and mixes by zero — because attaching a field
 * to a sheet before anything has burnt it must not change a single pixel.
 *
 * Presence is cut with `step`, not multiplied into alpha. Multiplying would
 * put the edge of a hole wherever `opacity × presence` crosses the alpha test,
 * which is presence 0.5 on an opaque stock and 0.81 on the 0.62-opacity one:
 * the same burn would eat further into some papers than others.
 *
 * Shared with the shadow pass, which is why it holds only what CUTS: the
 * depth program has no view position and no lighting, and a function in here
 * that reached for either would stop it compiling. What a burn looks like is
 * `DAMAGE_SHADE_CHUNK`, colour program only.
 */
const DAMAGE_CHUNK = /* glsl */ `
uniform sampler2D uDamage;
uniform float uDamageDetail;
// (edgeWave mm, edgeBite mm, sparkle, charWidth mm) — see DamageLook.
uniform vec4 uLook3;

// The damage grid's texels sit ON the sheet — texel x at u = x / (N - 1), its
// corners on the sheet's corners, which is how the field paints and how the
// physics reads it. A texture puts texel x at (x + 0.5) / N. Sampled straight,
// the picture of a burn sat up to half a texel off the burn the paper feels.
vec2 plDamageUv(vec2 uv) {
  vec2 n = vec2(textureSize(uDamage, 0));
  // Texel space, on the field's convention: texel x at u = x / (N - 1).
  vec2 t = uv * (n - 1.0) + 0.5;
  // Quintic-smoothed texel coordinates.
  //
  // Bilinear filtering is continuous but its DERIVATIVE is not: the blend
  // weight is a straight line inside each texel and turns a corner at every
  // boundary. Magnify a 64 grid to fill a macro crop — one cell is 4.9 mm of
  // A4, about 58 px there — and those corners fall on a 58 px lattice, so
  // every ramp drawn from this field can crease along it.
  //
  // Also tried against the contour rings, and also not their cause (that was
  // the scorch fingers). Kept because it costs nothing and the crease is
  // real:
  // Bending the fractional part through a quintic (6t^5 - 15t^4 + 10t^3,
  // whose first and second derivatives vanish at both ends) makes the
  // interpolation C2 without a single extra tap: the hardware still does one
  // bilinear fetch, it is just asked for a smoothed position. The sample at a
  // texel's centre is unchanged, so the half-texel alignment this function
  // exists for still holds — and a field nothing has happened to reads 1
  // everywhere whatever the position, so the untouched-sheet identity is
  // untouched too.
  vec2 i = floor(t - 0.5) + 0.5;
  vec2 f = t - i;
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return (i + f) / n;
}

/**
 * The four channels here, frayed finer than the grid.
 *
 * One cell of the field is ~3.3 mm of A4, and a burnt edge is jagged at the
 * scale of a fibre (0.3–2 mm) — so the grid decides roughly WHERE and this
 * decides exactly where. Stretched along the fibre (the field's default grain
 * runs along u), so a tear follows the grain. Scaled by what is already
 * there, so pristine paper (char 0, presence 1) is untouched to the bit, and
 * skipped outright at detail 0: the zones still draw on every tier, only
 * without the finest octaves.
 */
/**
 * Where on the grid this fragment reads its damage — warped.
 *
 * A burnt hole is never a circle: paper burns unevenly, and its edge wobbles
 * in long waves with small bites in and out. The field is too coarse to hold
 * that, so the READ is displaced instead: two octaves of noise in the sheet's
 * own space, a long wave of up to ±6 mm and short bites of ±2 mm. Every zone —
 * the cut, the lip, the ember line, the char, the scorch — reads through the
 * same warp, so they all follow one uneven edge. Warping a field nothing has
 * happened to reads the same untouched value everywhere, so the identity
 * holds.
 */
vec2 plDamageWarpAt(vec2 paperUv) {
  vec2 p = (paperUv - 0.5) * uSheetSize;
  const float mm = 1.0 / 210.0;
  vec2 wave = vec2(plFbm(p * 26.0 + 3.1), plFbm(p * 26.0 + 17.7)) - 0.5;
  vec2 bite = vec2(plNoise(p * 95.0 + 5.3), plNoise(p * 95.0 + 41.9)) - 0.5;
  vec2 shift = (wave * 2.0 * uLook3.x + bite * 2.0 * uLook3.y) * mm;
  return plDamageUv(paperUv + shift / uSheetSize);
}

vec2 plDamageWarp() {
  return plDamageWarpAt(vPaperUv);
}

/** Presence softened over five taps — see \`plDamageRead\`. */
float plSoftPresence(vec2 uv) {
  vec2 texel = 0.75 / vec2(textureSize(uDamage, 0));
  return (2.0 * texture2D(uDamage, uv).a
    + texture2D(uDamage, uv + vec2(texel.x, 0.0)).a + texture2D(uDamage, uv - vec2(texel.x, 0.0)).a
    + texture2D(uDamage, uv + vec2(0.0, texel.y)).a + texture2D(uDamage, uv - vec2(0.0, texel.y)).a) / 6.0;
}

/** The fray and the fibre at a point of the sheet (local units), scaled by detail. */
vec2 plFray(vec2 p) {
  return vec2(
    (plFbm(vec2(p.x * 22.0, p.y * 48.0)) - 0.47) * uDamageDetail,
    (plNoise(vec2(p.x * 140.0, p.y * 420.0)) - 0.5) * uDamageDetail
  );
}

/**
 * The presence the cut is drawn from, at any point of the paper: warped,
 * softened and frayed exactly as \`plDamageRead\` does it for this fragment.
 */
float plDrawnPresenceAt(vec2 paperUv) {
  float a = plSoftPresence(plDamageWarpAt(paperUv));
  if (uDamageDetail > 0.0) {
    vec2 ff = plFray((paperUv - 0.5) * uSheetSize);
    a = clamp(a + (ff.x * 0.36 + ff.y * 0.05) * (1.0 - smoothstep(0.9, 1.0, a)), 0.0, 1.0);
  }
  return a;
}

// The softened presence before the fray, from the last \`plDamageRead\`: what
// the distance to the cut takes its slope from (see \`plDamage\`).
float plDamageSmooth;

vec4 plDamageRead() {
  vec2 uv = plDamageWarp();
  vec4 d = texture2D(uDamage, uv);
  // The cut runs on a SOFTENED presence. Paper burns through within a single
  // texel now, so the raw field is hard-edged and its half-presence contour
  // is the grid's own staircase — the fray below can only move a line within
  // the band it is given, and a one-texel band is not enough to hide a grid.
  // Five taps round the contour; an untouched field is 1 everywhere and
  // stays exactly 1.
  d.a = plSoftPresence(uv);
  plDamageSmooth = d.a;
  if (uDamageDetail > 0.0) {
    vec2 ff = plFray(plLocal());
    float fray = ff.x;
    float fibre = ff.y;
    float edge = 1.0 - smoothstep(0.9, 1.0, d.a);
    d.r = clamp(d.r + fray * 0.3 * smoothstep(0.0, 0.15, d.r), 0.0, 1.0);
    d.a = clamp(d.a + (fray * 0.36 + fibre * 0.05) * edge, 0.0, 1.0);
  }
  return d;
}

void plDamageCut(inout vec4 color, vec4 d) {
  // Missing paper: gone at half presence, on every stock alike.
  color.a *= step(0.5, d.a);
}
`

/**
 * What a burn LOOKS like: the zones of `paperlab-fx-fire-spec.md` §5, drawn
 * per fragment from a grid that is coarser than every one of them.
 *
 * From the hole outward: void · ash lip · ember line · char · scorch · paper.
 * The field says roughly where each is — presence is where the paper ends,
 * char is how far burning has got — and this measures the rest in
 * MILLIMETRES from the cut, off the presence gradient, so a 1 mm ember line
 * is 1 mm at any zoom and on any size of sheet. A4 is one world unit across,
 * which is what `PL_MM` is.
 *
 * - **Scorch** is albedo only, multiplied in so the ink under it darkens with
 *   it, and PERMANENT: it reads char, which never recedes. A long slow ramp
 *   through the sampled browns, then a steep jump to clean paper in its last
 *   stretch — an even blur is half of what made the first version read as a
 *   gradient. It reaches further ABOVE the burn than below, because hot gas
 *   rises and cooks the paper over it (§4.5): world up is worked out here, in
 *   the sheet's own UV, from the surface's screen derivatives.
 * - **Char** is not black: near-black in a crack network of 1–4 mm cells, a
 *   dark grey body, a brown undertone toward the scorch, and plates tilted so
 *   a grazing light catches them. The ink under it is gone.
 * - **The ash lip** is pale, matte, lifted toward the viewer — it is what
 *   makes a hole read as a hole on a black stage, by catching light.
 * - **The ember line** is the only thing on the sheet that emits. It sits
 *   between the ash lip and the char, 0.3–1 mm wide, held crisp in screen
 *   space, broken into beads that flicker and crawl on the burn's own clock
 *   and cool down the blackbody ramp as the heat under them goes. Written to
 *   `plDamageLight` in HDR — past paper white, for `FxPost` to bloom — and
 *   added after transmission, which owns `csm_Emissive`.
 *
 * Heat paints nothing anywhere else. The wide glow this chunk once drew over
 * unburnt paper was the spec's first complaint: red added to white is pink.
 */
const DAMAGE_SHADE_CHUNK = /* glsl */ `
uniform float uDamageTime;
// How far each texel is from the cut, as a fraction of PL_CUT_REACH — see cutDistance.
uniform sampler2D uDamageEdge;
// The look, packed — see DamageLook for what each number means.
uniform vec4 uLook0; // emberWidth mm, emberIntensity, emberCoverage, emberFlicker
uniform vec4 uLook1; // emberGlow, lipWidth mm, lipBrightness, charWarmth
uniform vec4 uLook2; // charCracks, scorchReach mm, scorchDarkness, fingers
/** The light the burn gives off from the sheet itself: the ember line, and nothing else. */
vec3 plDamageLight;

// World units per millimetre: a default sheet is one unit across, and A4 is 210 mm.
const float PL_MM = 1.0 / 210.0;
// How far out a burnt edge's zones can be measured from the cut, mm: past
// the widest lip, ember line, char and scorch the look allows by default.
// The same number cutDistance encodes with, so the two cannot drift.
const float PL_CUT_REACH = ${CUT_REACH_MM.toFixed(1)};

vec3 plLinear(vec3 srgb) {
  return pow(srgb, vec3(2.2));
}

/**
 * World up, as a direction in the sheet's UV, from how this fragment's UV and
 * view position change across the screen. Must be called in uniform control
 * flow — it is all derivatives.
 */
vec2 plUpUv() {
  vec3 dpx = dFdx(-vViewPosition);
  vec3 dpy = dFdy(-vViewPosition);
  vec2 dux = dFdx(vPaperUv);
  vec2 duy = dFdy(vPaperUv);
  float det = dux.x * duy.y - dux.y * duy.x;
  if (abs(det) < 1e-14) return vec2(0.0, 1.0);
  vec3 dPdu = (dpx * duy.y - dpy * dux.y) / det;
  vec3 dPdv = (dpy * dux.x - dpx * duy.x) / det;
  vec3 up = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
  vec2 g = vec2(dot(up, dPdu) / max(dot(dPdu, dPdu), 1e-12), dot(up, dPdv) / max(dot(dPdv, dPdv), 1e-12));
  float l = length(g);
  return l > 1e-6 ? g / l : vec2(0.0, 1.0);
}

/** F1 and F2 of a cell noise — the crack network in char. */
vec2 plVoronoi(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 r = o + vec2(plHash(i + o), plHash(i + o + 17.31)) - f;
      float dd = dot(r, r);
      if (dd < f1) {
        f2 = f1;
        f1 = dd;
      } else if (dd < f2) {
        f2 = dd;
      }
    }
  }
  return sqrt(vec2(f1, f2));
}

/** The scorch ramp, sampled off Scorch.png and Hero.png, as a tint over paper. 0 is the leading edge. */
vec3 plScorchTint(float t) {
  vec3 paper = plLinear(vec3(0.90, 0.885, 0.855));
  vec3 c0 = plLinear(vec3(0.843, 0.741, 0.569)); // #D7BD91
  vec3 c1 = plLinear(vec3(0.745, 0.514, 0.263)); // #BE8343
  vec3 c2 = plLinear(vec3(0.631, 0.384, 0.180)); // #A1622E
  vec3 c3 = plLinear(vec3(0.541, 0.310, 0.141)); // #8A4F24
  vec3 c4 = plLinear(vec3(0.471, 0.275, 0.149)); // #784626
  vec3 c5 = plLinear(vec3(0.380, 0.216, 0.133)); // #613722
  // The dark end hands over to the char's black: a nearly neutral umber, not
  // the saturated brown (#4F3323) it used to stop at. Beside black char that
  // brown showed through wherever the band thinned, and turned the black
  // brown — measured, the cold char's saturation went from 0.43 to 0.11 with
  // the scorch's darkening switched off.
  vec3 c6 = plLinear(vec3(0.169, 0.133, 0.110)); // #2B221C
  float s = clamp(t, 0.0, 1.0) * 6.0;
  // Each stop is blended with a SMOOTH step, not a linear one.
  //
  // Seven colours joined by six straight segments is a ramp with a corner at
  // every joint: the colour is continuous there but its rate of change is
  // not, and the eye reads a discontinuous gradient as a faint line (Mach
  // banding). smoothstep's derivative is zero at both ends of a segment, so
  // consecutive segments meet with matching slope and there is no corner.
  //
  // Cheap insurance, not a bug fix — this was tried first against the macro
  // crops' contour rings and did NOT remove them; the cause turned out to be
  // the scorch fingers below, sampled in a frame that follows the contours.
  float k = smoothstep(0.0, 1.0, clamp(s, 0.0, 1.0));
  vec3 c = mix(c0, c1, k);
  c = mix(c, c2, smoothstep(0.0, 1.0, clamp(s - 1.0, 0.0, 1.0)));
  c = mix(c, c3, smoothstep(0.0, 1.0, clamp(s - 2.0, 0.0, 1.0)));
  c = mix(c, c4, smoothstep(0.0, 1.0, clamp(s - 3.0, 0.0, 1.0)));
  c = mix(c, c5, smoothstep(0.0, 1.0, clamp(s - 4.0, 0.0, 1.0)));
  c = mix(c, c6, smoothstep(0.0, 1.0, clamp(s - 5.0, 0.0, 1.0)));
  return min(c / paper, vec3(1.0));
}

/** The ember ramp (§5 zone 3): off → #870E03 → #A12108 → #F77E14 → #FEFBE0, hottest last. */
vec3 plEmberRamp(float t) {
  vec3 c0 = plLinear(vec3(0.529, 0.055, 0.012));
  vec3 c1 = plLinear(vec3(0.631, 0.129, 0.031));
  vec3 c2 = plLinear(vec3(0.969, 0.494, 0.078));
  vec3 c3 = plLinear(vec3(0.996, 0.984, 0.878));
  vec3 c = mix(c0, c1, smoothstep(0.0, 0.3, t));
  c = mix(c, c2, smoothstep(0.3, 0.7, t));
  return mix(c, c3, smoothstep(0.75, 1.0, t));
}

void plDamage(inout vec4 color, inout float roughness) {
  plDamageLight = vec3(0.0);
  vec4 d = plDamageRead();
  vec2 uv = plDamageWarp();
  vec2 texel = 1.0 / vec2(textureSize(uDamage, 0));

  // Everything measured off screen derivatives, up front: derivatives are
  // undefined past a branch that only some fragments of a quad take.
  vec2 upUv = plUpUv();
  vec4 e = texture2D(uDamage, uv + vec2(texel.x, 0.0));
  vec4 w = texture2D(uDamage, uv - vec2(texel.x, 0.0));
  vec4 n = texture2D(uDamage, uv + vec2(0.0, texel.y));
  vec4 s = texture2D(uDamage, uv - vec2(0.0, texel.y));
  // Per world unit: one texel step is 1 / (N - 1) of the sheet.
  vec2 perWorld = (vec2(textureSize(uDamage, 0)) - 1.0) / uSheetSize;
  vec2 gradP = vec2(e.a - w.a, n.a - s.a) * 0.5 * perWorld;
  vec2 gradC = vec2(e.r - w.r, n.r - s.r) * 0.5 * perWorld;
  // Scorch reaches ahead of the char, and further UP than anywhere else:
  // the char a centimetre below this point, and the char a few millimetres
  // around it, each lent to the scorch at a discount (§4.2, §4.5).
  vec2 mmUv = vec2(PL_MM) / uSheetSize;
  float charBelow = max(texture2D(uDamage, uv - upUv * uLook2.y * mmUv).r, texture2D(uDamage, uv - upUv * 0.5 * uLook2.y * mmUv).r);
  // A ring of eight, averaged: four diagonal maxima drew the grid back in as
  // squares wherever the scorch was magnified.
  float charWide = 0.0;
  for (int k = 0; k < 8; k++) {
    float a = float(k) * 0.7853982;
    charWide += texture2D(uDamage, uv + vec2(cos(a), sin(a)) * 7.0 * mmUv).r;
  }
  charWide /= 8.0;
  // ── The cut, measured ───────────────────────────────────────────────────
  // How far this point is from the cut, in millimetres, out to PL_CUT_REACH —
  // the one measure every zone of a burnt edge is laid out on: the ash lip,
  // the ember line, the char and the scorch (Ember_line annotated). Worked
  // out on the CPU once per change of the field (cutDistance), where a speck
  // of burnt-through paper can be told from a cut: measured here per pixel,
  // every speck near the rim grew its own lip, char and scorch, and the bands
  // came apart into blotches.
  //
  // Burnt AWAY, not charred: the black and the lip belong to paper beside a
  // cut, so a burn toasts before it blackens.
  //
  // Read through the same warp as the cut, so the zones follow the edge that
  // is drawn. Bilinear between a gone texel and the paper beside it, the
  // drawn edge reads half a texel, which comes back off.
  vec2 edgeTexel = 1.0 / vec2(textureSize(uDamageEdge, 0));
  vec2 edgeWorld = uSheetSize / (vec2(textureSize(uDamageEdge, 0)) - 1.0);
  float edgeRaw = texture2D(uDamageEdge, uv).r;
  float edgeHalf = 0.5 * min(edgeWorld.x, edgeWorld.y) / PL_MM;
  float xCut = max(edgeRaw * PL_CUT_REACH - edgeHalf, 0.0);
  // A pixel or so of antialiasing, measured on the same measure.
  float aa = clamp(fwidth(xCut), 0.05, 1.0);
  // Which way the cut lies, from how the distance falls — and along the edge,
  // across that. In the sheet's own space, so noise laid along it follows the
  // rim wherever the rim goes.
  vec2 toward = -vec2(
    (texture2D(uDamageEdge, uv + vec2(edgeTexel.x, 0.0)).r - texture2D(uDamageEdge, uv - vec2(edgeTexel.x, 0.0)).r) / edgeWorld.x,
    (texture2D(uDamageEdge, uv + vec2(0.0, edgeTexel.y)).r - texture2D(uDamageEdge, uv - vec2(0.0, edgeTexel.y)).r) / edgeWorld.y
  );
  vec2 tangentR = length(toward) > 1e-4 ? normalize(vec2(-toward.y, toward.x)) : vec2(1.0, 0.0);
  // Paper with a cut within reach, eased out toward the reach.
  float cutZone = 1.0 - smoothstep(PL_CUT_REACH - 2.0, PL_CUT_REACH - 0.5, xCut);

  // An untouched texel is left exactly as it was — the identity the whole
  // seam is built on. Nothing here has happened to this paper.
  if (d.r <= 0.0 && d.g <= 0.0 && d.a >= 1.0 && charBelow <= 0.0 && charWide <= 0.0 && edgeRaw >= 1.0 && e.a >= 1.0 && w.a >= 1.0 && n.a >= 1.0 && s.a >= 1.0) {
    return;
  }

  vec2 p = plLocal();

  // The zones, out from the cut: the ash lip, the ember line on its outer
  // edge, the char, then the scorch — each as wide as the look says, and
  // uneven along the rim so none of them is a ribbon. The lip's unevenness
  // stays inside the zone the ember gate allows it (lip plus bead).
  float lipEdge = uLook1.y * mix(0.7, 1.1, plFbm(vec2(dot(p, tangentR) / (5.0 * PL_MM), 1.7)));
  float charEnd = lipEdge + uLook0.x + uLook3.w * mix(0.8, 1.2, plFbm(vec2(dot(p, tangentR) / (7.0 * PL_MM), 4.3)));
  // Further above the burn than below it — hot gas rises and cooks the paper
  // over it (§4.5) — out to the scorch's full reach straight up, and about
  // half of it below and beside.
  vec2 upMm = normalize(upUv * uSheetSize);
  float above = length(toward) > 1e-3 ? max(0.0, dot(-normalize(toward), upMm)) : 0.0;
  float scorchEnd = charEnd + uLook2.y * mix(0.45, 1.0, above)
    + (plFbm(vec2(dot(p, tangentR) / (4.0 * PL_MM), 3.1)) - 0.5) * uLook2.w * 2.5;

  // Wet paper is darker and smoother: water fills the gaps between fibres
  // that scatter light, which is both effects from one cause.
  color.rgb *= 1.0 - 0.38 * d.g;
  roughness *= 1.0 - 0.45 * d.g;

  // ── Scorch ──────────────────────────────────────────────────────────────
  // Fingers: irregular teeth ALONG the scorch front, plus the grain's own
  // streaks. Measured along the front's tangent so they point outward.
  vec2 tangentC = length(gradC) > 1e-4 ? normalize(vec2(-gradC.y, gradC.x)) : vec2(1.0, 0.0);
  float along = dot(p, tangentC) / (4.0 * PL_MM);
  // Only where there really IS a front.
  //
  // This noise is sampled in a frame built from the char gradient, so that
  // its teeth run across the front wherever the front happens to point. That
  // works at the front and is meaningless behind it: a few millimetres into
  // the char the gradient is almost flat, its direction is whatever the
  // eight-bit field rounded to, and the frame turns with position — which
  // makes the noise a function OF THE CONTOURS rather than of the sheet. It
  // drew closed loops following the edge, nested a cell apart: the
  // "concentric contour lines, like a topographic map or tree rings" the
  // review found at macro range and left unexplained. Turning this one term
  // off removes them completely and changes nothing else.
  //
  // Measured on the scripted burn's peak: the gradient runs to about 19 at
  // the front and under 1 a few millimetres behind it.
  float frontness = smoothstep(1.0, 6.0, length(gradC));
  float fingers = (plFbm(vec2(along, dot(p, vec2(tangentC.y, -tangentC.x)) / (12.0 * PL_MM))) - 0.5) * 0.28 * frontness
    + (plFbm(vec2(p.x * 9.0, p.y * 30.0)) - 0.5) * 0.08;
  fingers *= uLook2.w;
  // Fingers on the borrowed scorch too, so the outer edge is irregular
  // teeth rather than a smooth offset of the char.
  float reach = 0.75 + fingers * 4.0;
  // The scorch reads a softened char — its own texel and the four around it
  // — so a bilinear 64² field magnified shows no contours or corners. The
  // char zone keeps the sharp one: its edge is meant to be crisp.
  float soft = (2.0 * d.r + e.r + w.r + n.r + s.r) / 6.0;
  float self_ = clamp(mix(d.r, soft, 0.65) + fingers * smoothstep(0.0, 0.08, d.r), 0.0, 1.0);
  float c = 1.0 - (1.0 - self_) * (1.0 - clamp(0.62 * charBelow * reach, 0.0, 1.0)) * (1.0 - clamp(0.4 * charWide * reach, 0.0, 1.0));
  // Fibre-scale grain in the scorch, so a smooth field magnified never shows
  // its contours — real scorch is fibrous (Scorch.png), not banded.
  c = clamp(c + ((plNoise(p * 300.0) - 0.5) * 0.07 + (plNoise(p * 90.0) - 0.5) * 0.06) * smoothstep(0.0, 0.1, c), 0.0, 1.0);
  // A dither of about one and a half of the damage texture's own levels.
  //
  // The field arrives as eight bits a channel, so char comes in steps of
  // 1/255 — and the leading edge below spans 0.03 of it, which is seven and a
  // half steps. The fibre grain above would have hidden them, but it is
  // multiplied by smoothstep(0, 0.1, c), which is approximately zero exactly
  // where the leading edge lives. This is not: it applies everywhere, and
  // being finer than a level it can only ever move a value into the
  // neighbouring one.
  c = clamp(c + (plNoise(p * 900.0) - 0.5) * (1.5 / 255.0), 0.0, 1.0);
  // The colour INSIDE the scorch reads a smoothed c: the same char and the
  // same reaches, without the fingers. The fingers belong to the front's
  // silhouette (lead, below); carried into the ramp as well, a strong fingers
  // setting swung the scorch between tan and near-black umber a few
  // millimetres apart — a leopard print, not a toast.
  float cSmooth = 1.0 - (1.0 - clamp(mix(d.r, soft, 0.65), 0.0, 1.0)) * (1.0 - clamp(0.62 * charBelow * 0.75, 0.0, 1.0)) * (1.0 - clamp(0.4 * charWide * 0.75, 0.0, 1.0));
  cSmooth = clamp(cSmooth + ((plNoise(p * 300.0) - 0.5) * 0.05 + (plNoise(p * 90.0) - 0.5) * 0.04) * smoothstep(0.0, 0.1, cSmooth), 0.0, 1.0);
  // A steep leading edge — paper to straw in a sliver — then the long ramp.
  // The front's teeth from the noisy c; filled in behind them from the smooth
  // one, so a dip in the noise cannot open a patch of clean paper inside it.
  float lead = max(smoothstep(0.02, 0.05, c), smoothstep(0.1, 0.2, cSmooth));
  // The browns are done by 0.45, where the char's umber hand-over takes them:
  // the ramp used to run on to 0.7, over the char, and most of what read as
  // "char" was this ramp's darkest brown.
  float ramp = smoothstep(0.05, 0.45, cSmooth);
  // That toast is for paper with no cut near it — the first stage of a burn,
  // before anything has gone through.
  color.rgb *= mix(vec3(1.0), pow(plScorchTint(ramp), vec3(uLook2.z)), lead * (1.0 - cutZone));
  // Round a cut, the scorch is a band of its own: dark, only a little lighter
  // than the char it leads from, a shade warmer toward its outer edge, then a
  // steep leading edge into clean paper (Ember_line annotated, zone 5: "steep
  // leading edge · albedo only"). A black band beside a pale tan one was the
  // contrast that read as wrong.
  float scorchT = smoothstep(charEnd, scorchEnd, xCut);
  vec3 scorchTint = mix(plLinear(vec3(0.24, 0.17, 0.12)), plLinear(vec3(0.42, 0.28, 0.17)), scorchT) / plLinear(vec3(0.90, 0.885, 0.855));
  float scorchZone = (1.0 - smoothstep(scorchEnd - 0.35, scorchEnd + 0.35, xCut)) * cutZone;
  color.rgb *= mix(vec3(1.0), pow(min(scorchTint, vec3(1.0)), vec3(uLook2.z)), scorchZone);

  // ── Char ────────────────────────────────────────────────────────────────
  // A wide, smooth hand-over from scorch to char — the gradient is the point.
  // From 0.3: the field carries char in about one texel beside the cut, so
  // past a couple of millimetres c is mostly the scorch borrowed from below,
  // and a zone that began at 0.5 was hardly ever char at all.
  // Away from a cut, c only makes char where it is really high: at 0.3–0.6
  // the finger noise pushed it across the line all through the scorch, and
  // every crossing was a black island in the orange — a leopard print.
  // Round a cut, the band from the lip out to charEnd; away from one, only
  // where the toast has gone all the way to char.
  float charBand = (1.0 - smoothstep(charEnd - 0.5, charEnd + 0.5, xCut)) * cutZone;
  float charZone = max(smoothstep(0.6, 0.85, cSmooth) * (1.0 - cutZone), charBand);
  vec2 cells = plVoronoi(p / (3.6 * PL_MM));
  // Sparse: a real crack network is broken, not a tiled floor — most cell
  // borders never split.
  float crack = (1.0 - smoothstep(0.008, 0.03, cells.y - cells.x)) * smoothstep(0.45, 0.65, plNoise(p / (7.0 * PL_MM)));
  float plate = plHash(floor(p / (3.6 * PL_MM)) + 3.7);
  // Black. Real char is a near-neutral black — (22, 20, 18) on the cold
  // macro references, about 11% of the paper's value. The warm brown this
  // used to be was Hero.png's char LIT BY ITS FLAMES, painted into the paper,
  // which is why ours stayed orange on a frame with no fire in it. Warmth on
  // char comes from the fire's light now, and goes when the fire does.
  // charWarmth adds only a trace of brown to the black, and a warmer umber
  // where the char hands over to the scorch.
  vec3 body = mix(plLinear(vec3(0.086, 0.078, 0.071)), plLinear(vec3(0.11, 0.08, 0.06)), uLook1.w);
  vec3 under = mix(plLinear(vec3(0.20, 0.15, 0.11)), plLinear(vec3(0.28, 0.16, 0.08)), uLook1.w);
  vec3 cracks = plLinear(vec3(0.039, 0.024, 0.016));    // #0A0604
  // Black through the band; the umber only in its outer millimetre.
  float toUnder = mix(1.0 - smoothstep(0.45, 0.8, cSmooth), smoothstep(charEnd - 1.2, charEnd + 0.3, xCut), cutZone);
  vec3 charColor = mix(body, under, toUnder);
  // Mottled at the plate scale and finer, and darker than the sampled body
  // under a bright key — the reference's char reads near black in the frame.
  charColor *= (0.75 + 0.35 * plate) * (0.8 + 0.4 * plNoise(p * 260.0));
  charColor = mix(charColor, cracks, crack * uLook2.x);
  color.rgb = mix(color.rgb, charColor, charZone);
  roughness = mix(roughness, 0.6, charZone);
  // Blistered, and each plate tilted its own way, so a raking light breaks
  // the char into plates rather than lighting it as one sheet of black.
  plHeight += charZone * ((plNoise(p * 380.0) - 0.5) * 0.00008 + (plate - 0.5) * 0.00018 - crack * 0.00016);

  // ── Ash lip ─────────────────────────────────────────────────────────────
  // A crust as wide as the char band, from the cut to lipEdge — the pale
  // thing that makes a hole read as a hole on a black stage (Ember_line
  // annotated, zone 2). It used to be held to about a millimetre, which at a
  // reading distance is a hairline tracing the edge, not ash.
  //
  // Broken, not a hem: ash flakes off a cooling edge in pieces, so the lip
  // comes and goes along the rim and wanders in width. Mostly there, though —
  // it has to be seen.
  float lipAlong = dot(p, tangentR) / (3.2 * PL_MM);
  float lipBreak = smoothstep(0.1, 0.3, plFbm(vec2(lipAlong, 0.9)));
  float lip = (1.0 - smoothstep(lipEdge - aa, lipEdge + aa, xCut)) * cutZone * lipBreak;
  // Pale: the reference's #A49E9D up to a near-white grey, so it reads white
  // beside the char. Still matte and still dimmer than the paper.
  vec3 ash = plLinear(mix(vec3(0.643, 0.620, 0.616), vec3(0.84, 0.82, 0.81), plNoise(p * 520.0) * 0.6 + plNoise(p * 90.0) * 0.4)) * uLook1.z;
  color.rgb = mix(color.rgb, ash, lip);
  roughness = mix(roughness, 0.99, lip);
  // And the crust the ragged edge is made of. The cut is frayed at fibre
  // scale, and the fray opened specks of void all through the first few
  // millimetres — exactly where the lip lies — so at a reading distance the
  // lip was grey specks in black. Paper inside the fray's band is kept, as
  // ash, instead of cut away: the lip overhangs the hole a little, broken
  // where the lip is broken, the way the reference's crust does.
  float crust = lipBreak * cutZone * smoothstep(0.18, 0.3, d.a) * (1.0 - step(0.5, d.a));
  color.rgb = mix(color.rgb, ash, crust);
  roughness = mix(roughness, 0.99, crust);
  // Raised, and crumbly rather than rounded: a smooth ridge round the hole is
  // a cylinder, and a cylinder under a key light has a specular line down it
  // however rough it is — the neon tube this once was.
  plHeight += lip * (0.55 + 0.45 * plNoise(p * 700.0)) * 0.00016;

  // ── The ember line ──────────────────────────────────────────────────────
  // Beads along the cut: position along the edge, crawling on the burn's
  // clock, with a flicker of their own. Only where it is hot — and as the
  // heat goes the threshold rises, so the line breaks into fewer, dimmer
  // beads and they go out one by one.
  float s1 = dot(p, tangentR) / (2.4 * PL_MM) - uDamageTime * 0.55 * uLook0.w;
  float bead = plNoise(vec2(s1, 0.37)) * 0.7 + plNoise(vec2(s1 * 2.3, 5.1)) * 0.3;
  float flicker = 0.62 + 0.38 * plNoise(vec2(floor(s1) * 7.13, uDamageTime * 9.0 * uLook0.w));
  // Down to a smoulder's last flicker: a spent edge keeps a little heat in
  // the texture (\`Afterglow\`), and a bead should glow dim red on it rather
  // than vanish while the edge still has something to give.
  // Heat softened like the cut (its texel and the four around it), so the
  // beads and the crimson glow follow the burn rather than the grid's cells.
  float heatSoft = (2.0 * d.b + e.b + w.b + n.b + s.b) / 6.0;
  float hot = smoothstep(0.012, 0.55, heatSoft);
  // Coverage slides the threshold: more of the edge lit, or less.
  float shift = (uLook0.z - 0.5) * 0.5;
  float lit = smoothstep(mix(0.82, 0.45, hot) - shift, mix(0.9, 0.58, hot) - shift, bead);
  // Each bead tapers at its ends — a bead, not a dash cut from a strip.
  float width = max(mix(0.4, max(uLook0.x, 0.41), plNoise(vec2(s1 * 0.7, 9.0))) * (0.35 + 0.65 * lit), 1.4 * aa);
  // On the lip's outer edge, between the ash and the char.
  float band = smoothstep(lipEdge - aa, lipEdge + aa, xCut) * (1.0 - smoothstep(lipEdge + width - aa, lipEdge + width + aa, xCut)) * cutZone;
  // Mostly orange: a bead is red at its ends and yellow-white only at its
  // hottest core, which is what Ember_line.png shows. Mapped low and pushed
  // high by a power, so white is the exception rather than the line.
  // Orange through, yellow-white at the hottest cores. Dim red alone reads
  // salmon once the curve desaturates it, so the ramp starts at orange and
  // only the cooling (low heat) falls back into red.
  float t = hot * flicker * (0.45 + 0.55 * lit);
  color.rgb = mix(color.rgb, plLinear(vec3(0.12, 0.04, 0.02)), band * lit);
  // Saturated orange at orange brightness; only the hottest cores are pushed
  // high enough for the curve to roll them to white.
  plDamageLight = plEmberRamp(t) * mix(0.8, 6.0, t * t * t * t) * band * lit * hot * uLook0.y;

  // The rest of a real burning edge (Ember_line.png): a dim crimson glow in
  // the char beside the beads — patches of it, drifting — and specks of
  // glowing fibre that come and go. Both stay under the bloom threshold, so
  // they read as heat in the char rather than as light; both only where the
  // edge is hot, and inside the zone the beads are held to — the lip plus
  // the widest bead, measured from the cut — so the glow never reaches out
  // over paper the gate says heat must not light.
  float zoneEnd = lipEdge + uLook0.x;
  float seam = smoothstep(lipEdge - aa, lipEdge + aa, xCut) * (1.0 - smoothstep(zoneEnd - 0.6, zoneEnd, xCut)) * cutZone;
  float patch_ = smoothstep(0.35, 0.72, plFbm(p / (4.0 * PL_MM) + vec2(uDamageTime * 0.15 * uLook0.w, 0.0)));
  plDamageLight += vec3(0.55, 0.06, 0.01) * seam * patch_ * hot * uLook1.x;
  float speck = step(0.985, plHash(floor(p / (0.35 * PL_MM)) + floor(uDamageTime * 8.0 * uLook0.w)));
  plDamageLight += plEmberRamp(0.9) * 1.6 * speck * seam * hot * uLook3.z;

  // The crust stays, however the fray cut it.
  d.a = mix(d.a, max(d.a, 0.5), step(0.5, crust));
  plDamageCut(color, d);
}
`

/**
 * The sheet-space half of `HELPERS`, for the shadow pass.
 *
 * `HELPERS` is written for the colour program, and part of it cannot compile
 * anywhere else: `plPerturb` reads `vViewPosition`, which a depth material
 * does not have — and GLSL compiles a function whether or not anything calls
 * it. So the depth program gets everything the CUTTING chunks need (the UV
 * varying, the sheet size, `plLocal`, the noise) and none of the lighting.
 *
 * Carved out of the one string at load time rather than written twice, so the
 * two can never drift, and so the colour program stays byte-for-byte what it
 * was. If an anchor below ever moves, this throws on import rather than
 * compiling a shadow program that silently differs.
 */
function carveDepthHelpers(helpers: string): string {
  const darken = 'uniform float uBackDarken;\n'
  const relief = helpers.indexOf("/**\n * The paper's relief")
  const bell = helpers.lastIndexOf('/**', helpers.indexOf('float plBell('))
  if (!helpers.includes(darken) || relief < 0 || bell <= relief) {
    throw new Error('compose: HELPERS changed shape — update carveDepthHelpers')
  }
  return (helpers.slice(0, relief) + helpers.slice(bell)).replace(darken, '')
}

/** Exported for its test, which pins what the shadow pass can and cannot see. */
export const DEPTH_HELPERS = carveDepthHelpers(HELPERS)

const DEPTH_VERTEX = /* glsl */ `
varying vec2 vPaperUv;
void main() {
  vPaperUv = uv;
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
  // Last, so a burn chars over the yellowing and the ink alike.
  if (maps.hasDamage) {
    chunks.push(DAMAGE_CHUNK, DAMAGE_SHADE_CHUNK)
    calls.push('plDamage(csm_DiffuseColor, csm_Roughness);')
    // Bound by `PaperMaterial` to the uploaded texture; null only until then.
    uniforms.uDamage = { value: null }
    // The distance from the cut beside it, bound by `PaperMaterial` with it.
    uniforms.uDamageEdge = { value: null }
    // Set by `PaperMaterial` from the source's `detail` every frame.
    uniforms.uDamageDetail = { value: 1 }
    // The burn's clock, which the ember line's beads move on — see `DamageSource.time`.
    uniforms.uDamageTime = { value: 0 }
    // How the burn is drawn — set from `DamageSource.look` every frame.
    const look = DAMAGE_LOOK_DEFAULTS
    uniforms.uLook0 = {
      value: new THREE.Vector4(look.emberWidth, look.emberIntensity, look.emberCoverage, look.emberFlicker),
    }
    uniforms.uLook1 = {
      value: new THREE.Vector4(look.emberGlow, look.lipWidth, look.lipBrightness, look.charWarmth),
    }
    uniforms.uLook2 = {
      value: new THREE.Vector4(look.charCracks, look.scorchReach, look.scorchDarkness, look.fingers),
    }
    uniforms.uLook3 = { value: new THREE.Vector4(look.edgeWave, look.edgeBite, look.sparkle, look.charWidth) }
  }

  /**
   * The shadow pass, for any sheet that removes paper.
   *
   * Holes cut in the colour program by alpha are invisible to the shadow
   * map: three renders shadows with its own depth material, which alpha-tests
   * a `map` if there is one and knows nothing of alpha computed in shader
   * code. So a torn edge, a perforation and a burnt-through hole all cast a
   * solid shadow — the most obvious fake a burn can have, and one the
   * deckle and perforation had been shipping since before this seam.
   *
   * The fix is the same chunks, run again in a depth program that DISCARDS
   * wherever the colour program would have cut. Only what cuts: grain,
   * creases and ageing change colour and not coverage, and a depth program
   * pays per fragment for everything in it.
   */
  const cutting: string[] = []
  const cuts: string[] = []
  if (deckle) {
    cutting.push(DECKLE_CHUNK)
    cuts.push('plDeckle(color);')
  }
  if (perforation) {
    cutting.push(PERFORATION_CHUNK)
    cuts.push('plPerforation(color);')
  }
  if (maps.hasDamage) {
    cutting.push(DAMAGE_CHUNK)
    cuts.push('plDamageCut(color, plDamageRead());')
  }
  const depth =
    cutting.length > 0
      ? {
          vertexShader: DEPTH_VERTEX,
          fragmentShader: /* glsl */ `
${DEPTH_HELPERS}
${cutting.join('\n')}
void main() {
  vec4 color = vec4(1.0);
  float roughness = 1.0;
  ${cuts.join('\n  ')}
  if (color.a < 0.5) discard;
}
`,
        }
      : null

  // Whether anything above described a SHAPE and not just a colour. The
  // perturbation is one pair of screen derivatives, which is cheap but not
  // free, and a plain sheet has nothing for it to do.
  // A burn has a shape too — blistered char, a lifted ash lip — and on an
  // untouched field its height is exactly zero, which `plPerturb` returns
  // unchanged, so attaching a field still costs a sheet no pixel.
  const relief = grain !== undefined || creases.length > 0 || Boolean(maps.hasDamage)

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
${maps.hasDamage ? '  // The ember line — the only light a burn gives off from the sheet itself.\n  csm_Emissive += plDamageLight;' : ''}
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
    ].join('')}:${maps.hasFrontMap ? 'F' : ''}${maps.hasBackMap ? 'B' : ''}${maps.hasDamage ? 'D' : ''}`,
    vertexShader: VERTEX,
    fragmentShader,
    uniforms,
    // Anything that removes paper needs fragments discarded rather than
    // blended — a hole has to cut the depth buffer and the shadow too.
    alphaTest: deckle || perforation || maps.hasDamage ? 0.5 : 0,
    depth,
  }
}

function pad(values: number[], fill = 0): number[] {
  const out = values.slice(0, 4)
  while (out.length < 4) out.push(fill)
  return out
}
