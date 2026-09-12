/**
 * The fire solver's passes, as GLSL. A grid fluid of the kind real-time fire
 * has been built on since Stam's stable fluids: semi-Lagrangian advection, a
 * Jacobi pressure solve that keeps the air from compressing, buoyancy from
 * temperature, curl-noise turbulence and vorticity confinement for the small
 * eddies that make fire restless — and a combustion step that burns fuel
 * only where AIR HAS REACHED IT, turning it into heat, soot and smoke.
 *
 * That last clause is the whole difference between a flame and a plume of hot
 * smoke, and the first version of this file got it wrong: it refilled every
 * cell toward ambient oxygen, inside the flame as much as outside it, so fuel
 * burnt within a twelfth of a second of leaving the paper wherever it was. A
 * flame is the surface where fuel meets air. The fuel inside it cannot burn
 * until air has worked its way in from the sides, so the fuel core is eaten
 * from the outside and closes to a point — the TIP — at the height where the
 * last of it meets air. Nothing else gives a tongue that shape.
 *
 * Every pass is a full-screen triangle over one field. Velocity and pressure
 * live on a coarser grid; fuel, heat, smoke, soot and air on a finer one,
 * sampling the velocity bilinearly.
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
float fxHash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123); }
float fxNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(fxHash3(i), fxHash3(i + vec3(1.0, 0.0, 0.0)), u.x), mix(fxHash3(i + vec3(0.0, 1.0, 0.0)), fxHash3(i + vec3(1.0, 1.0, 0.0)), u.x), u.y);
  float b = mix(mix(fxHash3(i + vec3(0.0, 0.0, 1.0)), fxHash3(i + vec3(1.0, 0.0, 1.0)), u.x), mix(fxHash3(i + vec3(0.0, 1.0, 1.0)), fxHash3(i + vec3(1.0, 1.0, 1.0)), u.x), u.y);
  return mix(a, b, u.z);
}
float fxFbm3(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * fxNoise3(p);
    p = p * 2.07 + 13.0;
    a *= 0.5;
  }
  return v;
}
`

/**
 * Sources are short LINES along the rim, not discs.
 *
 * `uSources`: (u, v, half-length along the rim, strength).
 * `uAcross`:  (toward the paper — a unit vector in aspect-corrected domain
 *             space —, half-width across the rim, how far onto the paper).
 *
 * A disc was the old shape: up to 15 mm in radius, releasing gas into the
 * hole and over the paper alike, and it was what drew every flame as a
 * droplet. Gas comes off the char just behind the ember line, along it, in a
 * band a couple of millimetres wide; that band is what this draws.
 */
const SOURCES = /* glsl */ `
uniform vec4 uSources[${MAX_SOURCES}];
uniform vec4 uAcross[${MAX_SOURCES}];
uniform int uCount;
uniform float uAspect;
float fxEmission(vec2 uv, out vec2 outward) {
  float e = 0.0;
  outward = vec2(0.0);
  for (int i = 0; i < ${MAX_SOURCES}; i++) {
    if (i >= uCount) break;
    vec4 s = uSources[i];
    vec4 k = uAcross[i];
    vec2 d = (uv - s.xy) * vec2(uAspect, 1.0);
    vec2 n = k.xy;
    float across = dot(d, n) - k.w;
    float along = dot(d, vec2(-n.y, n.x));
    float g = s.w * exp(-along * along / (s.z * s.z) - across * across / (k.z * k.z));
    e += g;
    // Off the edge, away from the paper it came from.
    outward -= g * n;
  }
  return e;
}
`

/**
 * The rim's emission, once per step: (strength, outward.x, outward.y, –).
 *
 * The combustion pass used to loop over every source for every texel, TWICE
 * (it runs once per output target), and the forces pass a third time. Written
 * once here and read back as a texture, it costs one loop a step.
 */
