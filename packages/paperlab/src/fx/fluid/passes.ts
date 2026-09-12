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
 * The MacCormack correction, for what is drawn.
 *
 * One semi-Lagrangian back-trace loses about half a cell of detail a step,
 * because every read is a bilinear average of four cells; at sixty steps a
 * second, anything the solver resolves is butter within a few frames. That
 * is the dominant reason the flames were soft, and no finer grid fixes it —
 * the loss is per step, not per cell.
 *
 * MacCormack measures its own error and gives it back: advect forward
 * (uForward), advect THAT back again (uBackward), and the difference between
 * where it ended up and where it started is twice the error one step made.
 * Half of it is added back. Then the result is clamped to the four cells the
 * forward step actually read from, because an uncorrected overshoot is worse
 * than a blur — it grows hot spots brighter than anything the rim ever
 * released, and they ring.
 */
export const MACCORMACK = /* glsl */ `
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform sampler2D uForward;
uniform sampler2D uBackward;
uniform vec2 uDomain;
uniform vec2 uTexel;
uniform float uDt;
varying vec2 vUv;
void main() {
  vec4 forward = texture2D(uForward, vUv);
  vec4 phi = forward + 0.5 * (texture2D(uSource, vUv) - texture2D(uBackward, vUv));
  vec2 v = texture2D(uVelocity, vUv).xy;
  vec2 back = vUv - v * uDt / uDomain;
  vec2 corner = (floor(back / uTexel - 0.5) + 0.5) * uTexel;
  vec4 a = texture2D(uSource, corner);
  vec4 b = texture2D(uSource, corner + vec2(uTexel.x, 0.0));
  vec4 c = texture2D(uSource, corner + vec2(0.0, uTexel.y));
  vec4 d = texture2D(uSource, corner + uTexel);
  gl_FragColor = clamp(phi, min(min(a, b), min(c, d)), max(max(a, b), max(c, d)));
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
uniform float uHeatScale;
uniform float uContrast;
uniform float uOpacity;
uniform float uThin;
uniform vec3 uTipColor;
uniform vec3 uBodyColor;
uniform vec3 uCoreColor;
uniform vec3 uRootColor;
uniform float uTipGlow;
uniform float uBodyGlow;
uniform float uCoreGlow;
uniform float uTipFrom;
uniform float uTipTo;
uniform float uCoreFrom;
uniform float uSoftness;
uniform float uTearing;
uniform float uRootAmount;
uniform float uRootReach;
varying vec2 vUv;
${NOISE}
void main() {
  // Detail finer than the grid, none of it touching the solve: a small domain
  // warp so a tongue's outline is never the grid's, and a finer shimmer.
  vec2 w = vUv * vec2(26.0, 18.0) + vec2(0.0, -uTime * 1.6);
  vec2 warp = vec2(fxFbm(w), fxFbm(w + 31.7)) - 0.5;
  vec2 q = vUv * vec2(70.0, 50.0) + vec2(0.0, -uTime * 7.0);
  vec2 jitter = (vec2(fxNoise(q), fxNoise(q + 17.3)) - 0.5) * 0.0035;
  vec4 a = texture2D(uA, vUv + jitter + warp * 0.005);
  float fuel = a.r;
  float heat = a.g;
  float smoke = a.b;
  // Temperature against the hottest gas a flame has (FIRE_HEAT_SCALE), with
  // what burnt a moment ago still counting for a little.
  float t = max(heat, a.a * 0.6) / max(uHeatScale, 1e-3);
  // The tip's tearing: carved multiplicatively, hardest where the gas is
  // thin, so tongues come apart at their edges and keep their bodies.
  vec2 n1 = vUv * vec2(34.0, 24.0) + vec2(0.0, -uTime * 2.4);
  vec2 n2 = vUv * vec2(92.0, 64.0) + vec2(0.0, -uTime * 5.5);
  float grain = (fxFbm(n1) - 0.5) * 0.72 + (fxNoise(n2) - 0.5) * 0.28;
  t = max(0.0, t * (1.0 + grain * uTearing * (1.0 - smoothstep(0.15, 0.95, t))));
  t = pow(t, uContrast);

  // THE FOUR ZONES (FireZones, fx/emission.ts), as bands of temperature.
  // Where the flame is at all: its outline starts at the tip's own edge.
  float shape = smoothstep(uTipFrom, uTipFrom + uSoftness, t);
  // Tip gives way to body, body to core. Colour and brightness blend across
  // the same bands but are chosen separately per zone.
  float toBody = smoothstep(uTipTo - 0.12, uTipTo + 0.12, t);
  float toCore = smoothstep(uCoreFrom, uCoreFrom + 0.35, t);
  vec3 color = mix(mix(uTipColor, uBodyColor, toBody), uCoreColor, toCore);
  float glow = mix(mix(uTipGlow, uBodyGlow, toBody), uCoreGlow, toCore);
  // Dense flame covers what is behind it; thin gas glows only as much as it
  // covers (soot emits and absorbs together) — or a transparent tip adds
  // red light to cream paper and turns salmon.
  float fireAlpha = shape * (1.0 - exp(-t * uOpacity));
  vec3 fire = color * glow * shape * uPaperWhite * uGlow * smoothstep(0.0, uThin, fireAlpha);
  // The root: added as LIGHT, where fresh fuel is still near the paper and the
  // gas has not heated through. Mixed in instead of added, blue makes grey.
  float rootMask = shape * smoothstep(mix(0.4, 0.02, uRootReach), mix(0.6, 0.12, uRootReach), fuel) * (1.0 - smoothstep(0.25, 0.6, t));
  fire += uRootColor * rootMask * uRootAmount * uPaperWhite * uGlow * 0.6;

  // Smoke: warm grey-brown (a cool grey over cream reads lavender), lit by
  // the fire under it.
  float smokeAlpha = 1.0 - exp(-smoke * uSmokeDensity);
  vec3 smokeColor = vec3(0.16, 0.13, 0.10) + vec3(0.22, 0.09, 0.02) * smoothstep(0.15, 0.9, t);
  float alpha = smokeAlpha + fireAlpha - smokeAlpha * fireAlpha;
  // No square edge: the domain fades out before its borders.
  float edge = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x) * smoothstep(0.0, 0.03, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
  gl_FragColor = vec4((fire + smokeColor * smokeAlpha) * edge, alpha * edge);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
