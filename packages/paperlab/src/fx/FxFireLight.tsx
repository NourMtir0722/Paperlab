import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { DamageField } from './field'
import type { SurfaceLocator } from './fire'
import { flameAnchors, flamePuff, type FlameAnchor } from './flames'

export interface FxFireLightProps {
  field: DamageField
  locate: SurfaceLocator
  /** How bright the fire is per unit of burning front. Tuned against Hero.png. */
  gain?: number
}

/**
 * Fire is a light source (§4.8, §7). A fire that changes nothing around it
 * looks pasted on.
 *
 * A warm point light — about 1900 K — at the middle of the burning rim,
 * raised by half a flame, as bright as the front is long and flickering on
 * the very noise the flames puff on, so light and flame agree. It reaches the
 * whole sheet: `decay` is held below the physical 2, because a sheet is a
 * small thing next to a fire and Hero.png warms it to the top edge.
 *
 * And a dimmer twin on the FAR side of the sheet, for translucency: paper is
 * thin, and a fire in front of it glows through to the back, warm and
 * diffused (§7). A second light is the whole trick — the sheet's own
 * material already lights its back face from whatever is behind it.
 */
export function FxFireLight({ field, locate, gain = FIRE_LIGHT_GAIN }: FxFireLightProps) {
  const front = useRef<THREE.PointLight>(null)
  const through = useRef<THREE.PointLight>(null)
  const anchors = useRef<FlameAnchor[]>([])

  useFrame(({ camera }) => {
    const a = front.current
    const b = through.current
    if (!a || !b) return
    const n = flameAnchors(field, locate, 32, anchors.current)
    if (n === 0) {
      a.intensity = 0
      b.intensity = 0
      return
    }
    let x = 0
    let y = 0
    let z = 0
    let h = 0
    let flicker = 0
    for (let i = 0; i < n; i++) {
      const f = anchors.current[i]!
      x += f.x
      y += f.y
      z += f.z
      h += f.height
      flicker += flamePuff(f.seed, field.time)
    }
    x /= n
    y /= n
    z /= n
    h /= n
    flicker /= n
    // Off the sheet toward whoever is looking, a little; its twin the same
    // distance behind.
    const toCamera = new THREE.Vector3(camera.position.x - x, 0, camera.position.z - z)
    toCamera.normalize().multiplyScalar(0.035)
    const lift = h * 0.5
    a.position.set(x + toCamera.x, y + lift, z + toCamera.z)
    b.position.set(x - toCamera.x, y + lift, z - toCamera.z)
    const level = field.lastStats.front * gain * flicker
    a.intensity = level
    b.intensity = level * 0.35
  })

  return (
    <>
      <pointLight ref={front} color={FIRE_COLOR} intensity={0} decay={0.9} distance={0} />
      <pointLight ref={through} color={FIRE_COLOR} intensity={0} decay={0.9} distance={0} />
    </>
  )
}

/** ~1900 K. */
// Peach rather than red: a red-heavy light on white paper is exactly what
// the tone curve turns salmon — the pink the spec forbids.
const FIRE_COLOR = new THREE.Color('#ffa24c')

/** Light per unit of front length; the front runs to ~0.045 at a burn's peak. */
export const FIRE_LIGHT_GAIN = 42
