import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { ParticlePool, ParticleTarget } from './particles'

/**
 * The pool, drawn — three kinds, three ways, because a fire's three
 * particles are three different things.
 *
 * - **Embers** are light, moving fast: quads STRETCHED along their own
 *   screen-space velocity into streaks, a bright head and a fading tail,
 *   additive and HDR so they bloom. A spark is never a static dot.
 * - **Smoke** is soft sprites broken up by noise — thin, grey-brown, widening
 *   as it rises. Camera-facing points: one vertex each is still the right
 *   price for something this soft.
 * - **Ash** is paper: thin curled planes that tumble in three dimensions,
 *   double-sided, char-dark with pale ash edges, lit by where they face
 *   rather than glowing — a few keep a hot edge for their first second.
 *
 * This only draws. The page owns the order — field, then emitters, then the
 * pool's own step — because only the page knows which field belongs to which
 * sheet.
 */

export interface FxParticlesProps {
  pool: ParticlePool
}

/** Seconds of motion an ember's streak covers — long enough to read as speed, short enough to stay a spark. */
const STREAK = 0.045

const QUAD_STREAK = new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0])
const QUAD_FLAKE = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0])
const QUAD_INDEX = [0, 1, 2, 0, 2, 3]

function makeTarget(capacity: number): ParticleTarget {
  return {
    position: new Float32Array(capacity * 3),
    color: new Float32Array(capacity * 4),
    extra: new Float32Array(capacity * 4),
    velocity: new Float32Array(capacity * 3),
  }
}

/** Instanced quads over a target's own arrays — no copy. */
function useInstanced(capacity: number, quad: Float32Array) {
  const layer = useMemo(() => {
    const target = makeTarget(capacity)
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(quad, 3))
    geometry.setIndex(QUAD_INDEX)
    geometry.setAttribute('aPos', new THREE.InstancedBufferAttribute(target.position, 3))
    geometry.setAttribute('aVel', new THREE.InstancedBufferAttribute(target.velocity!, 3))
    geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(target.color, 4))
    geometry.setAttribute('aExtra', new THREE.InstancedBufferAttribute(target.extra, 4))
    geometry.instanceCount = 0
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)
    return { target, geometry }
  }, [capacity, quad])
  useEffect(() => () => layer.geometry.dispose(), [layer])
  return layer
}

/** Points over a target's arrays, for the smoke. */
function usePoints(capacity: number) {
  const layer = useMemo(() => {
    const target = makeTarget(capacity)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(target.position, 3))
    geometry.setAttribute('pColor', new THREE.BufferAttribute(target.color, 4))
    geometry.setAttribute('pExtra', new THREE.BufferAttribute(target.extra, 4))
    geometry.setDrawRange(0, 0)
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)
    return { target, geometry }
  }, [capacity])
  useEffect(() => () => layer.geometry.dispose(), [layer])
  return layer
}

const OUTPUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`

const EMBER_VERTEX = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aVel;
attribute vec4 aColor;
attribute vec4 aExtra; // size, angle, shape, seed
uniform vec2 uResolution;
uniform float uStreak;
varying vec4 vColor;
varying vec2 vQuad;
void main() {
  vec4 head = projectionMatrix * viewMatrix * vec4(aPos, 1.0);
  vec4 tail = projectionMatrix * viewMatrix * vec4(aPos - aVel * uStreak, 1.0);
  vec2 half_ = 0.5 * uResolution;
  vec2 d = head.xy / head.w * half_ - tail.xy / tail.w * half_;
  float len = length(d);
  vec2 dir = len > 1e-3 ? d / len : vec2(0.0, 1.0);
  vec2 across = vec2(-dir.y, dir.x);
  // Diameter in pixels from a size in world units: the projection's own scale.
  float px = max(1.5, aExtra.x * projectionMatrix[1][1] * half_.y / head.w);
  float along = len + px;
  vec2 offset = across * position.x * px * 0.5 + dir * (px * 0.5 - position.y * along);
  gl_Position = head + vec4(offset / half_ * head.w, 0.0, 0.0);
  vColor = aColor;
  vQuad = position.xy;
}
`

