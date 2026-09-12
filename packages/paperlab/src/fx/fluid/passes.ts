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
uniform float uBody;
uniform float uCore;
uniform float uHeatScale;
uniform float uContrast;
uniform float uDetail;
uniform float uOpacity;
uniform float uStreak;
uniform float uEdge;
uniform float uBlue;
uniform float uThin;
uniform float uPaleFrom;
uniform float uShapeFrom;
varying vec2 vUv;
${NOISE}
// Emission as a function of how INTENSE the gas is — colour and brightness
// together, in the order a hot body glows: dim is deep red-orange, brighter is
// orange, bright is amber and then yellow, and only the brightest is pale.
//
// The version before this chose hue and brightness separately, to stop heat
// turning a flame white. That cut the one link real fire never breaks —
// hotter gas is brighter AND yellower — and the dim parts of every tongue
// came out dark YELLOW, which is olive: a khaki-green fire. The blackbody ramp
// before that had the order right; its only problem was that the temperature
// field was saturated, so every pixel sat at the top of it. Now the intensity
// carries the flame's structure (outline, sheets, streak), so it spans the
// whole ramp. The stops' luminance rises monotonically: 0.13, 0.43, 0.66,
// 0.82, 0.93.
vec3 flameEmission(float i) {
  // The dim end is burnt ORANGE, not deep red: deep red light on cream paper
  // is pink, and a flame's dim parts are exactly the parts that stand in
  // front of the sheet at the tips. Amber and yellow come earlier than they
  // did (0.32 and 0.62): the flame measured 9% yellow against the
  // reference's 29%, and raising the gain only pushed yellow into the tone
  // curve's roll-off, where it turns pale — more yellow has to come from
  // spending more of the intensity range on it, not from more light.
  vec3 c = mix(vec3(0.0), vec3(0.40, 0.09, 0.008), smoothstep(0.0, 0.1, i));
  c = mix(c, vec3(1.0, 0.34, 0.025), smoothstep(0.08, 0.34, i));
  c = mix(c, vec3(1.0, 0.62, 0.10), smoothstep(0.25, 0.52, i));
  c = mix(c, vec3(1.0, 0.82, 0.30), smoothstep(0.45, 0.78, i));
  return mix(c, vec3(1.0, 0.93, 0.66), smoothstep(0.9, 1.4, i));
}

