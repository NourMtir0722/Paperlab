import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { DamageField } from './field'
import type { SurfaceLocator } from './fire'
import { FIRE_CLUSTERS, fireStateOf } from './fireState'

export interface FxFireLightProps {
  field: DamageField
  locate: SurfaceLocator
  /** How bright the fire is per unit of burning front. */
  gain?: number
}

/**
 * Fire is a light source (§4.8, §7). A fire that changes nothing around it
 * looks pasted on.
 *
 * One warm point light for each place the fire is gathered — up to
 * {@link FIRE_CLUSTERS} of them, from {@link fireStateOf} — standing at its
 * cluster raised by half a flame, as bright as its share of the fire and
 * flickering on its own tongues' puff. A tall tongue on the left lights the
 * left. It used to be one light at the middle of the whole rim, which lit the
 * sheet the same wherever the flames actually were.
 *
 * Each light's colour follows how hot the paper under its tongues is: the
 * pale peach of a fire at its height, deepening toward orange as it cools —
 * never toward red, which on white paper is the pink the spec forbids.
 * Together they give off what the single light did: the front's length times
 * `gain`, shared out.
 *
 * And one dimmer light on the FAR side of the sheet, at the fire as a whole,
 * for translucency: paper is thin, and a fire in front of it glows through to
 * the back (§7). The sheet's own material lights its back face from whatever
 * is behind it.
 *
 * Every light is mounted all the time and only its intensity changes, so a
 * fire gathering into more places or fewer never makes three recompile a
 * shader.
 */
export function FxFireLight({ field, locate, gain = FIRE_LIGHT_GAIN }: FxFireLightProps) {
  const front = useRef<(THREE.PointLight | null)[]>([])
  const through = useRef<THREE.PointLight>(null)

  useFrame(({ camera, clock }) => {
    const b = through.current
    if (!b) return
    const fire = fireStateOf(field, locate).update(clock.elapsedTime)
    const level = field.lastStats.front * gain
    let total = 0
    for (let c = 0; c < fire.clusterCount; c++) {
      const cluster = fire.clusters[c]!
      total += cluster.count * cluster.height
    }
    for (let i = 0; i < FIRE_CLUSTERS; i++) {
      const light = front.current[i]
      if (!light) continue
      const cluster = i < fire.clusterCount ? fire.clusters[i]! : null
      if (!cluster || !(total > 0)) {
        light.intensity = 0
        continue
      }
      // Off the sheet toward whoever is looking, a little.
      toward
        .set(camera.position.x - cluster.x, 0, camera.position.z - cluster.z)
        .normalize()
        .multiplyScalar(0.035)
      light.position.set(cluster.x + toward.x, cluster.y + cluster.height * 0.5, cluster.z + toward.z)
      light.intensity = level * cluster.flicker * ((cluster.count * cluster.height) / total)
      light.color.copy(COOLING).lerp(FIRE_COLOR, Math.min(1, Math.max(0, cluster.heat)))
    }
    if (fire.count === 0) {
      b.intensity = 0
      return
    }
    toward
      .set(camera.position.x - fire.x, 0, camera.position.z - fire.z)
      .normalize()
      .multiplyScalar(0.035)
    b.position.set(fire.x - toward.x, fire.y + fire.height * 0.5, fire.z - toward.z)
    b.intensity = level * fire.flicker * 0.35
  })

  return (
    <>
      {Array.from({ length: FIRE_CLUSTERS }, (_, i) => (
        <pointLight
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed set of lights, one per cluster slot.
          key={i}
          ref={(light) => {
            front.current[i] = light
          }}
          color={FIRE_COLOR}
          intensity={0}
          decay={0.9}
          distance={0}
        />
      ))}
      <pointLight ref={through} color={FIRE_COLOR} intensity={0} decay={0.9} distance={0} />
    </>
  )
}

const toward = new THREE.Vector3()

/** ~1900 K, a fire at its height. */
// Peach rather than red: a red-heavy light on white paper is exactly what
// the tone curve turns salmon — the pink the spec forbids.
const FIRE_COLOR = new THREE.Color('#ffa24c')

/**
 * A cooling fire's light: deeper orange, and no further. The red end of a
 * blackbody is where white paper turns salmon, so the cooling stops here —
 * `pnpm test:fire-budget` checks for pink as the fire dies, when it is here.
 */
const COOLING = new THREE.Color('#ff8a33')

/**
 * Light per unit of front length; the front runs to ~0.045 at a burn's peak.
 * Noor's tune, 2026-09-13 (it was 42).
 */
export const FIRE_LIGHT_GAIN = 26
