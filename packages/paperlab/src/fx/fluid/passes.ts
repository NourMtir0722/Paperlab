/**
 * The fire solver's passes, as GLSL. A grid fluid of the kind real-time fire
 * has been built on since Stam's stable fluids: semi-Lagrangian advection, a
 * Jacobi pressure solve that keeps the air from compressing, buoyancy from
 * temperature, curl-noise turbulence and vorticity confinement for the small
 * eddies that make fire restless — and a combustion step that burns fuel
 * only where there is oxygen for it, turning it into heat and smoke.
 *
 * Every pass is a full-screen triangle over one field. Velocity and pressure
 * live on a coarse grid (they are smooth); fuel, heat, smoke, flame and air
 * on a finer one, sampling the velocity bilinearly — which is where the
 * fire's detail comes from, at a fraction of the cost of a fine solve.
 */

/** Maximum emission points the passes loop over. */
export const MAX_SOURCES = 48

export const PASS_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const NOISE = /* glsl */ `
float fxHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float fxNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fxHash(i), fxHash(i + vec2(1.0, 0.0)), u.x), mix(fxHash(i + vec2(0.0, 1.0)), fxHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fxFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * fxNoise(p);
    p = p * 2.07 + 13.0;
    a *= 0.5;
  }
  return v;
}
`

/** Sources: (u, v, radius in v units, strength). */
const SOURCES = /* glsl */ `
uniform vec4 uSources[${MAX_SOURCES}];
uniform int uCount;
uniform float uAspect;
float fxEmission(vec2 uv, out vec2 outward) {
  float e = 0.0;
  outward = vec2(0.0);
  for (int i = 0; i < ${MAX_SOURCES}; i++) {
    if (i >= uCount) break;
    vec4 s = uSources[i];
    vec2 d = (uv - s.xy) * vec2(uAspect, 1.0);
    float g = s.w * exp(-dot(d, d) / (s.z * s.z));
    e += g;
    float l = length(d);
    if (l > 1e-5) outward += g * d / l;
  }
  return e;
}
`

/** Carry a field along the velocity, backward in time. */
export const ADVECT = /* glsl */ `
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uDomain;
uniform float uDt;
uniform vec4 uKeep;
varying vec2 vUv;
void main() {
  vec2 v = texture2D(uVelocity, vUv).xy;
  vec2 back = vUv - v * uDt / uDomain;
  gl_FragColor = texture2D(uSource, back) * uKeep;
}
`

/**
 * Emission and combustion, for the fine grid. Run twice with `uOut` 0 and 1:
 * once to write (fuel, heat, smoke, flame), once for (premixed, oxygen,
 * burn rate, –). The same arithmetic both times, so the two agree.
 */
export const REACT = /* glsl */ `
uniform sampler2D uA;
uniform sampler2D uB;
uniform int uOut;
uniform float uDt;
uniform float uFuel;
uniform float uHeat;
uniform float uSmoke;
uniform float uPremixed;
uniform float uAmbient;
uniform float uBurnRate;
uniform float uHeatRelease;
uniform float uCooling;
uniform float uSmokeProduction;
uniform float uSmokeFade;
uniform float uPersistence;
varying vec2 vUv;
${SOURCES}
void main() {
  vec4 a = texture2D(uA, vUv);
  vec4 b = texture2D(uB, vUv);
  vec2 outward;
  float e = fxEmission(vUv, outward);
  // What the rim releases this step.
  float fuel = a.r + e * uFuel * uDt;
  float heat = a.g + e * uHeat * uDt;
  float smoke = a.b + e * uSmoke * uDt;
  float premixed = b.r + e * uFuel * uPremixed * uDt;
  // The air mixes back toward its ambient oxygen.
  float oxygen = b.g + (uAmbient - b.g) * (1.0 - exp(-uDt * 1.5));
  // Fuel burns only as far as there is oxygen for it — premixed first.
  float burn = min(fuel, premixed + oxygen) * (1.0 - exp(-uBurnRate * uDt));
  fuel = max(0.0, fuel - burn) * exp(-uDt * 0.6);
  float fromPremixed = min(premixed, burn);
  premixed = max(0.0, premixed - fromPremixed) * exp(-uDt * 0.6);
  oxygen = max(0.0, oxygen - (burn - fromPremixed));
  heat = (heat + burn * uHeatRelease) * exp(-uCooling * uDt);
  smoke = (smoke + burn * uSmokeProduction) * exp(-uDt / uSmokeFade);
  float rate = burn / max(uDt, 1e-4);
  // Flame: what burnt a moment ago still looks like flame, for as long as
  // persistence says.
  float flame = max(a.a * exp(-uDt / uPersistence), rate * 0.25);
  // An open top: whatever reaches it leaves.
  float open = 1.0 - smoothstep(0.9, 1.0, vUv.y);
  if (uOut == 0) gl_FragColor = vec4(fuel, heat, smoke * open, flame) * vec4(open, open, 1.0, open);
  else gl_FragColor = vec4(premixed * open, oxygen, rate, 0.0);
}
`

