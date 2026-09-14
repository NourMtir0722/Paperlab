import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { FxParticles } from './FxParticles'
import { flameGeometry, flameMaterial } from './flameShader'
import { ParticlePool } from './particles'

/** What the page says about the match this frame. Written in place — never a prop change. */
export interface MatchFlameState {
  /** Where the flame's root is, in world space; null when there is no match. */
  position: { x: number; y: number; z: number } | null
  /** Arming is the dwell before a pinch becomes a match; lit is a match. */
  state: 'none' | 'arming' | 'lit'
  /** How hard the viewer is blowing, 0..1. */
  blow: number
  /** Whether the flame is held against the sheet. */
  touching: boolean
  /**
   * A clock to animate on, in seconds, instead of the frame clock — and
   * `litAt`, when on that clock the match was struck.
   *
   * For a scripted burn (`/fx-lab`) that has to photograph the same match
   * twice: given both, the flare is a function of time rather than of which
   * frame saw the strike, and no random sparks or puffs are thrown. A live
   * hand leaves both out.
   */
  time?: number
  litAt?: number
}

export interface FxMatchFlameProps {
  /** Read every frame. A ref, so a hand moving the match re-renders nothing. */
  match: { readonly current: MatchFlameState }
}

/** A match flame at A4 scale: 15–25 mm tall. */
const HEIGHT = 20 / 210
/** How long a strike flares for, in seconds, and by how much. */
const FLARE = 0.42
const FLARE_GAIN = 1
/** How long a pinch has to be held to arm — `MATCH_DWELL_MS` on /hands. */
const ARM = 0.32

/**
 * A match, held: the parts of it that are the flame's to draw.
 *
 * - **Arming.** Friction building: a few tiny sparks and a warm point that
 *   grows at the pinch. A pinch released early (a flick) fizzles — nothing
 *   lights, because the page never says `lit`.
 * - **Strike.** A one-frame flash of light, a burst of sparks, a puff, and
 *   the flame flares to about twice its height for under half a second and
 *   settles — a real match head flares as it burns off.
 * - **Held.** A 20 mm teardrop that flickers, leans away from where the hand
 *   is going with a lag, and stretches thin and burns blue and dim when moved
 *   fast. Against the paper it flattens and spills upward.
 * - **Blown.** It leans away and flickers hard; when the page says it has
 *   gone out, it leaves a soft puff behind.
 * - **Light.** It lights the sheet warm before anything scorches — bringing
 *   the flame near the paper is the first thing people notice.
 *
 * It owns its own clock and its own handful of particles: nothing here is
 * part of a burn anyone replays.
 */
