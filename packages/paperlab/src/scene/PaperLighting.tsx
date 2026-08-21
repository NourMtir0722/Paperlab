import * as THREE from 'three'
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import type { FilmName, LightingName } from '../config/schema'
import { buildEnvironment } from './environment'
import { resolveLighting, type LightingPreset, type LightOverrides } from './lighting'
import { usePrefersReducedMotion } from '../a11y'

/**
 * The rig's film name, as a three constant.
 *
 * The mapping lives here rather than beside the presets because
 * `lighting.ts` is deliberately pure — it is the half that runs in node
 * under vitest, and importing three into it to name three integers would
 * trade that for nothing.
 */
const toneMappings: Record<FilmName, THREE.ToneMapping> = {
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
  filmic: THREE.ACESFilmicToneMapping,
}

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

/**
 * The studio light: the room, prefiltered, hung on the scene.
 *
 * Mounted as its own component so the PMREM pass runs when the RIG changes
 * and not when anything else in the lighting rerenders — it is a render
 * target and a chain of blur passes, which is cheap once and silly sixty
 * times a second.
 */
function StudioLight({ rig }: { rig: LightingPreset }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)

  // Only the colours and the key's placement change the image; intensity is
  // applied by the scene, so dragging that slider must not rebuild anything.
  const sky = `${rig.sky.zenith}|${rig.sky.horizon}|${rig.sky.ground}|${rig.key.color}|${rig.key.intensity}|${rig.key.position.join()}`

  // biome-ignore lint/correctness/useExhaustiveDependencies: `sky` is the digest of everything the image is built from.
  useEffect(() => {
    const environment = buildEnvironment(gl, rig)
    const previous = scene.environment
    scene.environment = environment.texture
    return () => {
      scene.environment = previous
      environment.dispose()
    }
  }, [gl, scene, sky])

  useEffect(() => {
    const previous = scene.environmentIntensity
    scene.environmentIntensity = rig.studio
    return () => {
      scene.environmentIntensity = previous
    }
  }, [scene, rig.studio])

  return null
}

/**
 * How bright the hemisphere stand-in runs against the environment it
 * replaces. Prefiltered irradiance integrates the whole sky, and a
 * hemisphere light is one cosine term, so matching them by eye means
 * pushing the cheap one up.
 */
const HEMISPHERE_STAND_IN = 1.6

export interface PaperLightingProps {
  preset?: LightingName
  /**
   * Overrides on the preset — exposure, key, direction, height, ambient,
   * studio, haze. See `lightSchema`.
   */
  light?: LightOverrides
  /**
   * An already-resolved rig, which wins over `preset`/`light`. Stage mode
   * resolves once and hands the same object to the lamps and to the paper,
   * so the two cannot be resolved differently.
   */
  rig?: LightingPreset
  /** Local y of the ground the contact shadow sits on. */
  floor?: number
  /** Contact shadow footprint. */
  scale?: number
  /** Override prefers-reduced-motion (freezes gobo drift). */
  reducedMotion?: boolean
  /**
   * Shadow map resolution, overriding the preset's. 0 turns the shadow pass
   * off — it re-renders the scene's geometry, so on a weak machine it is
   * often the single most expensive thing in the frame.
   */
  shadowMapSize?: number
  /** Draw the soft contact shadow. It is its own render pass. */
  contactShadow?: boolean
  /**
   * Light the scene with the room as well as with the lamp. Off is one
   * fewer texture read per fragment and a flatter picture; it is a quality
   * knob, not an art-direction one — turn the studio light DOWN with
   * `light.studio` if you want less of it.
   */
  environment?: boolean
}

/**
 * A scene's lighting rig from one serialized name plus whatever the author
 * overrode: key light (spot with a procedural gobo, or directional), the
 * room as an environment map, ambient fill, tone-mapping exposure, distance
 * haze, and the contact shadow. Swap presets to restyle the same paper;
 * move the sliders to light it yourself.
 */
export function PaperLighting({
  preset = 'studio',
  light,
  rig,
  floor = -1.2,
  scale = 10,
  reducedMotion,
  shadowMapSize,
  contactShadow = true,
  environment = true,
}: PaperLightingProps) {
  const p = useMemo(() => rig ?? resolveLighting(preset, light), [rig, preset, light])
  const mapSize = shadowMapSize ?? p.shadow.mapSize
  const castShadow = mapSize > 0
  const reduced = usePrefersReducedMotion(reducedMotion)
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)

  useEffect(() => {
    const previousExposure = gl.toneMappingExposure
    const previousFilm = gl.toneMapping
    gl.toneMappingExposure = p.exposure
    gl.toneMapping = toneMappings[p.film]
    return () => {
      gl.toneMappingExposure = previousExposure
      gl.toneMapping = previousFilm
    }
  }, [gl, p.exposure, p.film])

  // Set imperatively rather than via <fog attach="fog" />, which would bind
  // to whatever group this rig happens to be mounted under instead of the scene.
  useEffect(() => {
    if (!p.fog) return
    const previous = scene.fog
    scene.fog = new THREE.Fog(p.fog.color, p.fog.near, p.fog.far)
    return () => {
      scene.fog = previous
    }
  }, [scene, p.fog])

  // biome-ignore lint/correctness/useExhaustiveDependencies: Only the gobo kind rebuilds the texture — drift and intensity animate in place.
  const goboMap = useMemo(() => (p.gobo ? makeGoboTexture(p.gobo.kind) : null), [p.gobo?.kind])
  useEffect(() => () => goboMap?.dispose(), [goboMap])

  const driftRef = useRef(0)
  useFrame((_, delta) => {
    if (!goboMap || !p.gobo || reduced) return
    driftRef.current += delta * p.gobo.drift
    goboMap.offset.set(driftRef.current, driftRef.current * 0.6)
  })

  return (
    <>
      {p.studio > 0 &&
        (environment ? (
          <StudioLight rig={p} />
        ) : (
          // The studio light degrades rather than disappearing. A hemisphere
          // is the cheap half of what the room does — light from above, a
          // different colour from below — so a machine that cannot pay for
          // the environment still gets a lit figure with a top and a bottom
          // instead of a flat cut-out.
          <hemisphereLight
            color={p.sky.horizon}
            groundColor={p.sky.ground}
            intensity={p.studio * HEMISPHERE_STAND_IN}
          />
        ))}
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
          castShadow={castShadow}
          map={goboMap}
          shadow-mapSize={[mapSize || 1, mapSize || 1]}
          shadow-radius={p.shadow.radius}
          shadow-normalBias={0.05}
        />
      ) : (
        <directionalLight
          position={p.key.position}
          color={p.key.color}
          intensity={p.key.intensity}
          castShadow={castShadow}
          shadow-mapSize={[mapSize || 1, mapSize || 1]}
          shadow-radius={p.shadow.radius}
          shadow-normalBias={0.05}
        />
      )}
      {contactShadow && (
        <ContactShadows
          position={[0, floor, 0]}
          opacity={p.contactShadowOpacity}
          scale={scale}
          blur={p.contactShadowBlur}
          far={3}
        />
      )}
    </>
  )
}
