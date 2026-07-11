import * as THREE from 'three'
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import type { LightingName } from '../config/schema'
import { getLightingPreset } from './lighting'
import { usePrefersReducedMotion } from '../a11y'

/** Deterministic PRNG so gobos render identically everywhere. */
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Procedural gobo textures — no binary assets in the repo. White passes
 * light, dark blocks it (SpotLight.map multiplies the beam).
 */
export function makeGoboTexture(kind: 'blinds' | 'leaves'): THREE.CanvasTexture {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)

  if (kind === 'blinds') {
    // Venetian slats: soft-edged dark bars, slightly rotated.
    ctx.save()
    ctx.translate(size / 2, size / 2)
    ctx.rotate(-0.06)
    const slat = 34
    const gap = 30
    for (let y = -size; y < size; y += slat + gap) {
      const grad = ctx.createLinearGradient(0, y, 0, y + slat)
      grad.addColorStop(0, 'rgba(20,20,20,0)')
      grad.addColorStop(0.25, 'rgba(20,20,20,0.92)')
      grad.addColorStop(0.75, 'rgba(20,20,20,0.92)')
      grad.addColorStop(1, 'rgba(20,20,20,0)')
      ctx.fillStyle = grad
      ctx.fillRect(-size, y, size * 2, slat)
    }
    ctx.restore()
  } else {
    // Dappled foliage: three scales of soft dark blobs.
    const rand = mulberry32(7)
    for (const [count, radius, alpha] of [
      [26, 70, 0.75],
      [40, 38, 0.6],
      [70, 16, 0.5],
    ] as const) {
      for (let i = 0; i < count; i++) {
        const x = rand() * size
        const y = rand() * size
        const r = radius * (0.6 + rand() * 0.8)
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
        grad.addColorStop(0, `rgba(15,20,12,${alpha})`)
        grad.addColorStop(0.7, `rgba(15,20,12,${alpha * 0.55})`)
        grad.addColorStop(1, 'rgba(15,20,12,0)')
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.ellipse(x, y, r, r * (0.6 + rand() * 0.5), rand() * Math.PI, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  return texture
}

export interface PaperLightingProps {
  preset?: LightingName
  /** Local y of the ground the contact shadow sits on. */
  floor?: number
  /** Contact shadow footprint. */
  scale?: number
  /** Override prefers-reduced-motion (freezes gobo drift). */
  reducedMotion?: boolean
}

/**
 * A scene's lighting rig from one serialized name: key light (spot with a
 * procedural gobo, or directional), ambient fill, tone-mapping exposure,
 * and the contact shadow. Swap presets to restyle the same paper.
 */
export function PaperLighting({
  preset = 'studio',
  floor = -1.2,
  scale = 10,
  reducedMotion,
}: PaperLightingProps) {
  const p = getLightingPreset(preset)
  const reduced = usePrefersReducedMotion(reducedMotion)
  const gl = useThree((s) => s.gl)

  useEffect(() => {
    const previous = gl.toneMappingExposure
    gl.toneMappingExposure = p.exposure
    return () => {
      gl.toneMappingExposure = previous
    }
  }, [gl, p.exposure])

  const goboMap = useMemo(
    () => (p.gobo ? makeGoboTexture(p.gobo.kind) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.gobo?.kind],
  )
  useEffect(() => () => goboMap?.dispose(), [goboMap])

  const driftRef = useRef(0)
  useFrame((_, delta) => {
    if (!goboMap || !p.gobo || reduced) return
    driftRef.current += delta * p.gobo.drift
    goboMap.offset.set(driftRef.current, driftRef.current * 0.6)
  })

  return (
    <>
      <ambientLight intensity={p.ambient} />
      {p.gobo && goboMap ? (
        <spotLight
          position={p.key.position}
          color={p.key.color}
          // decay 0 keeps intensity art-directable rather than distance-driven.
          intensity={p.key.intensity * 3.2}
          angle={p.gobo.angle}
          penumbra={0.5}
          decay={0}
          castShadow
          map={goboMap}
          shadow-mapSize={[p.shadow.mapSize, p.shadow.mapSize]}
          shadow-radius={p.shadow.radius}
          shadow-normalBias={0.05}
        />
      ) : (
        <directionalLight
          position={p.key.position}
          color={p.key.color}
          intensity={p.key.intensity}
          castShadow
          shadow-mapSize={[p.shadow.mapSize, p.shadow.mapSize]}
          shadow-radius={p.shadow.radius}
          shadow-normalBias={0.05}
        />
      )}
      <ContactShadows
        position={[0, floor, 0]}
        opacity={p.contactShadowOpacity}
        scale={scale}
        blur={p.contactShadowBlur}
        far={3}
      />
    </>
  )
}