const EMBER_FRAGMENT = /* glsl */ `
varying vec4 vColor;
varying vec2 vQuad;
void main() {
  // A thin hot core with a soft edge, fading to NOTHING behind the head.
  //
  // It used to be flat-topped across (smoothstep from 0.35, so the middle
  // seventy per cent of the width was all at full brightness) and to keep a
  // quarter of that brightness all the way to the end of the quad. Both
  // together drew a wide bar with a squared-off end, which is what a visual review
  // saw up close. A spark is a point of light smeared by its own motion: it
  // is brightest on its centre line and it runs out.
  float across = abs(vQuad.x);
  float body = exp(-across * across * 7.0);
  float tail = clamp(1.0 - vQuad.y, 0.0, 1.0);
  float m = body * tail * tail;
  if (m <= 0.003) discard;
  gl_FragColor = vec4(vColor.rgb * vColor.a * m, 1.0);
${OUTPUT}
}
`

const SMOKE_VERTEX = /* glsl */ `
attribute vec4 pColor;
attribute vec4 pExtra; // size, angle, shape, seed
uniform float uScale;
varying vec4 vColor;
varying vec2 vSpin;
varying float vSeed;
void main() {
  vColor = pColor;
  vSpin = vec2(cos(pExtra.y), sin(pExtra.y));
  vSeed = pExtra.w;
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  bool perspective = projectionMatrix[2][3] == -1.0;
  float depth = perspective ? max(0.0001, -view.z) : 1.0;
  gl_PointSize = max(1.0, pExtra.x * uScale / depth);
  gl_Position = projectionMatrix * view;
}
`

const SMOKE_FRAGMENT = /* glsl */ `
varying vec4 vColor;
varying vec2 vSpin;
varying float vSeed;
float smHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float smNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(smHash(i), smHash(i + vec2(1.0, 0.0)), u.x), mix(smHash(i + vec2(0.0, 1.0)), smHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  p = vec2(p.x * vSpin.x - p.y * vSpin.y, p.x * vSpin.y + p.y * vSpin.x);
  float r = length(p);
  // Not a disc: a soft body torn by two octaves of noise, different for
  // every puff, so a cloud of them is a texture rather than a pile of dots.
  float n = smNoise(p * 2.2 + vSeed * 19.0) * 0.65 + smNoise(p * 5.1 + vSeed * 7.0) * 0.35;
  float body = (1.0 - smoothstep(0.2, 1.0, r)) * smoothstep(0.25, 0.75, n + 0.25 * (1.0 - r));
  if (body <= 0.0) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * body);
${OUTPUT}
}
`

const FLAKE_VERTEX = /* glsl */ `
attribute vec3 aPos;
attribute vec4 aColor;
attribute vec4 aExtra; // size, angle, shape, seed
varying vec2 vQuad;
varying vec4 vColor;
varying float vLight;
varying float vSeed;
mat3 rotation(vec3 axis, float a) {
  float c = cos(a);
  float s = sin(a);
  float t = 1.0 - c;
  return mat3(
    t * axis.x * axis.x + c, t * axis.x * axis.y + s * axis.z, t * axis.x * axis.z - s * axis.y,
    t * axis.x * axis.y - s * axis.z, t * axis.y * axis.y + c, t * axis.y * axis.z + s * axis.x,
    t * axis.x * axis.z + s * axis.y, t * axis.y * axis.z - s * axis.x, t * axis.z * axis.z + c
  );
}
void main() {
  float seed = aExtra.w;
  // Its own tumbling axis, from its seed: flakes do not spin in step.
  vec3 axis = normalize(vec3(sin(seed * 40.0), cos(seed * 23.0), 0.4 + sin(seed * 71.0) * 0.5));
  mat3 r = rotation(axis, aExtra.y);
  // A little curl: burnt paper does not lie flat.
  vec3 local = vec3(position.x, position.y, position.x * position.x * 0.45 - 0.2) * aExtra.x * 0.5;
  vec3 world = aPos + r * local;
  vec3 n = r * vec3(0.0, 0.0, 1.0);
  // Lit by which way it faces — double-sided, so either face catches light.
  vLight = 0.25 + 0.75 * abs(dot(n, normalize(vec3(-0.35, 0.8, 0.5))));
  vQuad = position.xy;
  vColor = aColor;
  vSeed = seed;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`

