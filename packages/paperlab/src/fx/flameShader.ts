import * as THREE from 'three'

/**
 * One flame shader for every flame in paperlab/fx — the tongues on a burning
 * rim (`FxFlames`) and the match in a hand (`FxMatchFlame`) are the same fire,
 * and a match that looked different from what it lit would give the trick
 * away.
 *
 * A quad per flame, turned to the camera about WORLD up, never the sheet's
 * normal. Upward-scrolling, domain-warped noise inside a teardrop, coloured
 * on a dense, hot base: orange-white at the source, yellow above, orange at
 * the edges and tips, translucent as it thins, torn at the top into split
 * tongues, gaps and loose wisps. Each flame puffs on its own
 * value noise at 10–15 Hz (`flamePuff` in flames.ts runs the same function
 * on the CPU for the fire light). Additive, HDR, writes no depth.
 *
 * Per instance: `aBase` (root, world) and `aShape` (height, width, seed,
 * heat). Per material: `uTime`, `uLean` (the air and the motion, world units),
 * `uBlue` (0..1 — a flame starved by moving fast burns blue and dim) and
 * `uGain` (a strike's flare).
 */

const NOISE = /* glsl */ `
float flHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float flNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(flHash(i), flHash(i + vec2(1.0, 0.0)), u.x), mix(flHash(i + vec2(0.0, 1.0)), flHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float flFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * flNoise(p);
    p = p * 2.03 + 17.0;
    a *= 0.5;
  }
  return v;
}
float flHash1(float n) { return fract(sin(n) * 43758.5453); }
float flNoise1(float x) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(flHash1(i), flHash1(i + 1.0), f);
}
`

const VERTEX = /* glsl */ `
attribute vec3 aBase;
attribute vec4 aShape; // height, width, seed, heat
uniform float uTime;
uniform vec3 uLean;
varying vec2 vUv;
varying float vSeed;
varying float vHeat;
${NOISE}
void main() {
  vUv = position.xy;
  vSeed = aShape.z;
  vHeat = aShape.w;
  // The same puff as \`flamePuff\` in flames.ts — the fire light reads it too.
  float puff = 0.72 + 0.28 * flNoise1(uTime * 12.5 + aShape.z * 37.0) + 0.12 * (flNoise1(uTime * 23.0 + aShape.z * 11.0) - 0.5);
  float h = aShape.x * puff;
  vec3 up = normalize(vec3(0.0, 1.0, 0.0) + uLean);
  vec3 toCamera = normalize(cameraPosition - aBase);
  vec3 right = normalize(cross(up, toCamera));
  // A curve, not a tilt: the root holds and the tip is carried.
  vec3 p = aBase + toCamera * 0.004 + right * position.x * aShape.y + up * position.y * h
    + uLean * position.y * position.y * h * 0.8;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`

const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uBlue;
uniform float uGain;
varying vec2 vUv;
varying float vSeed;
varying float vHeat;
${NOISE}
void main() {
  // The quad is 1.8× the flame's width, so the turbulence can carry the
  // flame sideways without the quad's own edge cutting it into a bar.
  float x = vUv.x * 1.8;
  float y = vUv.y;
  // Climbing at a speed that itself wanders — per flame, and over time — so
  // the motion never settles into a loop. An offset, not a rate × time: a
  // rate that changes would make the pattern jump.
  float climb = uTime * (2.7 + 0.9 * vSeed) + 1.8 * flNoise1(uTime * 0.37 + vSeed * 9.1);
  // Three layers of turbulence: a slow sway of the whole tongue, a flutter
  // near the tip, and a fine shiver — each warping the next.
  vec2 q = vec2(x * 1.2 + vSeed * 13.0, y * 1.9 - climb);
  float sway = flFbm(q);
  float flutter = flFbm(vec2(x * 2.7 + vSeed * 5.0 + sway * 1.3, y * 4.3 - climb * 1.55));
  float shiver = flNoise(vec2(x * 7.0 + vSeed * 3.0, y * 11.0 - climb * 2.4));
  // Every tongue leans its own way — nothing here is symmetrical.
  float lean = (fract(vSeed * 91.7) - 0.5) * 0.45;
  float xw = x + (sway - 0.5) * 1.35 * y + (flutter - 0.5) * 0.5 * y * y + (shiver - 0.5) * 0.12 * y + lean * y;
  // The teardrop: dense and wide at the source, a point at the top.
  float half_ = 1.0 * pow(max(y, 0.0), 0.3) * pow(max(1.0 - y, 0.0), 1.3);
  // Crisp and dense low down, soft and translucent higher up.
  float body = 1.0 - smoothstep(half_ * mix(0.82, 0.4, y), half_, abs(xw));
  // Tips that split: a hard threshold high up tears the flame into separate
  // tongues and wisps that come loose ...
  float tear = flFbm(vec2(x * 2.4 + vSeed * 7.0, y * 4.2 - climb * 1.7));
  body *= smoothstep(0.0, 0.14, tear + 0.82 - y * 1.1);
  // ... and small gaps open inside the upper body, where the gas is thin.
  float gaps = smoothstep(0.58, 0.72, flFbm(vec2(x * 3.3 - vSeed * 4.0, y * 6.5 - climb * 2.0)));
  body *= 1.0 - gaps * smoothstep(0.3, 0.8, y) * 0.95;
  body *= smoothstep(0.0, 0.04, y);
  // The source is hot and dense: orange-white at the root, yellow above it,
  // orange at the edges and tips, and translucent as it thins.
  vec3 white = vec3(1.0, 0.86, 0.62);   // orange-white
  vec3 yellow = vec3(0.98, 0.62, 0.09); // #FDCE54
  vec3 orange = vec3(0.77, 0.2, 0.0);   // #E37B04
  // The orange-white is only the very root; above it the flame is saturated
  // yellow, then orange. Mixed broadly it washed the whole tongue pale.
  float base = 1.0 - smoothstep(0.0, 0.26, y);
  float inner = 1.0 - smoothstep(0.0, half_ * 0.5, abs(xw));
  vec3 c = mix(orange, yellow, smoothstep(0.35, 0.85, body * (1.0 - y * 0.85)));
  c = mix(c, white, clamp(base * inner, 0.0, 1.0));
  // Dense at the source, and bright enough there to bloom; thinning above.
  c *= mix(1.0, 4.4, base * (0.45 + 0.55 * inner)) * (0.55 + 0.45 * vHeat) * uGain;
  // Only a match starved of air by moving fast burns blue.
  c = mix(c, vec3(0.027, 0.025, 0.099) * 2.5, uBlue * 0.75);
  float fade = 1.0 - smoothstep(0.55, 1.0, y);
  gl_FragColor = vec4(c * body * fade, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/** Instanced quads for up to `max` flames. `instanceCount` starts at 0. */
export function flameGeometry(max: number): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry()
  // A unit quad: x across the tongue, y from root (0) to tip (1).
  g.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0]), 3),
  )
  g.setIndex([0, 1, 2, 0, 2, 3])
  g.setAttribute('aBase', new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, max) * 3), 3))
  g.setAttribute('aShape', new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, max) * 4), 4))
  g.instanceCount = 0
  // Flames go wherever the fire is; a bounding sphere would be recomputed a
  // frame to save a cull that never fires.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)
  return g
}

export function flameMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uLean: { value: new THREE.Vector3() },
      uBlue: { value: 0 },
      uGain: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
}
