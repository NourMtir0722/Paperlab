import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { type ReactNode, useEffect, useMemo, useRef } from 'react'
import {
  FIRE_CONTRAST,
  FIRE_HEAT_SCALE,
  FIRE_OPACITY,
  FIRE_SOOT_SCALE,
  FIRE_THIN,
  type FireZonesInput,
  PAPER_WHITE,
  fireZones,
  hexToLinear,
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
   * The flame's four zones — root, core, body and tip — each part laid over
   * `FIRE_ZONES`. See `FireZones` for what each zone is and why it looks the
   * way it does.
   */
  zones?: FireZonesInput
  /** The solver temperature that counts as a flame's hottest gas. */
  heatScale?: number
  /** The soot density that counts as a full flame — see `FIRE_SOOT_SCALE`. */
  sootScale?: number
  /** Gamma on the flame's temperature — above 1 darkens the body against the core. */
  contrast?: number
  /** How opaque the densest flame gas is; 0 is purely additive fire. */
  opacity?: number
  /** How opaque gas must be to glow fully; see `FIRE_THIN`. */
  thin?: number
  /**
   * Seconds of fire run, unseen, whenever it starts over (see `resetKey`).
   * A plume started from still air rolls its leading edge into a mushroom cap
   * — the starting vortex — and a fire that has burned for seconds has long
   * since shed it. Too short and a seeked-to frame shows that cap.
   */
  warm?: number
  /**
   * Error-compensated (MacCormack) advection for what is drawn. Defaults to
   * on everywhere but the `low` tier, where the two extra passes a step are
   * the first thing a throttled phone should give back.
   */
  sharp?: boolean
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
/**
 * Fixed solver step. 1/120: gas leaving the rim at ~0.3 m/s crosses about a
 * velocity cell a step at this rate, which is what semi-Lagrangian advection
 * is accurate for; at 1/60 it crossed two, and smeared.
 */
const STEP = 1 / 120
/** The unseen warm-up after a reset runs at the old rate — it is shed before it is shown. */
const WARM_STEP = 1 / 60
/** Steps a frame may take before the fire falls behind rather than stalling the page. */
const MAX_STEPS = 6
/**
 * Half-width of the band gas comes off, across the rim: ~1.2 mm of A4. The
 * char right behind the ember line, which is where paper gives off its gas.
 */
const BAND = 1.2 / 210
/**
 * Spots of the rim that remember a flame, so they go on smoking after it.
 * Each flame writes itself into one slot (by its seed) every step it burns;
 * a slot not written for a while is a spot whose flame has gone out, and it
 * releases smoke — no fuel — fading over `smokeAfter` seconds.
 */
const SMOULDER_SLOTS = 16
/** Seconds a spot must have had no flame before it counts as out and starts to smoke. */
const SMOULDER_AFTER = 1
/**
 * How long a reset fire is run before it is shown.
 *
 * Was 0.8 s, and that is what drew the HOOKS — tongues curling over at the
 * top like ribbons. A plume started from still air rolls its leading edge
 * into a mushroom cap, the starting vortex, and 0.8 s is not long enough for
 * it to have risen out of frame; a fire that has actually burned for a few
 * seconds shed it long ago. Swept on the peak frame: at 0.8 s two hooks, at
 * 2 s nearly none, at 4 s straight vertical tongues. Turbulence and vorticity
 * were tried first and changed nothing — the hooks were never the flow's, they
 * were the seek's. Only a reset pays this (a seek, or `resetKey` changing).
 */
const WARM = 3

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
  zones,
  heatScale = FIRE_HEAT_SCALE,
  sootScale = FIRE_SOOT_SCALE,
  contrast = FIRE_CONTRAST,
  opacity = FIRE_OPACITY,
  thin = FIRE_THIN,
  warm = WARM,
  sharp,
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
          uB: { value: null },
          uTime: { value: 0 },
          uGlow: { value: 1 },
          // Thin: smoke over a clear background, not a veil across it.
          uSmokeDensity: { value: 0.9 },
          // How bright the fire is, in the one unit `emission.ts` defines.
          uPaperWhite: { value: PAPER_WHITE },
          uHeatScale: { value: FIRE_HEAT_SCALE },
          uSootScale: { value: FIRE_SOOT_SCALE },
          uContrast: { value: FIRE_CONTRAST },
          uOpacity: { value: FIRE_OPACITY },
          uThin: { value: FIRE_THIN },
          // The four zones (FireZones). Colours linear, glows in multiples of
          // paper white, boundaries in fractions of the hottest gas.
          uTipColor: { value: new THREE.Vector3() },
          uBodyColor: { value: new THREE.Vector3() },
          uCoreColor: { value: new THREE.Vector3() },
          uRootColor: { value: new THREE.Vector3() },
          uTipGlow: { value: 0 },
          uBodyGlow: { value: 0 },
          uCoreGlow: { value: 0 },
          uTipFrom: { value: 0 },
          uTipTo: { value: 0 },
          uCoreFrom: { value: 0 },
          uSoftness: { value: 0 },
          uTearing: { value: 0 },
          uRootAmount: { value: 0 },
          uRootReach: { value: 0 },
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
    /** The fire's clock when the rim last released anything — flame or smoulder. */
    lastGas: Number.NEGATIVE_INFINITY,
    origin: new THREE.Vector3(),
    right: new THREE.Vector3(1, 0, 0),
    normal: new THREE.Vector3(0, 0, 1),
  })
  const anchors = useRef<FlameAnchor[]>([])
  const sources = useMemo(() => new Float32Array(MAX_SOURCES * 4), [])
  const across = useMemo(() => new Float32Array(MAX_SOURCES * 4), [])
  const smoulder = useMemo(
    () =>
      Array.from({ length: SMOULDER_SLOTS }, () => ({
        seen: Number.NEGATIVE_INFINITY,
        source: new Float32Array(4),
        across: new Float32Array(4),
      })),
    [],
  )
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

  /**
   * The rim, as short lines of emission in the domain's UV: one per flame,
   * as long as its tongue is wide, a band ~1.2 mm across, laid just onto the
   * paper side of the edge. Lengths are in the pass's aspect-corrected space,
   * where a world length is `length / DOMAIN.height`.
   */
  const gather = (time: number): number => {
    const s = state.current
    const room = MAX_SOURCES - SMOULDER_SLOTS
    const n = Math.min(room, flameAnchors(field, locate, room, anchors.current, time))
    const band = BAND / DOMAIN.height
    for (let i = 0; i < n; i++) {
      const a = anchors.current[i]!
      scratch.set(a.x, a.y, a.z).sub(s.origin)
      const k = i * 4
      sources[k] = scratch.dot(s.right) / DOMAIN.width
      sources[k + 1] = scratch.dot(up) / DOMAIN.height
      // Which way the paper lies, in the plane the fire is drawn in.
      const nu = a.nx * s.right.x + a.ny * s.right.y + a.nz * s.right.z
      const nv = a.ny
      const nl = Math.hypot(nu, nv)
      let area: number
      if (nl > 0.25) {
        const half = Math.max(1.5 / 210, a.width * 0.5) / DOMAIN.height
        sources[k + 2] = half
        across[k] = nu / nl
        across[k + 1] = nv / nl
        across[k + 2] = band
        across[k + 3] = band
        area = half * band
      } else {
        // A rim seen end-on has no direction in this plane: a small disc.
        sources[k + 2] = band * 2
        across[k] = 0
        across[k + 1] = 1
        across[k + 2] = band * 2
        across[k + 3] = 0
        area = band * band * 4
      }
      // Tall clusters release more gas than short licks: per length of rim,
      // in proportion to the height. It was in proportion to height × width²
      // — the disc's area — and since width follows height that is height³:
      // a lower-rim lick at a third of the height got a thirtieth of the gas,
      // never grew enough soot to show, and the ring lost its short flames.
      const disc = Math.max(0.0025, (a.width * 0.6) / DOMAIN.height)
      const tallest = (FLAME_HEIGHT[1] * 0.47 * 0.6) / DOMAIN.height
      sources[k + 3] =
        (a.height / FLAME_HEIGHT[1]) * (0.5 + 0.5 * a.heat) * Math.min(30, (disc * tallest) / area)
      // This spot is burning: remember it, so it smokes once it stops.
      const slot = smoulder[Math.floor(a.seed * SMOULDER_SLOTS) % SMOULDER_SLOTS]!
      slot.seen = time
      slot.source.set(sources.subarray(k, k + 4))
      slot.across.set(across.subarray(k, k + 4))
    }
    // Spots whose flame has gone out, smoking and fading — flagged by a
    // negative strength, which the emission pass turns into smoke alone.
    const after = Math.max(0, merged.smokeAfter ?? 0)
    let count = n
    for (const slot of smoulder) {
      const since = time - slot.seen
      // Only once the flame has really gone. Flames hop along the rim every
      // ~0.7 s, so a slot left unwritten for a step or two is a flame that
      // moved, not one that went out — and smoking at once from every such
      // slot poured a grey cloud over the sheet while it was still burning.
      if (!(since > SMOULDER_AFTER) || after <= 0 || since > after * 3) continue
      const k = count * 4
      sources.set(slot.source, k)
      across.set(slot.across, k)
      const onset = Math.min(1, (since - SMOULDER_AFTER) / 0.6)
      sources[k + 3] = -slot.source[3]! * onset * Math.exp(-since / after)
      count++
    }
    return count
  }

  useFrame((_, delta) => {
    if (!fluid) return
    const s = state.current
    const u = solverUniforms(merged)
    fluid.sharp = sharp ?? quality !== 'low'
    if (s.key !== resetKey) {
      s.key = resetKey
      place()
      fluid.reset(u.ambient)
      for (const slot of smoulder) slot.seen = Number.NEGATIVE_INFINITY
      const end = field.time
      // Warm up from the rim as it stands, on the burn's own clock, so the
      // same moment of the same burn draws the same fire. Not when nothing is
      // burning: the warm-up replays THIS field at earlier times, so with no
      // front it would run 180 steps releasing nothing — which /hands paid on
      // every fresh sheet.
      if (field.frontCount > 0) {
        const steps = Math.round(warm / WARM_STEP)
        for (let k = 0; k < steps; k++) {
          const t = end - warm + k * WARM_STEP
          fluid.step(WARM_STEP, u, sources, across, gather(t), t)
        }
        s.lastGas = end
      } else {
        s.lastGas = Number.NEGATIVE_INFINITY
      }
      s.time = end
      s.owed = 0
    }
    // Idle: nothing burning, and nothing released for long enough that the
    // smoke left is under 1% (five of its lifetimes). Then the fire costs
    // nothing — no solver steps, no plane drawn. It used to step every frame
    // from mount, so a page that mounts the fire before anything burns (/hands
    // does, from the first frame) ran an empty simulation for as long as it
    // was open: on a GPU a waste, and on CI's CPU-drawn WebGL the reason the
    // Hands check went from under 5 minutes to over 20. A new front wakes it.
    const idle = field.frontCount === 0 && s.time - s.lastGas > Math.max(2, merged.smokeFade * 5)
    const m = mesh.current
    if (m) m.visible = !idle
    if (running && idle) {
      s.owed = 0
      s.time += Math.min(0.1, Math.max(0, delta))
    } else if (running) {
      s.owed += Math.min(0.1, Math.max(0, delta))
      let taken = 0
      while (s.owed >= STEP && taken < MAX_STEPS) {
        s.owed -= STEP
        s.time += STEP
        const count = gather(field.time)
        fluid.step(STEP, u, sources, across, count, s.time)
        if (count > 0) s.lastGas = s.time
        taken++
      }
    }
    material.uniforms.uA!.value = fluid.scalars.read.texture
    material.uniforms.uB!.value = fluid.air.read.texture
    material.uniforms.uTime!.value = s.time
    material.uniforms.uGlow!.value = glow
    material.uniforms.uHeatScale!.value = heatScale
    material.uniforms.uSootScale!.value = sootScale
    material.uniforms.uContrast!.value = contrast
    material.uniforms.uOpacity!.value = opacity
    material.uniforms.uThin!.value = thin
    // Read every frame, so a zone tuned in the lab shows at once, paused or not.
    const z = fireZones(zones)
    const mu = material.uniforms
    ;(mu.uTipColor!.value as THREE.Vector3).fromArray(hexToLinear(z.tip.color))
    ;(mu.uBodyColor!.value as THREE.Vector3).fromArray(hexToLinear(z.body.color))
    ;(mu.uCoreColor!.value as THREE.Vector3).fromArray(hexToLinear(z.core.color))
    ;(mu.uRootColor!.value as THREE.Vector3).fromArray(hexToLinear(z.root.color))
    mu.uTipGlow!.value = z.tip.glow
    mu.uBodyGlow!.value = z.body.glow
    mu.uCoreGlow!.value = z.core.glow
    mu.uTipFrom!.value = z.tip.from
    mu.uTipTo!.value = z.tip.to
    mu.uCoreFrom!.value = z.core.from
    mu.uSoftness!.value = z.tip.softness
    mu.uTearing!.value = z.tip.tearing
    mu.uRootAmount!.value = z.root.amount
    mu.uRootReach!.value = z.root.reach
  })

  if (!fluid) return <>{fallback ?? null}</>
  return <mesh ref={mesh} geometry={plane} material={material} frustumCulled={false} renderOrder={2} />
}
