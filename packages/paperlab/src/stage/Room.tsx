import * as THREE from 'three'
import { useEffect, useMemo, useRef } from 'react'
import type { WalkPath } from './path'

/**
 * The architecture: a ceiling, and a floor with seams in it.
 *
 * Stage mode was a void with a horizon — a graded dome, a flat plane, and a
 * bright rectangle at the end. Nothing in it had a knowable size, which is
 * why the walking figure was carrying the entire scale burden on its own and
 * why removing it left the hall reading as an abstraction rather than a room.
 *
 * The fix is not a bigger light or more banners. It is putting objects in
 * frame whose size the viewer already knows. A concrete floor is poured in
 * slabs, and a slab is about two and a half metres; a ceiling is about three
 * above your head. Give a picture those two and it stops being a gradient
 * and starts being somewhere — and both are flat surfaces under good light,
 * which is the one thing a renderer never gets wrong.
 */

/**
 * The floor, drawn as poured slabs.
 *
 * A repeating texture rather than geometry: the seams have to run to the
 * horizon, and a mesh dense enough to carry them that far would be paying
 * vertices for something a wrapped texture does for free.
 */
export function makeFloorTexture(color: string, repeats: number): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = color
  ctx.fillRect(0, 0, size, size)

  // The seam is a shadow in a gap, not a drawn line — so it is darker than
  // the floor by a little, twice, with the softer pass wider. A hairline of
  // pure black reads as ink on concrete rather than as a joint between two
  // pours.
  const base = new THREE.Color(color)
  const dark = base.clone().multiplyScalar(0.55)
  const softer = base.clone().multiplyScalar(0.78)
  const css = (c: THREE.Color) => `rgb(${(c.r * 255) | 0}, ${(c.g * 255) | 0}, ${(c.b * 255) | 0})`

  ctx.strokeStyle = css(softer)
  ctx.lineWidth = 5
  ctx.strokeRect(0, 0, size, size)
  ctx.strokeStyle = css(dark)
  ctx.lineWidth = 1.5
  ctx.strokeRect(0, 0, size, size)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(repeats, repeats)
  texture.anisotropy = 8
  return texture
}

export function Floor({
  size,
  color,
  slab,
}: {
  size: number
  color: string
  /** World units across one poured slab. 0 draws an unseamed floor. */
  slab: number
}) {
  const repeats = slab > 0 ? Math.max(1, Math.round(size / slab)) : 0
  const texture = useMemo(() => (repeats > 0 ? makeFloorTexture(color, repeats) : null), [color, repeats])
  useEffect(() => () => texture?.dispose(), [texture])

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[size, size]} />
      {/* `map` tints itself by `color`, so the base colour is already in the
          canvas and the material's own colour stays white. */}
      <meshStandardMaterial map={texture} color={texture ? '#ffffff' : color} roughness={1} />
    </mesh>
  )
}

/**
 * The lid.
 *
 * Two things it fixes, and the second is the one worth having. It gives the
 * haze somewhere to END — fog against an open sky has no far surface to
 * settle on, which is why the top of frame graded to nothing. And it puts a
 * horizontal plane above the walk for the source to spill onto, which is how
 * every one of the reference installations reads as interior: you can see
 * the light landing on the ceiling.
 */