void main() {
  // Detail finer than the grid, and none of it touching the solve: a domain
  // warp so a tongue's outline is never the grid's, and a finer shimmer.
  vec2 w = vUv * vec2(26.0, 18.0) + vec2(0.0, -uTime * 1.6);
  vec2 warp = vec2(fxFbm(w), fxFbm(w + 31.7)) - 0.5;
  vec2 q = vUv * vec2(70.0, 50.0) + vec2(0.0, -uTime * 7.0);
  vec2 jitter = (vec2(fxNoise(q), fxNoise(q + 17.3)) - 0.5) * 0.0035;
  // A third of what it was. At 0.014 the warp was large enough to fold the
  // gas's own gradients into marbled whorls — a procedural texture inside the
  // flame, which reads as a shaded object rather than as fire.
  vec4 a = texture2D(uA, vUv + jitter + warp * 0.005);
  float fuel = a.r;
  float heat = a.g;
  float smoke = a.b;
  // Temperature against the hottest gas a flame has (see FIRE_HEAT_SCALE),
  // with what burnt a moment ago still counting for a little.
  float t = max(heat, a.a * 0.6) / max(uHeatScale, 1e-3);
  // Carved multiplicatively, hardest where the gas is thin, so it opens
  // holes rather than dimming evenly — the black between tongues.
  vec2 n1 = vUv * vec2(34.0, 24.0) + vec2(0.0, -uTime * 2.4);
  vec2 n2 = vUv * vec2(92.0, 64.0) + vec2(0.0, -uTime * 5.5);
  float grain = (fxFbm(n1) - 0.5) * 0.72 + (fxNoise(n2) - 0.5) * 0.28;
  t = max(0.0, t * (1.0 + grain * uDetail * (1.0 - smoothstep(0.15, 0.95, t))));
  t = pow(t, uContrast);

  // SHEETS of light, stretched along the flow. A flame's light does not
  // come from a volume the way a lamp's does; it comes from the thin sheet
  // where the burning is, folded by the flow, and seen edge-on it reads as
  // streaks running up the tongue with darker gas between them. Drawing the
  // temperature field straight was drawing a gradient — a smooth hot centre
  // falling off to a cool rim — which is a blob by construction. Ridged
  // noise, eight times finer across than along, scrolling up.
  vec2 sp = vec2(vUv.x * 64.0 + warp.x * 6.0, vUv.y * 8.0 - uTime * 2.6);
  // Spread before it is folded. Fractal noise clusters around 0.5, so a ridge
  // made straight from it sits near 1 almost everywhere — there were almost
  // never any dark lanes, and turning FIRE_STREAK from 0.3 to 0.8 changed
  // nothing measurable. Measured, the flame's brightness was 80% in a single
  // band against a reference spread across all five: a flat fill.
  float sn = clamp((fxFbm(sp) - 0.5) * 2.8 + 0.5, 0.0, 1.0);
  float ridge = 1.0 - abs(2.0 * sn - 1.0);

  // Where the flame IS: an outline, not a fade. Real tongues have a fairly
  // defined edge (Flame_base.png); a gaussian fall-off is what makes a flame
  // read as a glow.
  // It starts at FIRE_SHAPE_FROM of the hottest gas, not at the edge of
  // any warmth at all. Gas just above that line is warm but barely glowing,
  // and drawn over cream paper it is a long peach veil trailing above each
  // tongue — 8.4% of the flame's pixels, 97% of them over the paper. The
  // tongues in Hero.png end in defined tips with nothing above them.
  float shape = smoothstep(uShapeFrom, uShapeFrom + uEdge, t);
  // How bright, in multiples of paper white: the body, dimmer at the cool
  // edges and tips, and shaded by the sheets. Never climbing to white.
  float intensity = shape * mix(0.15, 1.0, smoothstep(0.05, 0.8, t)) * mix(1.0 - uStreak, 1.0, ridge);
  // The pale part: only the hottest gas, and only ON a sheet — a streak up
  // the lower middle of a tongue, never a filled interior. It pushes the
  // intensity past the yellow into the pale end of the ramp, and it is the one
  // term allowed to over-expose, so the one that blooms.
  // Smooth, and small: the hottest root of a tongue, the soft pale core in
  // Flame_base.png. Each tongue there is smooth INSIDE — pale core, yellow,
  // orange edges — and all of its character is in its outline. Painting
  // sheets and streaks inside it (FIRE_STREAK above zero) made the flame read
  // as an object with a shader on it. The streak survives only as an option.
  float pale = smoothstep(uPaleFrom, uPaleFrom + 0.35, t) * mix(1.0, pow(ridge, 4.0), uStreak);
  intensity += pale * 0.5;
  float gain = (uBody + pale * uCore) * uPaperWhite;
  vec3 hue = flameEmission(intensity);
  // Blue at the root, where fresh gas leaves the paper and burns clean
  // before it has heated through — the thin blue line under every tongue in
  // Flame_base.png. Fuel rich, heat low, inside the outline.
  // Keyed to fuel alone: the first version keyed it to fuel / heat, and at
  // four times the strength it drew not one blue pixel.
  float root = shape * uBlue * smoothstep(0.02, 0.25, fuel) * (1.0 - smoothstep(0.25, 0.6, t));
  // Added as light, not mixed in: mixing blue into orange does not make a
  // blue base, it makes GREY — the lavender cast at the edges of every tongue.
  hue += vec3(0.05, 0.12, 0.45) * clamp(root, 0.0, 0.6);
  // Dense flame covers what is behind it, inside its outline only — so a
  // tongue in front of the sheet reads as its own colour, not a tint on it.
  float fireAlpha = shape * (1.0 - exp(-t * uOpacity));
  // …and THIN gas glows in proportion to how much of the background it
  // covers. Soot emits and absorbs together; a tip that barely hides the
  // paper also barely glows. Without this a tip was nearly transparent yet
  // emitting at full strength for its colour, so the frame came out as cream
  // paper plus red light — the salmon tips over the sheet.
  vec3 fire = hue * gain * uGlow * smoothstep(0.0, uThin, fireAlpha);

  // Smoke: grey-brown, lit warm by the fire under it — keyed to the same
  // normalised temperature, so a puff near the rim is not pink on cream.
  float smokeAlpha = 1.0 - exp(-smoke * uSmokeDensity);
  // Warm grey-brown: a cool neutral grey over cream paper reads LAVENDER.
  vec3 smokeColor = vec3(0.16, 0.13, 0.10) + vec3(0.22, 0.09, 0.02) * smoothstep(0.15, 0.9, t);
  float alpha = smokeAlpha + fireAlpha - smokeAlpha * fireAlpha;
  // No square edge: the domain fades out before its borders.
  float edge = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x) * smoothstep(0.0, 0.03, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
  gl_FragColor = vec4((fire + smokeColor * smokeAlpha) * edge, alpha * edge);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
