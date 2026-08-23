import * as THREE from 'three'
import { useEffect, useMemo, useRef } from 'react'
import { getLayout, type PaperPose } from '../field/layouts'

/**
 * What holds the paper up.
 *
 * Every paper installation shows its hardware — monofilament from a ceiling
 * grid, steel wire, bulldog clips, a rod — and in the scattered-sheet pieces
 * the threads are half the composition. Stage mode's banners hung from
 * nothing at all, which is a larger realism gap than any shader in the
 * backlog and closes for a few thin lines of geometry: a hung thing that
 * shows what suspends it stops reading as a rectangle that happens to float.
 *
 * Both parts are ONE draw call each. The threads are a single `LineSegments`
 * buffer rather than N line meshes, and the clips are an `InstancedMesh`,
 * because a field of forty banners is drawn in one call and it would be
 * absurd for the string holding them up to cost eighty more.
 */

const euler = (pose: PaperPose) => new THREE.Euler(pose.rotation[0], pose.rotation[1], pose.rotation[2])

/**
 * How long a sheet's rod is. A little wider than the paper, because a dowel
 * cut flush with the sheet reads as part of the sheet.
 */
export function rodLength(sheet: { width: number }, pose: PaperPose): number {
  return sheet.width * pose.scale * 1.22
}

/** Where a pose's top edge is, in world space. Exported to be tested. */
export function topOfSheet(pose: PaperPose, paperHeight: number): THREE.Vector3 {
  const half = (paperHeight * pose.scale) / 2
  // The sheet's local +Y, rotated the way the pose rotates it. A banner
  // twisted on its vertical axis still hangs from its own top edge, not from
  // a point directly above its centre.
  const up = new THREE.Vector3(0, half, 0).applyEuler(
    new THREE.Euler(pose.rotation[0], pose.rotation[1], pose.rotation[2]),
  )
  return new THREE.Vector3(...pose.position).add(up)
}

export function Suspension({
  layout,
  layoutOptions,
  count,
  sheet,
  paperHeight,
  ceiling,
  color,
  type,
  hardware,
}: {
  layout: string
  layoutOptions: Record<string, unknown>
  count: number
  sheet: { width: number; height: number }
  paperHeight: number
  /** Height the threads anchor at — the ceiling, or the top of the room. */
  ceiling: number
  color: string
  /** `thread` hangs each sheet on a line; `rod` hangs it on a dowel. */
  type: 'thread' | 'rod'
  hardware: 'none' | 'clip' | 'peg'
}) {
  const poses = useMemo(() => {
    const entry = getLayout(layout)
    if (!entry) return []
    const options = entry.optionsSchema.parse(layoutOptions)
    // `phase: 0` — suspension is hardware, not motion. It hangs where the
    // layout's resting pose puts it and does not animate with the field.
    return Array.from({ length: count }, (_, i) => entry.pose(i, count, options, 0, sheet))
  }, [layout, layoutOptions, count, sheet])

  const geometry = useMemo(() => {
    const points: number[] = []
    const end = new THREE.Vector3()
    for (const pose of poses) {
      const top = topOfSheet(pose, paperHeight)
      // Straight up to the ceiling. A thread under tension is a straight
      // line, and the moment it is drawn with any sag it reads as rope.
      if (top.y >= ceiling) continue
      if (type === 'rod') {
        // A rod hung from one line in the middle would tip, and the eye
        // knows it. Two lines, to the rod's own ends.
        const half = rodLength(sheet, pose) / 2
        for (const side of [-1, 1] as const) {
          end
            .set(side * half, 0, 0)
            .applyEuler(euler(pose))
            .add(top)
          points.push(end.x, ceiling, end.z, end.x, end.y, end.z)
        }
      } else {
        points.push(top.x, ceiling, top.z, top.x, top.y, top.z)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
    return g
  }, [poses, paperHeight, ceiling, type, sheet])

  useEffect(() => () => geometry.dispose(), [geometry])

  const clipRef = useRef<THREE.InstancedMesh>(null)
  const rodRef = useRef<THREE.InstancedMesh>(null)

  // Modelled lying down once, rather than rotated in an `onUpdate` — that
  // callback runs again on every re-render, and a rotation applied to the
  // same geometry twice is a rod pointing somewhere new each time.
  const rodGeometry = useMemo(() => {
    const r = sheet.width * 0.018
    const g = new THREE.CylinderGeometry(r, r, sheet.width * 1.22, 8)
    g.rotateZ(Math.PI / 2)
    return g
  }, [sheet.width])
  useEffect(() => () => rodGeometry.dispose(), [rodGeometry])
  useEffect(() => {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const at = new THREE.Vector3()
    const size = new THREE.Vector3()
    const place = (mesh: THREE.InstancedMesh | null, lift: number) => {
      if (!mesh) return
      poses.forEach((pose, i) => {
        const top = topOfSheet(pose, paperHeight)
        q.setFromEuler(euler(pose))
        at.set(top.x, top.y + lift, top.z)
        // Hardware scales with the sheet it holds. A layout that shrinks the
        // banners at the far end of a walk and leaves their clips full size
        // has just told the viewer how far away they are not.
        size.setScalar(pose.scale)
        m.compose(at, q, size)
        mesh.setMatrixAt(i, m)
      })
      mesh.instanceMatrix.needsUpdate = true
      mesh.count = poses.length
    }
    place(clipRef.current, 0)
    // The rod sits ON the top edge rather than through it — paper hangs from
    // a rod, it is not skewered by one.
    place(rodRef.current, sheet.height * 0.004)
  }, [poses, paperHeight, sheet.height])

  if (poses.length === 0) return null

  return (
    <group>
      {/*
        `toneMapped` is left ON, unlike the source: a thread is an object in
        the room and has to sit in the same grade as everything else. It is
        also deliberately not shadow-casting — a shadow map at this scale
        renders a monofilament as a black bar across the floor, which is far
        more visible than the thread itself and completely wrong.
      */}
      <lineSegments geometry={geometry}>
        <lineBasicMaterial color={color} transparent opacity={0.42} />
      </lineSegments>

      {type === 'rod' && (
        <instancedMesh ref={rodRef} args={[undefined, undefined, Math.max(poses.length, 1)]} castShadow>
          {/* Along the sheet's own width, so a twisted banner's rod is
              twisted with it. `rotation` on the geometry rather than on
              every instance: the dowel is modelled lying down once. */}
          <primitive object={rodGeometry} attach="geometry" />
          <meshStandardMaterial color={color} roughness={0.7} metalness={0.15} />
        </instancedMesh>
      )}

      {hardware !== 'none' && (
        <instancedMesh ref={clipRef} args={[undefined, undefined, Math.max(poses.length, 1)]} castShadow>
          {/* Sized off the sheet, not in world units, so hardware on a
              postage stamp and hardware on an eight-metre banner both read as
              hardware. A clip is wide and shallow — it grips the edge. A peg
              is narrow and deep — it grips down the face. That difference is
              the whole silhouette, and the silhouette is all that survives
              the distance this scene works at. */}
          {hardware === 'peg' ? (
            <boxGeometry args={[sheet.width * 0.055, sheet.height * 0.038, sheet.width * 0.05]} />
          ) : (
            <boxGeometry args={[sheet.width * 0.13, sheet.height * 0.016, sheet.width * 0.05]} />
          )}
          <meshStandardMaterial
            color={color}
            roughness={hardware === 'peg' ? 0.85 : 0.45}
            metalness={hardware === 'peg' ? 0 : 0.6}
          />
        </instancedMesh>
      )}
    </group>
  )
}