/** Buoyancy, wind, turbulence and the emission's own push, on the coarse grid. */
export const FORCES = /* glsl */ `
uniform sampler2D uVelocity;
uniform sampler2D uA;
uniform vec2 uTexel;
uniform float uDt;
uniform float uTime;
uniform float uBuoyancy;
uniform float uWind;
uniform float uTurbulence;
uniform float uTurbScale;
uniform float uRadial;
uniform vec2 uInitVel;
varying vec2 vUv;
${NOISE}
${SOURCES}
void main() {
  vec2 v = texture2D(uVelocity, vUv).xy;
  vec4 a = texture2D(uA, vUv);
  // Hot gas rises.
  v.y += uBuoyancy * a.g * uDt;
  v.x += uWind * uDt;
  // Curl noise: divergence-free eddies that drift upward at a speed that
  // itself wanders, so the motion never settles into a loop.
  float drift = uTime * 0.8 + 1.7 * fxNoise(vec2(uTime * 0.23, 3.1));
  vec2 p = vec2(vUv.x * uAspect, vUv.y) * uTurbScale + vec2(0.37 * fxNoise(vec2(uTime * 0.17, 9.0)), -drift);
  float h = 0.04;
  float n = fxFbm(p);
  vec2 curl = vec2(fxFbm(p + vec2(0.0, h)) - n, -(fxFbm(p + vec2(h, 0.0)) - n)) / h;
  v += curl * uTurbulence * uDt * (0.2 + clamp(a.g, 0.0, 2.0));
  // The gas leaves the paper at its own speed, pushed outward if asked.
  vec2 outward;
  float e = fxEmission(vUv, outward);
  vec2 launch = uInitVel + uRadial * outward / max(e, 1e-4);
  v = mix(v, launch, clamp(e * uDt * 6.0, 0.0, 1.0));
  // Walls on three sides; the top is open.
  if (vUv.x < uTexel.x || vUv.x > 1.0 - uTexel.x || vUv.y < uTexel.y) v = vec2(0.0);
  gl_FragColor = vec4(v, 0.0, 1.0);
}
`

export const CURL = /* glsl */ `
uniform sampler2D uVelocity;
uniform vec2 uTexel;
uniform float uCell;
varying vec2 vUv;
void main() {
  float l = texture2D(uVelocity, vUv - vec2(uTexel.x, 0.0)).y;
  float r = texture2D(uVelocity, vUv + vec2(uTexel.x, 0.0)).y;
  float b = texture2D(uVelocity, vUv - vec2(0.0, uTexel.y)).x;
  float t = texture2D(uVelocity, vUv + vec2(0.0, uTexel.y)).x;
  gl_FragColor = vec4((r - l - t + b) * 0.5 / uCell, 0.0, 0.0, 1.0);
}
`

/** Vorticity confinement: give back the small swirls the grid smooths away. */
export const VORTICITY = /* glsl */ `
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform vec2 uTexel;
uniform float uCell;
uniform float uDt;
uniform float uVorticity;
varying vec2 vUv;
void main() {
  float l = abs(texture2D(uCurl, vUv - vec2(uTexel.x, 0.0)).x);
  float r = abs(texture2D(uCurl, vUv + vec2(uTexel.x, 0.0)).x);
  float b = abs(texture2D(uCurl, vUv - vec2(0.0, uTexel.y)).x);
  float t = abs(texture2D(uCurl, vUv + vec2(0.0, uTexel.y)).x);
  float w = texture2D(uCurl, vUv).x;
  vec2 n = vec2(r - l, t - b);
  n /= length(n) + 1e-5;
  vec2 v = texture2D(uVelocity, vUv).xy + uVorticity * uCell * vec2(n.y, -n.x) * w * uDt;
  gl_FragColor = vec4(v, 0.0, 1.0);
}
`