export const EMIT = /* glsl */ `
varying vec2 vUv;
${SOURCES}
void main() {
  vec2 outward;
  float e = fxEmission(vUv, outward);
  gl_FragColor = vec4(e, outward, 0.0);
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
 * second, anything the solver resolves is butter within a few frames.
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
 * once to write (fuel, heat, smoke, soot), once for (premixed, oxygen, burn
 * rate, –). The same arithmetic both times, so the two agree.
 *
 * Oxygen reaches fuel two ways, and neither is "everywhere at once":
 *
 *   mixing       from the air beside it, in the plane — a diffusion step
 *                over the four neighbours.
 *   entrainment  from in front and behind: a slice through a fire has no
 *                third dimension for air to come from, so it is put back
 *                here — but dense fuel BLOCKS it, because the air drawn into
 *                a real tongue meets the fuel's outside first. That is what
 *                keeps a fuel core fuel-rich and burning only at its skin.
 *
 * Soot is what a flame's light comes from, and the only thing drawn as flame
 * (the render pass reads it, not the heat). It forms from fuel that is hot,
 * burns away where there is oxygen, and goes out when the gas cools — so a
 * tongue glows from the paper to the height where its fuel runs out, and no
 * further. `persistence` is how long soot lasts in open air.
 */
export const REACT = /* glsl */ `
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uEmit;
uniform sampler2D uVelocity;
uniform vec2 uDomain;
uniform vec2 uTexel;
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
uniform float uMixing;
uniform float uEntrain;
uniform float uFuelBlock;
uniform float uSootYield;
uniform float uSootHeat;
uniform float uStoich;
varying vec2 vUv;
void main() {
  vec4 a = texture2D(uA, vUv);
  vec4 b = texture2D(uB, vUv);
  // What a parcel picked up crossing the rim during the step — sampled back
  // along its path, not at the one point it ended at. The band gas comes off
  // is ~2 mm across and the gas crosses it at ~5 mm a step at 60 Hz, so a
  // point sample drew one line of fuel per step: horizontal stripes up every
  // tongue.
  vec2 path = texture2D(uVelocity, vUv).xy * uDt / uDomain;
  float e = 0.25 * (texture2D(uEmit, vUv).r + texture2D(uEmit, vUv - path * 0.25).r +
    texture2D(uEmit, vUv - path * 0.5).r + texture2D(uEmit, vUv - path * 0.75).r);
  // What the rim releases this step.
  float fuel = a.r + e * uFuel * uDt;
  float heat = a.g + e * uHeat * uDt;
  float smoke = a.b + e * uSmoke * uDt;
  float premixed = b.r + e * uFuel * uPremixed * uDt;
  // Air, mixed in from beside and entrained from in front and behind.
  float around = 0.25 * (
    texture2D(uB, vUv + vec2(uTexel.x, 0.0)).g + texture2D(uB, vUv - vec2(uTexel.x, 0.0)).g +
    texture2D(uB, vUv + vec2(0.0, uTexel.y)).g + texture2D(uB, vUv - vec2(0.0, uTexel.y)).g);
  float oxygen = mix(b.g, around, uMixing);
  float reach = exp(-fuel / max(uFuelBlock, 1e-4));
  oxygen += (uAmbient - oxygen) * (1.0 - exp(-uEntrain * reach * uDt));
  // Fuel burns only as far as there is oxygen for it — premixed first — and a
  // unit of fuel takes uStoich of air. At one to one (as it once was) fuel was
  // never denser than the air around it, so nothing ever ran out of air and
  // every scrap of fuel burnt where it stood: no core, no tip.
  float burn = min(fuel, premixed + oxygen / uStoich) * (1.0 - exp(-uBurnRate * uDt));
  fuel = max(0.0, fuel - burn) * exp(-uDt * 0.6);
  float fromPremixed = min(premixed, burn);
  premixed = max(0.0, premixed - fromPremixed) * exp(-uDt * 0.6);
  oxygen = max(0.0, oxygen - (burn - fromPremixed) * uStoich);
  heat = (heat + burn * uHeatRelease) * exp(-uCooling * uDt);
  smoke = (smoke + burn * uSmokeProduction) * exp(-uDt / uSmokeFade);
  float rate = burn / max(uDt, 1e-4);
  // Soot: forms from hot fuel, burns where there is air, and is gone once the
  // gas is too cool to glow.
  float hot = heat / max(uSootHeat, 1e-3);
  float soot = a.a + uSootYield * (fuel + burn) * smoothstep(0.3, 0.8, hot) * uDt;
  float air = oxygen / max(uAmbient, 0.05);
  // Soot that cools stops glowing within a few frames — it is smoke now, and
  // the smoke channel already carries that. Held to glowing only below a
  // twentieth of uSootHeat, it outlived the flame by a hand's breadth and
  // drew ribbons and hooks of flame colour high over the sheet.
  float cold = 1.0 - smoothstep(0.2, 0.6, hot);
  soot *= exp(-uDt * (air / max(uPersistence, 1e-3) + cold * 25.0));
  // An open top: whatever reaches it leaves.
  float open = 1.0 - smoothstep(0.9, 1.0, vUv.y);
  if (uOut == 0) gl_FragColor = vec4(fuel, heat, smoke * open, soot) * vec4(open, open, 1.0, open);
  else gl_FragColor = vec4(premixed * open, oxygen, rate, 0.0);
}
`

/** Buoyancy, wind, turbulence and the emission's own push, on the coarse grid. */
export const FORCES = /* glsl */ `
uniform sampler2D uVelocity;
uniform sampler2D uA;
uniform sampler2D uEmit;
uniform vec2 uTexel;
uniform vec2 uDomain;
uniform float uDt;
uniform float uTime;
uniform float uBuoyancy;
uniform float uWind;
uniform float uTurbulence;
uniform float uTurbScale;
uniform float uTurbEvolve;
uniform float uRadial;
uniform vec2 uInitVel;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 v = texture2D(uVelocity, vUv).xy;
  vec4 a = texture2D(uA, vUv);
  // Hot gas rises.
  v.y += uBuoyancy * a.g * uDt;
  v.x += uWind * uDt;
  // Curl noise: divergence-free eddies, in world units, carried up with the
  // gas AND changing as they go. The third coordinate is time: a 2D pattern
  // that only scrolled was a wave travelling up a still flame, never a flame
  // that flickers.
  float drift = uTime * 0.8 + 1.7 * fxNoise(vec2(uTime * 0.23, 3.1));
  vec3 p = vec3(vUv * uDomain * uTurbScale + vec2(0.37 * fxNoise(vec2(uTime * 0.17, 9.0)), -drift), uTime * uTurbEvolve);
  float h = 0.04;
  float n = fxFbm3(p);
  vec2 curl = vec2(fxFbm3(p + vec3(0.0, h, 0.0)) - n, -(fxFbm3(p + vec3(h, 0.0, 0.0)) - n)) / h;
  v += curl * uTurbulence * uDt * (0.2 + clamp(a.g, 0.0, 2.0));
  // The gas leaves the paper at its own speed, pushed off the edge if asked.
  vec4 em = texture2D(uEmit, vUv);
  float e = em.r;
  vec2 launch = uInitVel + uRadial * em.gb / max(e, 1e-4);
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

