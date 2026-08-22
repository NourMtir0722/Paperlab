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
  clips,
}: {
  layout: string
  layoutOptions: Record<string, unknown>
  count: number
  sheet: { width: number; height: number }
  paperHeight: number
  /** Height the threads anchor at — the ceiling, or the top of the room. */
  ceiling: number
  color: string
  clips: boolean
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
    for (const pose of poses) {
      const top = topOfSheet(pose, paperHeight)
      // Straight up to the ceiling. A thread under tension is a straight
      // line, and the moment it is drawn with any sag it reads as rope.
      if (top.y >= ceiling) continue
      points.push(top.x, ceiling, top.z, top.x, top.y, top.z)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
    return g
  }, [poses, paperHeight, ceiling])

  useEffect(() => () => geometry.dispose(), [geometry])

  const clipRef = useRef<THREE.InstancedMesh>(null)
  useEffect(() => {
    const mesh = clipRef.current
    if (!mesh) return
    const m = new THREE.Matrix4()
    poses.forEach((pose, i) => {
      const top = topOfSheet(pose, paperHeight)
      m.makeRotationFromEuler(new THREE.Euler(pose.rotation[0], pose.rotation[1], pose.rotation[2]))
      m.setPosition(top.x, top.y, top.z)
      mesh.setMatrixAt(i, m)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.count = poses.length
  }, [poses, paperHeight])

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

      {clips && (
        <instancedMesh ref={clipRef} args={[undefined, undefined, Math.max(poses.length, 1)]} castShadow>
          {/* Sized off the sheet, not in world units, so a clip on a postage
              stamp and a clip on an eight-metre banner both look like a clip. */}
          <boxGeometry args={[sheet.width * 0.13, sheet.height * 0.016, sheet.width * 0.05]} />
          <meshStandardMaterial color={color} roughness={0.45} metalness={0.6} />
        </instancedMesh>
      )}
    </group>
  )
}
