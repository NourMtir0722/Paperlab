import type * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { DamageField } from './field'
import type { SurfaceLocator } from './fire'
import { flameAnchors, type FlameAnchor } from './flames'
import { flameGeometry, flameMaterial } from './flameShader'
import { fxQualityFor, type FxQualityTier } from './quality'

export interface FxFlamesProps {
  /** The burning field. Flames stand on its hot rim — see `flameAnchors`. */
  field: DamageField
  /** Where a point of the sheet is in the world — `(u, v) => handle.surfacePoint(u, v, scratch)`. */
  locate: SurfaceLocator
  /** How many flames may stand at once: 8 / 16 / 32 on low / medium / high. */
  quality?: FxQualityTier
  /**
   * The air, world units a second — pass the particle pool's `wind`, which is
   * read every frame. Flames lean away from it and shorten (§10.6).
   */
  wind?: readonly [number, number, number]
}

/**
 * The flames of a burn: separate tongues of burning gas, standing just off
 * the char, rising straight up whatever the sheet is doing.
 *
 * `paperlab-fx-fire-spec.md` §6. Each tongue is a quad that turns to face the
 * camera about WORLD up — never the sheet's normal (§13.9) — so a flame on a
 * sheet held flat still rises to the ceiling. The shader is upward-scrolling,
 * domain-warped noise inside a teardrop, coloured on the flame's own
 * blackbody ramp: a dim indigo root, a yellow-white core, orange edges and
 * tips, and a torn top that sheds wisps. Every flame puffs on its own noise
 * at 10–15 Hz, so no two ever move in step and nothing is a sine.
 *
 * Additive and HDR: the core is several times paper white, so `FxPost`
 * blooms it; it writes no depth, so the flames never occlude each other or
 * flicker as they sort. It animates on the FIELD's clock, so a replayed burn
 * burns with the same flames.
 */
export function FxFlames({ field, locate, quality = 'medium', wind }: FxFlamesProps) {
  const max = fxQualityFor(quality).flames
  const anchors = useRef<FlameAnchor[]>([])

  const geometry = useMemo(() => flameGeometry(max), [max])
  useEffect(() => () => geometry.dispose(), [geometry])
  const material = useMemo(() => flameMaterial(), [])
  useEffect(() => () => material.dispose(), [material])

  useFrame(() => {
    const n = flameAnchors(field, locate, max, anchors.current)
    const base = geometry.getAttribute('aBase') as THREE.InstancedBufferAttribute
    const shape = geometry.getAttribute('aShape') as THREE.InstancedBufferAttribute
    // The air leans them, and a strong wind shortens them — the tip is
    // blown away faster than the gas can climb.
    const [wx, wy, wz] = wind ?? [0, 0, 0]
    const gust = Math.hypot(wx, wy, wz)
    const shorten = 1 / (1 + gust * 0.6)
    for (let i = 0; i < n; i++) {
      const a = anchors.current[i]!
      base.array[i * 3] = a.x
      base.array[i * 3 + 1] = a.y
      base.array[i * 3 + 2] = a.z
      shape.array[i * 4] = a.height * shorten
      shape.array[i * 4 + 1] = a.width
      shape.array[i * 4 + 2] = a.seed
      shape.array[i * 4 + 3] = a.heat
    }
    base.needsUpdate = true
    shape.needsUpdate = true
    geometry.instanceCount = n
    material.uniforms.uTime!.value = field.time
    ;(material.uniforms.uLean!.value as THREE.Vector3).set(wx * 0.5, 0, wz * 0.5)
  })

  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={2} />
}
