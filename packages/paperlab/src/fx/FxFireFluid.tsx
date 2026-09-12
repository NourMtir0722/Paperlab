import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { type ReactNode, useEffect, useMemo, useRef } from 'react'
import {
  FIRE_BODY,
  FIRE_CONTRAST,
  FIRE_CORE,
  FIRE_DETAIL,
  FIRE_HEAT_SCALE,
  FIRE_OPACITY,
  PAPER_WHITE,
} from './emission'
import type { DamageField } from './field'
import type { SurfaceLocator } from './fire'
import { FLAME_HEIGHT, flameAnchors, type FlameAnchor } from './flames'
import { FireFluid } from './fluid/FireFluid'
import { type FireFluidParams, fireFluidDefaults, solverUniforms } from './fluid/params'
import { MAX_SOURCES, RENDER_FRAGMENT, RENDER_VERTEX } from './fluid/passes'
import { fxQualityFor, type FxQualityTier } from './quality'

export interface FxFireFluidProps {
  field: DamageField
  locate: SurfaceLocator
  quality?: FxQualityTier
  /** The simulator's controls; anything left out takes the panel's default. */
  params?: Partial<FireFluidParams>
  /** False freezes the fire where it is — a paused lab. */
  running?: boolean
  /**
   * Change it to start the fire over: the air is emptied and the fire is
   * warmed up from the rim as it stands now, so a burn that was just seeked
   * to a moment shows that moment's flames rather than empty air.
   */
  resetKey?: unknown
  /** How bright the fire glows, against paper white. */
  glow?: number
  /**
   * The flame body, in multiples of paper white — see `emission.ts`. Above 1
   * it reads as a light; keep it under the bloom threshold's 2.25 or the body
   * of every flame blooms and the tone curve takes it to pastel.
   */
  body?: number
  /** The hottest cores, in multiples of paper white, added to {@link body}. */
  core?: number
  /** The solver temperature that counts as a flame's hottest gas. */
  heatScale?: number
  /** Gamma on the flame's temperature — above 1 darkens the body against the core. */
  contrast?: number
  /** How hard the render pass carves the gas into filaments, 0..2. */
  detail?: number
  /** How opaque the densest flame gas is; 0 is purely additive fire. */
  opacity?: number
  /**
   * What to draw where the simulator cannot run (no half-float render
   * targets) — typically `<FxFlames>`. Drawn INSTEAD, never as well.
   */
  fallback?: ReactNode
}

/** The domain, in world units: a sheet and a half across, room above it for the flames. */
const DOMAIN = { width: 1.5, height: 2 } as const
/** Below the sheet's middle, where the domain starts. */
const BELOW = 0.8
/** Fixed solver step. */
const STEP = 1 / 60
/** How long a reset fire is run before it is shown. */
const WARM = 0.8

const up = new THREE.Vector3(0, 1, 0)

/**
 * Fire, simulated — the flames and the smoke of a burning sheet as a fluid:
 * gas released along the hot rim, burning where it has oxygen, rising on its
 * own heat, torn by turbulence, cooling out of sight, leaving smoke.
 *
 * The damage field still decides everything about the PAPER; this is only
 * what the air above it does. The rim is read on the CPU as emission points —
 * the same irregular clusters `flameAnchors` stands the sprite flames on, so
 * the fire still gathers in tall tongues above a hole and short licks below
 * it — and nothing is ever read back from the GPU.
 *
 * It lives in a vertical plane through the sheet, facing the camera, so the
 * flames rise straight up whatever the sheet is doing. Needs half-float
 * render targets; where there are none it renders nothing, and the caller
 * falls back to `FxFlames` (see `FireFluid.supported`).
 */