/** How much the flow compresses — minus the gas burning expands by. */
export const DIVERGENCE = /* glsl */ `
uniform sampler2D uVelocity;
uniform sampler2D uB;
uniform vec2 uTexel;
uniform float uCell;
uniform float uExpansion;
varying vec2 vUv;
void main() {
  float l = texture2D(uVelocity, vUv - vec2(uTexel.x, 0.0)).x;
  float r = texture2D(uVelocity, vUv + vec2(uTexel.x, 0.0)).x;
  float b = texture2D(uVelocity, vUv - vec2(0.0, uTexel.y)).y;
  float t = texture2D(uVelocity, vUv + vec2(0.0, uTexel.y)).y;
  float div = (r - l + t - b) * 0.5 / uCell - uExpansion * texture2D(uB, vUv).b;
  gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
}
`

export const PRESSURE = /* glsl */ `
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uTexel;
uniform float uCell;
varying vec2 vUv;
void main() {
  float l = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float r = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float b = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float t = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  float div = texture2D(uDivergence, vUv).x;
  gl_FragColor = vec4((l + r + b + t - div * uCell * uCell) * 0.25, 0.0, 0.0, 1.0);
}
`

export const GRADIENT = /* glsl */ `
uniform sampler2D uVelocity;
uniform sampler2D uPressure;
uniform vec2 uTexel;
uniform float uCell;
varying vec2 vUv;
void main() {
  float l = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float r = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float b = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float t = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  vec2 v = texture2D(uVelocity, vUv).xy - vec2(r - l, t - b) * 0.5 / uCell;
  gl_FragColor = vec4(v, 0.0, 1.0);
}
`

export const FILL = /* glsl */ `
uniform vec4 uValue;
void main() {
  gl_FragColor = uValue;
}
`