/** How the fine grid is drawn: soot glowing at its temperature, and smoke lit warm from below. */
export const RENDER_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/**
 * Two fields, two jobs. The first version drew everything — outline, colour,
 * opacity, brightness — from temperature alone, and the contours of one
 * smooth scalar are nested smooth rings: an airbrushed blob with a white spot
 * in it, however the bands were tuned.
 *
 *   soot         WHERE the flame is and how dense: its outline, its opacity,
 *                how much light it can give. It ends where the fuel runs out.
 *   temperature  WHAT COLOUR that soot glows: the zones, tip to core.
 */
export const RENDER_FRAGMENT = /* glsl */ `
uniform sampler2D uA;
uniform float uTime;
uniform float uGlow;
uniform float uSmokeDensity;
uniform float uPaperWhite;
uniform float uHeatScale;
uniform float uSootScale;
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
  // warp so a tongue's outline is never the grid's.
  vec2 w = vUv * vec2(26.0, 18.0) + vec2(0.0, -uTime * 1.6);
  vec2 warp = vec2(fxFbm(w), fxFbm(w + 31.7)) - 0.5;
  vec4 a = texture2D(uA, vUv + warp * 0.004);
  float fuel = a.r;
  float heat = a.g;
  float smoke = a.b;
  // How dense the glowing soot is, against a full flame's (FIRE_SOOT_SCALE).
  float rho = a.a / max(uSootScale, 1e-4);
  // The tip's tearing: carved into the soot where it is thin, so tongues come
  // apart at their edges and keep their bodies.
  vec2 n1 = vUv * vec2(34.0, 24.0) + vec2(0.0, -uTime * 2.4);
  vec2 n2 = vUv * vec2(92.0, 64.0) + vec2(0.0, -uTime * 5.5);
  float grain = (fxFbm(n1) - 0.5) * 0.72 + (fxNoise(n2) - 0.5) * 0.28;
  rho = max(0.0, rho * (1.0 + grain * uTearing * (1.0 - smoothstep(0.1, 0.8, rho))));
  // Temperature against the hottest gas a flame has (FIRE_HEAT_SCALE).
  float t = pow(clamp(heat / max(uHeatScale, 1e-3), 0.0, 2.0), uContrast);

  // WHERE: the outline, from the soot.
  float shape = smoothstep(uTipFrom, uTipFrom + uSoftness, rho);
  // WHAT COLOUR: the zones, as bands of temperature.
  float toBody = smoothstep(uTipTo - 0.12, uTipTo + 0.12, t);
  float toCore = smoothstep(uCoreFrom, uCoreFrom + 0.35, t);
  vec3 color = mix(mix(uTipColor, uBodyColor, toBody), uCoreColor, toCore);
  float glow = mix(mix(uTipGlow, uBodyGlow, toBody), uCoreGlow, toCore);
  // Soot emits and absorbs together: thin soot glows as much as it covers, and
  // a dense flame covers what is behind it only as far as uOpacity says.
  float cover = 1.0 - exp(-rho * 3.0);
  float fireAlpha = shape * cover * clamp(uOpacity / 5.0, 0.0, 1.0);
  vec3 fire = color * glow * shape * uPaperWhite * uGlow * smoothstep(0.0, uThin, cover);
  // The root: added as LIGHT, where fresh fuel is still near the paper and the
  // gas has not heated through. Mixed in instead of added, blue makes grey.
  float rootMask = smoothstep(mix(0.4, 0.02, uRootReach), mix(0.6, 0.12, uRootReach), fuel) * (1.0 - smoothstep(0.25, 0.6, t));
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