export function FxFireFluid({
  field,
  locate,
  quality = 'medium',
  params,
  running = true,
  resetKey,
  glow = 1,
  body = FIRE_BODY,
  core = FIRE_CORE,
  heatScale = FIRE_HEAT_SCALE,
  contrast = FIRE_CONTRAST,
  detail = FIRE_DETAIL,
  opacity = FIRE_OPACITY,
  fallback,
}: FxFireFluidProps) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const grid = fxQualityFor(quality).fluid
  const fluid = useMemo(() => (FireFluid.supported(gl) ? new FireFluid(gl, grid, DOMAIN) : null), [gl, grid])
  useEffect(() => () => fluid?.dispose(), [fluid])

  const merged = useMemo(() => ({ ...fireFluidDefaults, ...params }), [params])
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: RENDER_VERTEX,
        fragmentShader: RENDER_FRAGMENT,
        uniforms: {
          uA: { value: null },
          uTime: { value: 0 },
          uGlow: { value: 1 },
          // Thin: smoke over a clear background, not a veil across it.
          uSmokeDensity: { value: 1.4 },
          // How bright the fire is, in the one unit `emission.ts` defines.
          uPaperWhite: { value: PAPER_WHITE },
          uBody: { value: FIRE_BODY },
          uCore: { value: FIRE_CORE },
          uHeatScale: { value: FIRE_HEAT_SCALE },
          uContrast: { value: FIRE_CONTRAST },
          uDetail: { value: FIRE_DETAIL },
          uOpacity: { value: FIRE_OPACITY },
        },
        transparent: true,
        depthWrite: false,
        // The fire is always in front of the paper it rises from. A sheet that
        // drapes or curls crosses the plane in places, and a depth test cut
        // the fire off there in a hard vertical seam.
        depthTest: false,
        // Premultiplied: fire adds light, smoke covers what is behind it.
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        side: THREE.DoubleSide,
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])
  const plane = useMemo(() => new THREE.PlaneGeometry(DOMAIN.width, DOMAIN.height), [])
  useEffect(() => () => plane.dispose(), [plane])
  const mesh = useRef<THREE.Mesh>(null)

  const state = useRef({
    key: Symbol('unset') as unknown,
    time: 0,
    owed: 0,
    origin: new THREE.Vector3(),
    right: new THREE.Vector3(1, 0, 0),
    normal: new THREE.Vector3(0, 0, 1),
  })
  const anchors = useRef<FlameAnchor[]>([])
  const sources = useMemo(() => new Float32Array(MAX_SOURCES * 4), [])
  const scratch = useMemo(() => new THREE.Vector3(), [])

  /** Where the domain stands: a vertical plane through the sheet, facing the camera. */
  const place = () => {
    const s = state.current
    const centre = locate(0.5, 0.5)
    const c = new THREE.Vector3(centre?.x ?? 0, centre?.y ?? 0, centre?.z ?? 0)
    s.normal.set(camera.position.x - c.x, 0, camera.position.z - c.z)
    if (s.normal.lengthSq() < 1e-8) s.normal.set(0, 0, 1)
    s.normal.normalize()
    s.right.crossVectors(up, s.normal).normalize()
    s.origin
      .copy(c)
      .addScaledVector(s.right, -DOMAIN.width / 2)
      .addScaledVector(up, -BELOW)
    const m = mesh.current
    if (m) {
      m.position
        .copy(s.origin)
        .addScaledVector(s.right, DOMAIN.width / 2)
        .addScaledVector(up, DOMAIN.height / 2)
      // A little toward the viewer, so the flames stand in front of the paper.
      m.position.addScaledVector(s.normal, 0.03)
      m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(s.right, up, s.normal))
    }
  }

  /** The rim, as emission points in the domain's UV. */
  const gather = (time: number): number => {
    const s = state.current
    const n = Math.min(MAX_SOURCES, flameAnchors(field, locate, MAX_SOURCES, anchors.current, time))
    for (let i = 0; i < n; i++) {
      const a = anchors.current[i]!
      scratch.set(a.x, a.y, a.z).sub(s.origin)
      sources[i * 4] = scratch.dot(s.right) / DOMAIN.width
      sources[i * 4 + 1] = scratch.dot(up) / DOMAIN.height
      // Radius in the domain's v units: about half a tongue's width.
      sources[i * 4 + 2] = Math.max(0.0025, (a.width * 0.6) / DOMAIN.height)
      // Tall clusters release more gas than short licks.
      sources[i * 4 + 3] = (a.height / FLAME_HEIGHT[1]) * (0.5 + 0.5 * a.heat)
    }
    return n
  }

  useFrame((_, delta) => {
    if (!fluid) return
    const s = state.current
    const u = solverUniforms(merged)
    if (s.key !== resetKey) {
      s.key = resetKey
      place()
      fluid.reset(u.ambient)
      // Warm up from the rim as it stands, on the burn's own clock, so the
      // same moment of the same burn draws the same fire.
      const end = field.time
      const steps = Math.round(WARM / STEP)
      for (let k = 0; k < steps; k++) {
        const t = end - WARM + k * STEP
        fluid.step(STEP, u, sources, gather(t), t)
      }
      s.time = end
      s.owed = 0
    }
    if (running) {
      s.owed += Math.min(0.1, Math.max(0, delta))
      let taken = 0
      while (s.owed >= STEP && taken < 3) {
        s.owed -= STEP
        s.time += STEP
        fluid.step(STEP, u, sources, gather(field.time), s.time)
        taken++
      }
    }
    material.uniforms.uA!.value = fluid.scalars.read.texture
    material.uniforms.uTime!.value = s.time
    material.uniforms.uGlow!.value = glow
    material.uniforms.uBody!.value = body
    material.uniforms.uCore!.value = core
    material.uniforms.uHeatScale!.value = heatScale
    material.uniforms.uContrast!.value = contrast
    material.uniforms.uDetail!.value = detail
    material.uniforms.uOpacity!.value = opacity
  })

  if (!fluid) return <>{fallback ?? null}</>
  return <mesh ref={mesh} geometry={plane} material={material} frustumCulled={false} renderOrder={2} />
}
