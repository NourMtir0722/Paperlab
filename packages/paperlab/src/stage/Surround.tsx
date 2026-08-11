import * as THREE from 'three'
import { useEffect, useMemo } from 'react'

/**
 * The cyclorama: an inverted sphere graded from the source colour at the
 * horizon to near-dark overhead.
 *
 * A single bright plane at the end of the walk is enough for a shot pointed
 * down that walk, and nothing at all for one pointed across it — `wide`
 * framed the figure against an unlit void. A room has walls in every
 * direction, and grading them toward the light is what puts the haze and the
 * distance on the same side of the frame as the source.
 */

/** Procedural, so the repo carries no binary and the grade stays editable. */
export function makeSkyTexture(horizon: string, zenith: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const grade = ctx.createLinearGradient(0, 0, 0, canvas.height)
  // Canvas row 0 is the top of the sphere. The grade has to travel most of
  // the way down: held flat until near the horizon it reads as a dark lid
  // over a bright slot, which is the black void this is here to remove.
  grade.addColorStop(0, zenith)
  grade.addColorStop(0.35, zenith)
  grade.addColorStop(0.92, horizon)
  grade.addColorStop(1, horizon)
  ctx.fillStyle = grade
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * The source itself: bright at the centre, falling to nothing at the edges.
 *
 * A flat rectangle of light has a BORDER, and the moment a shot is not
 * pointed straight down the walk that border draws a hard diagonal across
 * the sky. Fading it out is what lets a finite plane read as an opening
 * rather than as a panel hung in the room.
 */
export function makeGlowTexture(color: string): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const glow = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  glow.addColorStop(0, color)
  glow.addColorStop(0.55, color)
  // Same colour throughout — only the alpha falls, so the fade never tints.
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export function Source({
  size,
  position,
  yaw,
  color,
}: {
  size: number
  position: readonly [number, number, number]
  yaw: number
  color: string
}) {
  const texture = useMemo(() => makeGlowTexture(color), [color])
  useEffect(() => () => texture.dispose(), [texture])
  return (
    <mesh position={position as unknown as THREE.Vector3} rotation={[0, yaw, 0]}>
      <planeGeometry args={[size * 2.4, size * 1.8]} />
      <meshBasicMaterial
        map={texture}
        transparent
        // It is light, not an object: it must not occlude, tone-map or fog.
        depthWrite={false}
        toneMapped={false}
        fog={false}
      />
    </mesh>
  )
}

export function Surround({ radius, horizon, zenith }: { radius: number; horizon: string; zenith: string }) {
  const texture = useMemo(() => makeSkyTexture(horizon, zenith), [horizon, zenith])
  useEffect(() => () => texture.dispose(), [texture])

  return (
    <mesh>
      <sphereGeometry args={[radius, 32, 24]} />
      {/* Unlit and unfogged — it IS the distance, so haze must not stack on it. */}
      <meshBasicMaterial map={texture} side={THREE.BackSide} fog={false} />
    </mesh>
  )
}