export function Ceiling({ size, height, color }: { size: number; height: number; color: string }) {
  return (
    <mesh position={[0, height, 0]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial color={color} roughness={1} side={THREE.FrontSide} />
    </mesh>
  )
}

/**
 * Columns down the walk, each with a base plate and a capital.
 *
 * The one piece of architecture that stands IN the room rather than bounding
 * it. A ceiling and floor seams say where the space stops; a column says how
 * big it is, because you already know how wide a column is and how far apart
 * they get built. That is the reading the walking figure used to give, from
 * an object a renderer cannot get wrong.
 *
 * Square piers, not turned columns. Flat surfaces under good light is the
 * whole brief, a box has six of them, and at the distances this scene works
 * at a fluted shaft would cost geometry to deliver a silhouette nobody can
 * resolve. The base plate is the part that matters most: it is the only
 * element in the scene that puts a hard horizontal edge at a KNOWN height
 * off the floor, which is what makes the floor read as a floor.
 *
 * Three instanced meshes — shaft, base, capital — so a hundred-metre
 * colonnade is three draw calls whatever its length.
 */
export function Columns({
  path,
  ceiling,
  spacing,
  width,
  offset,
  color,
}: {
  path: WalkPath
  ceiling: number
  spacing: number
  width: number
  offset: number
  color: string
}) {
  const placements = useMemo(() => {
    if (!(spacing > 0) || !(path.length > 0)) return []
    // Bays measured along the walk's arc length, so a bent or spiral path
    // gets evenly-spaced columns rather than evenly-spaced parameter values.
    const bays = Math.max(1, Math.round(path.length / spacing))
    const out: { position: [number, number, number]; yaw: number }[] = []
    for (let i = 0; i <= bays; i++) {
      const s = i / bays
      const [px, pz] = path.pointAt(s)
      const [nx, nz] = path.normalAt(s)
      const [tx, tz] = path.tangentAt(s)
      // Square to the walk, so a colonnade on a bend still reads as built
      // rather than as scattered.
      const yaw = Math.atan2(tx, tz)
      for (const side of [-1, 1] as const) {
        out.push({ position: [px + nx * side * offset, 0, pz + nz * side * offset], yaw })
      }
    }
    return out
  }, [path, spacing, offset])

  const shaft = useRef<THREE.InstancedMesh>(null)
  const base = useRef<THREE.InstancedMesh>(null)
  const capital = useRef<THREE.InstancedMesh>(null)

  // A base plate is a slab a little wider than the shaft and about a hand
  // deep. Those proportions are what make it read as a plinth rather than as
  // a step, and they are the reason the column carries scale at all.
  const plate = width * 1.45
  const plateHeight = width * 0.24

  useEffect(() => {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const scale = new THREE.Vector3(1, 1, 1)
    const put = (mesh: THREE.InstancedMesh | null, y: number) => {
      if (!mesh) return
      placements.forEach((p, i) => {
        q.setFromEuler(new THREE.Euler(0, p.yaw, 0))
        m.compose(new THREE.Vector3(p.position[0], y, p.position[2]), q, scale)
        mesh.setMatrixAt(i, m)
      })
      mesh.instanceMatrix.needsUpdate = true
      mesh.count = placements.length
    }
    put(shaft.current, ceiling / 2)
    put(base.current, plateHeight / 2)
    put(capital.current, ceiling - plateHeight / 2)
  }, [placements, ceiling, plateHeight])

  if (placements.length === 0) return null
  const n = placements.length

  return (
    <group>
      <instancedMesh ref={shaft} args={[undefined, undefined, n]} castShadow receiveShadow>
        <boxGeometry args={[width, ceiling, width]} />
        <meshStandardMaterial color={color} roughness={0.92} />
      </instancedMesh>
      <instancedMesh ref={base} args={[undefined, undefined, n]} castShadow receiveShadow>
        <boxGeometry args={[plate, plateHeight, plate]} />
        <meshStandardMaterial color={color} roughness={0.92} />
      </instancedMesh>
      <instancedMesh ref={capital} args={[undefined, undefined, n]} castShadow receiveShadow>
        <boxGeometry args={[plate, plateHeight, plate]} />
        <meshStandardMaterial color={color} roughness={0.92} />
      </instancedMesh>
    </group>
  )
}

/**
 * The end wall, with a hole in it for the source.
 *
 * A bright rectangle in a void reads as light but not as light *from*
 * anywhere. Put a wall around it and the same rectangle is a doorway: the
 * walk now resolves toward an opening in a surface, the surface meets the
 * floor and the ceiling, and the room finally has the corner it never had.
 *
 * Built as one shape with one hole rather than four quads around a gap,
 * because four quads have three seams that have to be kept in register with
 * the source every time either of them is tuned, and a hole cannot drift.
 */
/** How far the wall stands off the source plane, in world units. */
const NUDGE = 0.08

export function Doorway({
  position,
  yaw,
  size,
  opening,
  color,
  extent,
}: {
  position: readonly [number, number, number]
  yaw: number
  /** The source's own half-size, as `Source` uses it. */
  size: number
  opening: number
  color: string
  /** How far the wall runs — far enough to leave the frame. */
  extent: number
}) {
  const geometry = useMemo(() => {
    // `Source` draws a plane of (size × 2.4, size × 1.8) centred on its
    // position, so the opening is that, scaled — matched here rather than
    // guessed, since a doorway a little smaller than its light is a bright
    // line around a door and a little larger is a shadow gap.
    const w = size * 2.4 * opening
    const h = size * 1.8 * opening
    // The outer contour runs well BELOW the floor, not down to it. A hole
    // has to sit strictly inside its shape — the opening's sill is below the
    // floor line so that a doorway reads as reaching the ground rather than
    // as a window, and a hole poking out through the bottom edge does not
    // get cut at all: the triangulator drops it and the wall comes back
    // solid, which is exactly what it did. Everything under the floor is
    // covered by the floor.
    const shape = new THREE.Shape()
    shape.moveTo(-extent, -extent)
    shape.lineTo(extent, -extent)
    shape.lineTo(extent, extent)
    shape.lineTo(-extent, extent)
    shape.closePath()
    const hole = new THREE.Path()
    hole.moveTo(-w / 2, -h / 2)
    hole.lineTo(w / 2, -h / 2)
    hole.lineTo(w / 2, h / 2)
    hole.lineTo(-w / 2, h / 2)
    hole.closePath()
    shape.holes.push(hole)
    return new THREE.ShapeGeometry(shape)
  }, [size, opening, extent])

  useEffect(() => () => geometry.dispose(), [geometry])

  // A hair in front of the source, toward the walk. Coplanar they fight for
  // the same pixels and the winner is whichever the depth buffer rounded up
  // that frame, which across a whole wall is a moiré of stripes — and it is
  // the brightest part of the frame, so there is nowhere for it to hide.
  // The source's own normal, since it is the plane being cleared.
  const stood = useMemo<[number, number, number]>(
    () => [position[0] + Math.sin(yaw) * NUDGE, position[1], position[2] + Math.cos(yaw) * NUDGE],
    [position, yaw],
  )

  return (
    <mesh geometry={geometry} position={stood} rotation={[0, yaw, 0]} receiveShadow>
      <meshStandardMaterial color={color} roughness={1} side={THREE.DoubleSide} />
    </mesh>
  )
}
