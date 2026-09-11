import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { ParticlePool, ParticleTarget } from './particles'

/**
 * The pool, drawn — two draw calls for the whole fire.
 *
 * Points rather than an instanced mesh of quads. A point is already a
 * camera-facing sprite: no per-particle matrix to build on the CPU, no
 * billboarding maths, one vertex each. What a quad would buy is a sprite that
 * can be stretched or lit, and neither embers nor ash want that — they want to
 * be small, numerous and cheap on a phone that is also running a camera and a
 * hand tracker.
 *
 * Two calls and not one because light and matter blend differently: an ember
 * ADDS to what is behind it and smoke covers it. Neither writes depth — a
 * cloud of particles that occluded each other would flicker as they sort —
 * but both TEST it, so the sheet hides the smoke behind it.
 *
 * This only draws. The page owns the order — field, then emitters, then the
 * pool's own step — because only the page knows which field belongs to which
 * sheet, and a component that stepped the simulation while drawing it would
 * step it once per `<FxParticles>` on the page.
 */

export interface FxParticlesProps {
  pool: ParticlePool
}

const VERTEX = /* glsl */ `
attribute vec4 pColor;
// size in world units, spin angle, shape (0 soft, 1 flake), seed
attribute vec4 pExtra;
uniform float uScale;
varying vec4 vColor;
varying vec3 vExtra;

void main() {
  vColor = pColor;
  vExtra = pExtra.yzw;
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  // A diameter in world units, drawn in pixels: the camera's own scale, so a
  // flake is the same size in the world however far away it is.
  //
  // Perspective divides by depth and orthographic has no depth to divide by —
  // ask which, the way three's own shaders do. uScale is right for both: the
  // projection's vertical scale times half the framebuffer's height, which is
  // pixels per world unit at unit depth under perspective, and pixels per
  // world unit outright under orthographic. (No backticks in here: this is a
  // template literal, and one would end it.)
  bool perspective = projectionMatrix[2][3] == -1.0;
  float depth = perspective ? max(0.0001, -view.z) : 1.0;
  gl_PointSize = max(1.0, pExtra.x * uScale / depth);
  gl_Position = projectionMatrix * view;
}
`

const FRAGMENT = /* glsl */ `
varying vec4 vColor;
varying vec3 vExtra;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float angle = vExtra.x;
  float c = cos(angle);
  float s = sin(angle);
  p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  float r = length(p);
  float mask;
  if (vExtra.y > 0.5) {
    // A flake: a torn scrap of paper, not a dot. Three lobes off a seeded
    // phase, so no two are the same shape, with a hard-ish edge — burnt paper
    // has corners.
    float lobes = 0.62 + 0.3 * sin(atan(p.y, p.x) * 3.0 + vExtra.z * 43.0);
    mask = 1.0 - smoothstep(lobes - 0.12, lobes, r);
  } else {
    // A soft disc, squared so the falloff is thicker in the middle than a
    // linear one: an ember reads as a point of light, smoke as a puff.
    float d = 1.0 - smoothstep(0.0, 1.0, r);
    mask = d * d;
  }
  if (mask <= 0.0) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * mask);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/** One blend mode's buffers and geometry, sized for the pool once. */
function useLayer(capacity: number) {
  const layer = useMemo(() => {
    const target: ParticleTarget = {
      position: new Float32Array(capacity * 3),
      color: new Float32Array(capacity * 4),
      extra: new Float32Array(capacity * 4),
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(target.position, 3))
    geometry.setAttribute('pColor', new THREE.BufferAttribute(target.color, 4))
    geometry.setAttribute('pExtra', new THREE.BufferAttribute(target.extra, 4))
    geometry.setDrawRange(0, 0)
    // Particles travel wherever the air takes them, and a bounding sphere
    // computed from a buffer that changes every frame is a per-frame walk of
    // the whole buffer to save a cull that never fires.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)
    return { target, geometry }
  }, [capacity])
  useEffect(() => () => layer.geometry.dispose(), [layer])
  return layer
}

export function FxParticles({ pool }: FxParticlesProps) {
  const additive = useLayer(pool.capacity)
  const normal = useLayer(pool.capacity)
  const uniforms = useMemo(() => ({ uScale: { value: 100 } }), [])

  const materials = useMemo(() => {
    const base = {
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms,
      transparent: true,
      depthWrite: false,
    }
    return {
      additive: new THREE.ShaderMaterial({ ...base, blending: THREE.AdditiveBlending }),
      normal: new THREE.ShaderMaterial({ ...base, blending: THREE.NormalBlending }),
    }
  }, [uniforms])
  useEffect(
    () => () => {
      materials.additive.dispose()
      materials.normal.dispose()
    },
    [materials],
  )

  const size = useThree((s) => s.size)

  useFrame(({ gl, camera }) => {
    const counts = pool.write(additive.target, normal.target)
    for (const [layer, count] of [
      [additive, counts.additive],
      [normal, counts.normal],
    ] as const) {
      layer.geometry.setDrawRange(0, count)
      if (count === 0) continue
      // The whole buffer, not the live range: at the tier's ceiling this is
      // tens of kilobytes a frame, and a partial-upload API that has been
      // renamed twice in three's recent past is not worth pinning to.
      for (const name of ['position', 'pColor', 'pExtra'] as const) {
        ;(layer.geometry.attributes[name] as THREE.BufferAttribute).needsUpdate = true
      }
    }
    // Pixels per world unit at one unit of depth: half the framebuffer's
    // height times the projection's vertical scale. Read each frame, so a
    // resize or a zoom cannot leave the sprites the wrong size.
    const projection = (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5] ?? 1
    uniforms.uScale.value = size.height * gl.getPixelRatio() * 0.5 * projection
  })

  return (
    <>
      <points frustumCulled={false} geometry={additive.geometry} material={materials.additive} />
      <points frustumCulled={false} geometry={normal.geometry} material={materials.normal} />
    </>
  )
}
