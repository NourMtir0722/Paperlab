import * as THREE from 'three'
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { usePrefersReducedMotion } from '../a11y'
import { getWalkPath, walkPathSchema, type WalkPathOptions } from './path'
import { PROPORTIONS, figureSchema, placeFigure, type FigureOptions } from './gait'

/**
 * The walking silhouette. Capsules, no rig, unlit near-black — see
 * `figure.ts` for why crude is the correct amount of fidelity here.
 *
 * `distance` is the whole interaction model. Leave it off and the figure
 * walks on the clock; drive it from scroll and the page scrolls the walk,
 * which is the same scene doing duty as both a shareable loop and a
 * scroll-driven hero.
 */

export interface FigureProps {
  /** The walk to follow. Defaults to the straight walk away from camera. */
  path?: WalkPathOptions
  /** Height, pace, stride, color — see `figureSchema`. */
  figure?: Partial<FigureOptions>
  /**
   * Distance walked in world units. Omit to advance on the clock at the
   * figure's own speed; supply it to drive the walk from scroll or a timeline.
   */
  distance?: number
  /** Freeze the gait (also forced by `prefers-reduced-motion`). */
  frozen?: boolean
}

/** A limb segment hanging from its joint: a capsule whose top end is the pivot. */
function Segment({ length, radius, material }: { length: number; radius: number; material: THREE.Material }) {
  // CapsuleGeometry's `length` is the cylinder between the caps, so the
  // rounded ends have to come out of the segment's own length.
  const shaft = Math.max(length - radius * 2, 0.001)
  return (
    <mesh position={[0, -length / 2, 0]} material={material} castShadow>
      <capsuleGeometry args={[radius, shaft, 4, 10]} />
    </mesh>
  )
}

export function Figure({ path, figure, distance, frozen }: FigureProps) {
  const reducedMotion = usePrefersReducedMotion()
  const still = frozen ?? reducedMotion

  const options = useMemo(() => figureSchema.parse(figure ?? {}), [figure])
  const walk = useMemo(() => getWalkPath(walkPathSchema.parse(path ?? {})), [path])

  const root = useRef<THREE.Group>(null)
  const hips = useRef<THREE.Group>(null)
  const legL = useRef<THREE.Group>(null)
  const legR = useRef<THREE.Group>(null)
  const kneeL = useRef<THREE.Group>(null)
  const kneeR = useRef<THREE.Group>(null)
  const armL = useRef<THREE.Group>(null)
  const armR = useRef<THREE.Group>(null)

  // One material for the whole body: a silhouette is a single shape, and an
  // unlit one survives a scene lit from behind, where a shaded figure would
  // dissolve into the very haze it has to stand against.
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ color: options.color, toneMapped: false }),
    [options.color],
  )
  useEffect(() => () => material.dispose(), [material])

  const h = options.height
  const p = PROPORTIONS
  const torso = (p.shoulder - p.hip) * h

  useFrame((state) => {
    // A frozen figure still stands wherever `distance` puts it — it stops
    // stepping, it does not teleport to the start of the walk.
    const walked = distance ?? (still ? 0 : state.clock.elapsedTime * options.speed)
    const { position, yaw, pose } = placeFigure(walk, walked, options)

    root.current?.position.set(position[0], position[1], position[2])
    if (root.current) root.current.rotation.y = yaw

    if (hips.current) {
      hips.current.position.y = p.hip * h + (still ? 0 : pose.bob)
      hips.current.rotation.x = pose.lean
    }
    // Limbs hang downward, so a forward swing is a NEGATIVE rotation about X.
    if (legL.current) legL.current.rotation.x = still ? 0 : -pose.leftThigh
    if (legR.current) legR.current.rotation.x = still ? 0 : -pose.rightThigh
    if (kneeL.current) kneeL.current.rotation.x = still ? 0 : -pose.leftKnee
    if (kneeR.current) kneeR.current.rotation.x = still ? 0 : -pose.rightKnee
    if (armL.current) armL.current.rotation.x = still ? 0 : -pose.leftArm
    if (armR.current) armR.current.rotation.x = still ? 0 : -pose.rightArm
  })

  return (
    <group ref={root}>
      <group ref={hips}>
        <mesh position={[0, torso / 2, 0]} material={material} castShadow>
          <capsuleGeometry args={[(p.torsoWidth * h) / 2, torso * 0.72, 4, 12]} />
        </mesh>
        <mesh position={[0, (p.headCenter - p.hip) * h, 0]} material={material} castShadow>
          <sphereGeometry args={[p.headRadius * h, 14, 12]} />
        </mesh>

        {[-1, 1].map((side) => {
          const leg = side < 0 ? legL : legR
          const knee = side < 0 ? kneeL : kneeR
          return (
            <group key={`leg${side}`} ref={leg} position={[(side * p.hipWidth * h) / 2, 0, 0]}>
              <Segment length={p.thigh * h} radius={p.limbRadius * h} material={material} />
              <group ref={knee} position={[0, -p.thigh * h, 0]}>
                <Segment length={p.shin * h} radius={p.limbRadius * h * 0.9} material={material} />
              </group>
            </group>
          )
        })}

        {[-1, 1].map((side) => (
          <group
            key={`arm${side}`}
            ref={side < 0 ? armL : armR}
            position={[(side * p.torsoWidth * h) / 2, torso, 0]}
          >
            <Segment
              length={(p.upperArm + p.foreArm) * h}
              radius={p.limbRadius * h * 0.8}
              material={material}
            />
          </group>
        ))}
      </group>
    </group>
  )
}