export function FxMatchFlame({ match }: FxMatchFlameProps) {
  const geometry = useMemo(() => flameGeometry(1), [])
  const material = useMemo(() => flameMaterial(), [])
  const pool = useMemo(() => new ParticlePool(160, 3), [])
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )
  const light = useRef<THREE.PointLight>(null)
  const memory = useRef({
    time: 0,
    last: 'none' as MatchFlameState['state'],
    armedAt: 0,
    flare: 0,
    flash: 0,
    spark: 0,
    was: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    lean: new THREE.Vector3(),
    at: new THREE.Vector3(),
    hasAt: false,
  })

  useFrame((_, delta) => {
    const now = match.current
    const m = memory.current
    // Scripted: the given clock, and nothing that depends on which frame
    // happened to see a transition.
    const scripted = now.time !== undefined
    const dt = scripted ? Math.max(0, now.time! - m.time) : Math.min(0.1, Math.max(0, delta))
    m.time = scripted ? now.time! : m.time + dt

    if (now.position) {
      m.at.set(now.position.x, now.position.y, now.position.z)
      if (!m.hasAt) m.was.copy(m.at)
      m.hasAt = true
    }

    // Transitions: what a strike and a blow-out LEAVE, spawned once — live
    // only; a scripted strike's flare is read off `litAt` below.
    if (!scripted && now.state === 'lit' && m.last !== 'lit') {
      m.flare = FLARE
      m.flash = 0.06
      for (let i = 0; i < 16; i++) pool.spawn('ember', m.at.x, m.at.y + HEIGHT * 0.2, m.at.z)
      for (let i = 0; i < 3; i++) pool.spawn('smoke', m.at.x, m.at.y + HEIGHT * 0.5, m.at.z)
    }
    if (!scripted && now.state !== 'lit' && m.last === 'lit' && m.hasAt) {
      for (let i = 0; i < 5; i++) pool.spawn('smoke', m.at.x, m.at.y + HEIGHT * 0.6, m.at.z)
    }
    if (now.state === 'arming' && m.last !== 'arming') m.armedAt = m.time
    m.last = now.state

    // Velocity, and a lean that follows it 100–200 ms late — the flame is
    // gas, and gas is left behind.
    if (dt > 0 && m.hasAt) {
      const v = m.at.clone().sub(m.was).divideScalar(dt)
      m.velocity.lerp(v, Math.min(1, dt / 0.08))
      m.was.copy(m.at)
    }
    const speed = m.velocity.length()
    const target = m.velocity.clone().multiplyScalar(-0.35)
    // Blowing comes from the viewer: it pushes the flame away, into the scene.
    target.z -= now.blow * 1.2
    m.lean.lerp(target, Math.min(1, dt / 0.15))

    m.flare = scripted ? Math.max(0, FLARE - (m.time - (now.litAt ?? -FLARE))) : Math.max(0, m.flare - dt)
    m.flash = scripted ? 0 : Math.max(0, m.flash - dt)

    const base = geometry.getAttribute('aBase') as THREE.InstancedBufferAttribute
    const shape = geometry.getAttribute('aShape') as THREE.InstancedBufferAttribute
    let height = 0
    let width = 0
    let gain = 1
    let lightLevel = 0
    if (now.state === 'arming' && m.hasAt) {
      // Friction building: a warm point, growing, and a spark now and then.
      const p = Math.min(1, (m.time - m.armedAt) / ARM)
      height = HEIGHT * 0.18 * p
      width = height * 0.5
      gain = 0.5 + p
      lightLevel = 0.012 * p
      m.spark -= dt
      if (!scripted && m.spark <= 0) {
        m.spark = 0.07
        pool.spawn('ember', m.at.x, m.at.y, m.at.z)
      }
    } else if (now.state === 'lit' && m.hasAt) {
      const flare = 1 + FLARE_GAIN * (m.flare / FLARE) ** 2
      // Stretched thin and taller when swung; flattened against the paper.
      const stretch = 1 + Math.min(1.2, speed * 0.9)
      height = HEIGHT * flare * stretch * (now.touching ? 0.6 : 1)
      width = (HEIGHT * 0.32 * (now.touching ? 1.6 : 1)) / Math.sqrt(stretch)
      // A hard blow makes it gutter.
      gain = 1 - now.blow * 0.45 * (0.5 + 0.5 * Math.sin(m.time * 61))
      // Enough to warm the sheet as it comes near, not to scald it:
      // at 0.12 the paper a few centimetres away read ~12× white and bloomed
      // into a peach disc on the capture of the contact frame.
      lightLevel = 0.035 * flare + (m.flash > 0 ? 0.25 : 0)
    }
    material.uniforms.uBlue!.value = Math.min(1, Math.max(0, speed * 0.7 - 0.35))
    material.uniforms.uGain!.value = gain
    material.uniforms.uTime!.value = m.time
    ;(material.uniforms.uLean!.value as THREE.Vector3).copy(m.lean)
    base.array[0] = m.at.x
    base.array[1] = m.at.y
    base.array[2] = m.at.z
    shape.array[0] = height
    shape.array[1] = width
    shape.array[2] = 0.37
    shape.array[3] = 1
    base.needsUpdate = true
    shape.needsUpdate = true
    geometry.instanceCount = height > 0 ? 1 : 0

    if (light.current) {
      // Half a flame up and a little toward the viewer — a light ON the paper
      // is a hot spot, not a flame's glow.
      light.current.position.set(m.at.x, m.at.y + height * 0.5, m.at.z + 0.06)
      light.current.intensity = lightLevel
    }
    pool.step(dt)
  })

  return (
    <>
      <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={3} />
      <pointLight ref={light} color="#ffb066" intensity={0} decay={1.6} distance={0} />
      <FxParticles pool={pool} />
    </>
  )
}