/** How the fine grid is drawn: blackbody fire, and smoke lit warm from below. */
export const RENDER_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const RENDER_FRAGMENT = /* glsl */ `
uniform sampler2D uA;
uniform float uTime;
uniform float uGlow;
uniform float uSmokeDensity;
uniform float uPaperWhite;
uniform float uBody;
uniform float uCore;
uniform float uHeatScale;
varying vec2 vUv;
${NOISE}
// Temperature to colour, the way hot gas glows: dark red, orange, yellow,
// orange-white at the hottest — never pink.
vec3 blackbody(float t) {
  // The coolest visible gas is deep ORANGE, not red: red light added to
  // cream paper is exactly the pink the spec forbids (§0, §13.3).
  vec3 c = mix(vec3(0.0), vec3(0.6, 0.16, 0.01), smoothstep(0.3, 0.6, t));
  c = mix(c, vec3(1.0, 0.36, 0.02), smoothstep(0.6, 1.0, t));
  c = mix(c, vec3(1.0, 0.68, 0.18), smoothstep(0.95, 1.7, t));
  c = mix(c, vec3(1.0, 0.88, 0.62), smoothstep(1.7, 2.8, t));
  return c;
}
/**
 * The blackbody ramp's luminance at its hottest, Rec. 709.
 *
 * The numbers below are written in multiples of paper white, and this is what
 * converts: the ramp above carries HUE only, and its top colour
 * (1.0, 0.88, 0.62) is 0.887 as bright as white. Dividing it out means
 * "uCore = 8" really does put the hottest core at eight times paper white,
 * rather than at eight times something nobody measured.
 */
const float BB_PEAK_LUMA = 0.887;

void main() {
  // Detail finer than the grid, and none of it touching the solve.
  //
  // The dye grid resolves about a millimetre, which is finer than a tongue —
  // but a single bilinear semi-Lagrangian advection loses roughly half a cell
  // of detail per step, so at 60 steps a second whatever structure the solver
  // makes is butter within a few frames. Both of these are per-PIXEL and cost
  // one fbm each, which is the cheap half of the fix (the other half is a
  // better advection, and belongs in the solver).
  //
  // A domain warp first: the read wanders at a scale below a cell, scrolling
  // up with the gas, so a tongue's outline is never the grid's.
  vec2 w = vUv * vec2(26.0, 18.0) + vec2(0.0, -uTime * 1.6);
  vec2 warp = vec2(fxFbm(w), fxFbm(w + 31.7)) - 0.5;
  // …and a shimmer finer again, so the flames flicker at their own scale.
  vec2 q = vUv * vec2(70.0, 50.0) + vec2(0.0, -uTime * 7.0);
  vec2 jitter = (vec2(fxNoise(q), fxNoise(q + 17.3)) - 0.5) * 0.0035;
  vec4 a = texture2D(uA, vUv + jitter + warp * 0.014);
  float heat = a.g;
  float flame = a.a;
  float smoke = a.b;
  // Hot gas glows — and the flames were never brighter than the paper they
  // rose from. This curve used to top out at 1.9, times a blackbody that
  // reaches 0.887, so the biggest light in the frame peaked at a scene
  // luminance of 1.68 against a bloom threshold of 3.6. It never bloomed:
  // measured, turning bloom on at the peak moved 0.07% of the pixels.
  //
  // Raising the whole curve is NOT the fix, and was tried: a flame that is
  // uniformly over-bright is desaturated to pastel by the tone curve, and the
  // bloom of a large bright area tints the entire black stage. What a fire
  // actually looks like is a big SATURATED body with small VERY bright cores
  // in it, so the two are separate terms with a deliberate gap between them:
  //
  //   body  the flame you see. Above paper white, so it reads as a light —
  //         and under the bloom threshold, so it stays saturated orange.
  //   core  only the hottest gas, a small fraction of the flame's area,
  //         well past the threshold. This is what blooms, and what makes the
  //         halo and the spill onto the scorch.
  //
  // Thin, cool gas still fades out rather than blushing: nothing glows until
  // it is hot enough to look orange (§13.3 — red light on cream paper is the
  // pink the spec forbids).
  //
  // Everything below reads a NORMALISED temperature, not the solver's raw
  // heat, and that is the fix for "one cream blob with no core, body or tip".
  // The solver's heat is unbounded — the rim releases 22 a second and burning
  // adds three times what it consumes — so it runs to many times the largest
  // number the ramps were written against. blackbody tops out at 2.8 and
  // the core band started at 1.7, which meant that across essentially the
  // whole flame BOTH were saturated: every pixel got the ramp's last colour
  // (cream) and the full core term. Raising the core then made the entire
  // flame brighter instead of putting bright cores in it, which is exactly
  // what the frame showed.
  //
  // uHeatScale is the temperature that counts as the hottest gas, so t is
  // 1 at a flame's core and falls away through its body and tips — and the
  // bands below are fractions of it rather than raw numbers that only meant
  // something for one set of solver settings.
  float t = heat / max(uHeatScale, 1e-3);
  float ft = flame / max(uHeatScale, 1e-3);
  // Tear the tips.
  //
  // Combustion is a thin sheet, and where it runs out it breaks into
  // filaments — a flame ends in split tongues, not in a soft edge. Every ramp
  // in this pass is smooth, so without this the top of a tongue dissolves
  // evenly like a gaussian, which is most of why the flames read as blobs.
  // The noise bites only at the COOL end (smoothstep runs 0.9 to 0.25, so it
  // is zero through the core and full at the tip), which is the one place a
  // real flame comes apart.
  vec2 nt = vUv * vec2(48.0, 34.0) + vec2(0.0, -uTime * 3.2);
  t = max(0.0, t + (fxFbm(nt) - 0.5) * 0.34 * smoothstep(0.9, 0.25, t));
  float body = smoothstep(0.10, 0.34, t) * uBody + flame * 0.3 * uBody * smoothstep(0.06, 0.2, t);
  float core = smoothstep(0.45, 0.85, t) * uCore;
  float glow = (body + core) * uPaperWhite / BB_PEAK_LUMA;
  // The ramp's own domain is 0..2.8; t is 0..1.
  vec3 fire = blackbody((t + ft * 0.4) * 2.8) * glow * uGlow;
  // Smoke: grey-brown, lit warm by the fire under it.
  float alpha = 1.0 - exp(-smoke * uSmokeDensity);
  vec3 smokeColor = vec3(0.13, 0.12, 0.11) + vec3(0.35, 0.14, 0.03) * clamp(heat * 0.5, 0.0, 1.0);
  // No square edge: the domain fades out before its borders.
  float edge = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x) * smoothstep(0.0, 0.03, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
  gl_FragColor = vec4((fire + smokeColor * alpha) * edge, alpha * edge);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