const FLAKE_FRAGMENT = /* glsl */ `
varying vec2 vQuad;
varying vec4 vColor;
varying float vLight;
varying float vSeed;
float flHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float flNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(flHash(i), flHash(i + vec2(1.0, 0.0)), u.x), mix(flHash(i + vec2(0.0, 1.0)), flHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float r = length(vQuad);
  float a = atan(vQuad.y, vQuad.x);
  // A torn scrap: an outline that wanders, different for every flake.
  float edge = 0.62 + 0.3 * flNoise(vec2(a * 1.6 + vSeed * 31.0, vSeed * 7.0));
  float mask = 1.0 - smoothstep(edge - 0.06, edge, r);
  if (mask <= 0.0) discard;
  // Char in the middle, pale brittle ash at the edge — in patches
  // along it, not all the way round: a flake is a few pixels across, and a
  // continuous pale rim round a dark middle drew it as a hollow ring.
  float rim = smoothstep(edge - 0.32, edge - 0.04, r);
  float patches = smoothstep(0.45, 0.75, flNoise(vec2(a * 2.2 + vSeed * 17.0, vSeed * 13.0)));
  float grain = flNoise(vQuad * 3.0 + vSeed * 23.0);
  vec3 charC = vec3(0.05, 0.043, 0.038) * (0.7 + 0.6 * grain);
  // #A49E9D, sampled from the reference ash, in linear.
  vec3 ashC = vec3(0.372, 0.344, 0.340);
  // Pale ash with char under it, not char with a pale rim.
  //
  // It was the other way round, and the flakes came out near black: at 0.07
  // linear they fell through the hole onto a black stage and read as dust in
  // the void. Burnt paper ash is a LIGHT grey — what makes a flake flash dark
  // and light as it tumbles is vLight, the face it is showing, not its own
  // colour being nearly black to begin with.
  vec3 c = mix(ashC, charC, (1.0 - rim * patches) * 0.45) * vLight;
  // A few carry a hot edge that fades over their first second or so, on ONE
  // arc of it — the side that was burning when it tore off. All the way round
  // drew it as an orange ring.
  float young = clamp((vColor.a - 0.55) / 0.4, 0.0, 1.0);
  float arc = smoothstep(0.25, 0.8, cos(a - vSeed * 40.0));
  float hotEdge = step(vSeed, 0.3) * rim * arc * young;
  c += vec3(2.4, 0.6, 0.08) * hotEdge;
  gl_FragColor = vec4(c, smoothstep(0.0, 0.2, vColor.a) * mask);
${OUTPUT}
}
`

export function FxParticles({ pool }: FxParticlesProps) {
  const embers = useInstanced(pool.capacity, QUAD_STREAK)
  const flakes = useInstanced(pool.capacity, QUAD_FLAKE)
  const smoke = usePoints(pool.capacity)

  const materials = useMemo(
    () => ({
      ember: new THREE.ShaderMaterial({
        vertexShader: EMBER_VERTEX,
        fragmentShader: EMBER_FRAGMENT,
        uniforms: { uResolution: { value: new THREE.Vector2(1, 1) }, uStreak: { value: STREAK } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      smoke: new THREE.ShaderMaterial({
        vertexShader: SMOKE_VERTEX,
        fragmentShader: SMOKE_FRAGMENT,
        uniforms: { uScale: { value: 100 } },
        transparent: true,
        depthWrite: false,
      }),
      flake: new THREE.ShaderMaterial({
        vertexShader: FLAKE_VERTEX,
        fragmentShader: FLAKE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    }),
    [],
  )
  useEffect(
    () => () => {
      materials.ember.dispose()
      materials.smoke.dispose()
      materials.flake.dispose()
    },
    [materials],
  )

  const size = useThree((s) => s.size)

  useFrame(({ gl, camera }) => {
    const counts = pool.write(embers.target, smoke.target, flakes.target)
    embers.geometry.instanceCount = counts.additive
    flakes.geometry.instanceCount = counts.flakes
    smoke.geometry.setDrawRange(0, counts.normal)
    for (const name of ['aPos', 'aVel', 'aColor', 'aExtra'] as const) {
      ;(embers.geometry.attributes[name] as THREE.BufferAttribute).needsUpdate = counts.additive > 0
      ;(flakes.geometry.attributes[name] as THREE.BufferAttribute).needsUpdate = counts.flakes > 0
    }
    if (counts.normal > 0) {
      for (const name of ['position', 'pColor', 'pExtra'] as const) {
        ;(smoke.geometry.attributes[name] as THREE.BufferAttribute).needsUpdate = true
      }
    }
    const ratio = gl.getPixelRatio()
    ;(materials.ember.uniforms.uResolution!.value as THREE.Vector2).set(
      size.width * ratio,
      size.height * ratio,
    )
    const projection = (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5] ?? 1
    materials.smoke.uniforms.uScale!.value = size.height * ratio * 0.5 * projection
  })

  return (
    <>
      <mesh geometry={embers.geometry} material={materials.ember} frustumCulled={false} />
      <points geometry={smoke.geometry} material={materials.smoke} frustumCulled={false} />
      <mesh geometry={flakes.geometry} material={materials.flake} frustumCulled={false} />
    </>
  )
}
