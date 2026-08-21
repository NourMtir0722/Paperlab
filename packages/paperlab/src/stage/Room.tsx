import * as THREE from 'three'
import { useEffect, useMemo } from 'react'

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
