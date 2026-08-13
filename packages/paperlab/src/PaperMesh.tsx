import * as THREE from 'three'
import { gsap } from 'gsap'
import { useFrame, useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import type {
  BehaviorConfigInput,
  ClothConfig,
  ContentConfigInput,
  DeformerInstanceConfigInput,
  PaperConfig,
  PaperConfigInput,
  PhysicsConfigInput,
  SceneConfigInput,
  SheetConfig,
  StockName,
  SurfaceConfigInput,
} from './config/schema'
import { paperConfigSchema } from './config/schema'
import { mergeConfig, parsePreset, serializePreset } from './config/serialize'
import { createSheetGeometry, resolveSegments } from './core/sheet'
import { FLAT_SEGMENTS } from './core/tessellation'
import { getStock } from './core/stock'
import { getPreset } from './config/presets'
import { useContentTexture } from './content/texture'
import { applyDeformerStack, displacePoint, stackAutoSegments, stackMinSegments } from './deformers/compose'
import { stackIsAnimated } from './deformers/registry'
import type { DeformerInstance } from './deformers/types'
import { getBehavior } from './behaviors/registry'
import { resolveDeformerStack } from './deformers/registry'
import type { Behavior } from './behaviors/types'
import { getIdlePreset, type IdleName, type IdlePose } from './physics/idle'
import { ClothSim } from './physics/cloth'
import { PaperMaterial } from './surface/PaperMaterial'
import { usePrefersReducedMotion } from './a11y'
import { quantizeProgress, quantizeTime } from './motion/onTwos'
import { usePaperStates } from './states/usePaperStates'
import type { PaperStateMachine, StateEvent } from './states/machine'

export interface PaperMeshProps {
  /** Built-in preset name, or a (partial) preset object. Props below override it. */
  preset?: string | PaperConfigInput
  sheet?: Partial<SheetConfig>
  stock?: StockName
  /**
   * These take the schema's INPUT types, not its parsed ones: writing
   * `content={{ type: 'text', text: 'hi' }}` has to compile, and with the
   * inferred type it does not — it demands every field of every nested
   * object. Every default stays a default.
   */
  content?: ContentConfigInput
  behavior?: BehaviorConfigInput
  deformers?: DeformerInstanceConfigInput[]
  /** Fragment-side effects: grain, aging, deckle, creases, perforation. */
  surface?: SurfaceConfigInput
  /** Scene-level presentation that travels with the paper (lighting). */
  scene?: SceneConfigInput
  physics?: PhysicsConfigInput | 'cloth'
  onTwos?: boolean
  /** Show draggable behavior handles; cloth sheets become grabbable. */
  interactive?: boolean
  /** Start the behavior's transport loop on mount. */
  autoplay?: boolean
  /** Override prefers-reduced-motion (default: follow the system setting). */
  reducedMotion?: boolean
  position?: [number, number, number]
  rotation?: [number, number, number]
  /** Fires every animation tick with the behavior's progress (0..1). */
  onProgress?(value: number): void
  /** Fires when a handle drag ends, with the params the drag changed. */
  onBehaviorChange?(patch: Record<string, unknown>): void
  /**
   * Interaction states: when the config carries `states`, pointer triggers
   * are live by default. Set false to sculpt a stateful paper without the
   * machine firing (the editor's state-editing mode).
   */
  stateTriggers?: boolean
  /** Fires when the state machine changes state. */
  onStateChange?(state: string): void
  /** Fires for `onEnter` actions ('emit:<event>'). */
  onStateAction?(event: string, state: string): void
}

export interface PaperHandle {
  play(): void
  pause(): void
  readonly playing: boolean
  /** Live-override a behavior param. 'progress' always maps to the behavior's progress param. */
  set(param: string, value: unknown): void
  getProgress(): number
  /** Current full state (including live overrides) as a preset. */
  snapshot(): PaperConfig
  toJSON(): string
  readonly mesh: THREE.Mesh | null
  /** Interaction-state machine access (null when the config has no states). */
  readonly state: string
  sendState(event: StateEvent): string | null
  /**
   * Drive to 'picked' through the legal chain (rest→hover→pressed→picked),
   * instantly, so every side effect fires — the keyboard/a11y entry point
   * where no pointer hover/press ever ran. Returns true if it landed.
   */
  pickProgrammatic(): boolean
  /** Instant, legal place (picked → placed) so onEnter/emit fires. */
  placeProgrammatic(): boolean
  /** Instant, legal return (picked → rest). */
  returnProgrammatic(): boolean
}

/**
 * Stable memo key over every prop {@link resolveConfig} reads. Consumers that
 * cache a resolved config must key on this, not on `preset` alone.
 */
export function resolveConfigKey(props: PaperMeshProps): string {
  return JSON.stringify([
    props.preset ?? null,
    props.sheet ?? null,
    props.stock ?? null,
    props.content ?? null,
    props.behavior ?? null,
    props.deformers ?? null,
    props.surface ?? null,
    props.scene ?? null,
    props.physics ?? null,
    props.onTwos ?? null,
  ])
}

/** Resolve preset + prop overrides into a validated config. */
export function resolveConfig(props: PaperMeshProps): PaperConfig {
  const base = props.preset
    ? typeof props.preset === 'string'
      ? getPreset(props.preset)
      : parsePreset(props.preset)
    : paperConfigSchema.parse({})
  const overrides: PaperConfigInput = {}
  if (props.sheet) overrides.sheet = { ...base.sheet, ...props.sheet }
  if (props.stock) overrides.stock = props.stock
  if (props.content) overrides.content = props.content
  if (props.behavior) overrides.behavior = props.behavior
  if (props.deformers) overrides.deformers = props.deformers
  // Surface merges over the stock's defaults rather than replacing them, so
  // `surface={{ grain: 0.6 }}` on thermal keeps thermal's banding.
  if (props.surface) overrides.surface = { ...base.surface, ...props.surface }
  if (props.scene) overrides.scene = { ...base.scene, ...props.scene }
  if (props.physics) overrides.physics = props.physics
  if (props.onTwos !== undefined) overrides.onTwos = props.onTwos
  return paperConfigSchema.parse(mergeConfig(base as PaperConfigInput, overrides))
}

/** Cloth grids cap their resolution — 5k verlet particles is the budget ceiling. */
const CLOTH_MAX_SEGMENTS = 28

/** Where `'auto'` probes a behavior's sweep. Endpoints matter most — a play
 *  usually starts or ends at its tightest. */
const PROGRESS_SAMPLES = [0, 0.25, 0.5, 0.75, 1] as const

const dragPlane = new THREE.Plane()
const dragPoint = new THREE.Vector3()
const planeNormal = new THREE.Vector3()
const anchorScratch = new THREE.Vector3()
const worldScratch = new THREE.Vector3()
const quatScratch = new THREE.Quaternion()

/**
 * The atom: one sheet of paper, hero-mode CPU path. The deformer stack (or
 * the cloth sim — never both) writes geometry positions each frame. GSAP
 * owns animated values; useFrame owns geometry writes.
 */
export const PaperMesh = forwardRef<PaperHandle, PaperMeshProps>(function PaperMesh(props, ref) {
  // Each resolveConfig call is several zod parses (superRefine re-parses every
  // state override) — memoized so a render without config-prop changes is free.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resolveConfigKey serializes every prop resolveConfig reads — the props object itself is new each render.
  const resolved = useMemo(() => resolveConfig(props), [resolveConfigKey(props)])
  // Reduced motion: behaviors freeze at their resting pose, physics is off,
  // idle motion is off. The sheet still renders fully sculpted.
  const reduced = usePrefersReducedMotion(props.reducedMotion)
  // Interaction states: the machine animates a live config between state
  // overrides; `config` below is that animated view (the base when no states).
  // Reduced motion keeps the machine but makes transitions instant.
  const statesLive = Boolean(resolved.states) && props.stateTriggers !== false
  const {
    config,
    machine,
    state: machineState,
  } = usePaperStates(resolved, statesLive, reduced, props.onStateAction, props.onStateChange)
  const behavior: Behavior | null = config.behavior ? getBehavior(config.behavior.type) : null
  const machineRef = useRef<PaperStateMachine | null>(null)
  machineRef.current = machine
  // The animated `config` has `states` stripped — keep the resolved preset
  // around so snapshot()/toJSON() never lose the state machine.
  const resolvedRef = useRef(resolved)
  resolvedRef.current = resolved
  const isCloth = !reduced && typeof config.physics === 'object'
  const idle =
    !reduced && typeof config.physics === 'string' && config.physics !== 'none'
      ? getIdlePreset(config.physics as IdleName)
      : null

  const meshRef = useRef<THREE.Mesh>(null)
  const groupRef = useRef<THREE.Group>(null)
  const handleRefs = useRef<(THREE.Mesh | null)[]>([])

  const overridesRef = useRef<Record<string, unknown>>({})
  const dirtyRef = useRef(true)
  const playingRef = useRef(false)
  const tweenRef = useRef<gsap.core.Tween | null>(null)
  const draggingRef = useRef<string | null>(null)

  const configRef = useRef(config)
  configRef.current = config

  const controls = useThree((s) => s.controls) as { enabled?: boolean } | null
  const camera = useThree((s) => s.camera)

  const behaviorKey = JSON.stringify(config.behavior ?? null)
  const deformersKey = JSON.stringify(config.deformers ?? null)
  const sheetKey = JSON.stringify(config.sheet)
  const physicsKey = JSON.stringify(config.physics)

  // biome-ignore lint/correctness/useExhaustiveDependencies: The keys are change triggers; the body only touches refs.
  useEffect(() => {
    if (!draggingRef.current && !playingRef.current) overridesRef.current = {}
    dirtyRef.current = true
  }, [behaviorKey, deformersKey, sheetKey, physicsKey])

  // biome-ignore lint/correctness/useExhaustiveDependencies: Keyed on the stack shape — the probe reads config off a ref.
  const [minSegments, autoSegments] = useMemo((): [number, number] => {
    const cfg = configRef.current
    const probe = buildStack(cfg, {})
    if (!probe) return [2, FLAT_SEGMENTS]

    // The grid is built once; a behavior's stack is not the same shape all
    // the way through. An unroll is a tight roll at one end of its progress
    // and a flat sheet at the other, so sizing to the configured moment
    // would leave the sheet under-tessellated for the rest of the play.
    // Sample the sweep and keep the densest answer. Every behavior's
    // progressParam is a 0..1 number — pinned by behaviors.test.ts, because
    // this loop silently samples the wrong range if that ever stops holding.
    let want = stackAutoSegments(probe, cfg.sheet)
    if (cfg.behavior && !cfg.deformers) {
      const param = getBehavior(cfg.behavior.type).progressParam
      for (const p of PROGRESS_SAMPLES) {
        const at = buildStack(cfg, { [param]: p })
        if (at) want = Math.max(want, stackAutoSegments(at, cfg.sheet))
      }
    }
    return [stackMinSegments(probe), want]
  }, [behaviorKey, deformersKey, physicsKey])

  // biome-ignore lint/correctness/useExhaustiveDependencies: Keyed on the sheet — rebuilding geometry on identity would orphan GPU buffers every render.
  const geometry = useMemo(() => {
    if (!isCloth) return createSheetGeometry(config.sheet, minSegments, autoSegments)
    // Cloth: explicit capped grid so sim particles == mesh vertices.
    const [sx, sy] = resolveSegments(config.sheet, 2)
    const capped = Math.min(Math.max(sx, sy), CLOTH_MAX_SEGMENTS)
    return new THREE.PlaneGeometry(config.sheet.width, config.sheet.height, capped, capped)
  }, [sheetKey, minSegments, autoSegments, isCloth])

  // Imperatively-created geometry is ours to free — R3F only auto-disposes
  // JSX-created objects, so a sheet change would otherwise orphan GPU buffers.
  useEffect(() => () => geometry.dispose(), [geometry])

  const basePositions = useMemo(
    () => Float32Array.from(geometry.attributes.position!.array as Float32Array),
    [geometry],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: Rebuild only on geometry or pin layout change — sliders update the sim in place.
  const sim = useMemo(() => {
    if (!isCloth) return null
    const cloth = configRef.current.physics as ClothConfig
    const cols = (geometry.parameters as { widthSegments: number }).widthSegments + 1
    const rows = (geometry.parameters as { heightSegments: number }).heightSegments + 1
    return new ClothSim(cols, rows, config.sheet.width, config.sheet.height, cloth.pins, {
      stiffness: cloth.stiffness,
      gravity: cloth.gravity,
      wind: cloth.wind,
      floor: cloth.floor,
    })
  }, [geometry, isCloth, isCloth ? (config.physics as ClothConfig).pins : ''])

  const stock = getStock(config.stock)
  const texture = useContentTexture(config.content, config.sheet, stock)
  const backTexture = useContentTexture(config.content.back, config.sheet, stock)

  // Per-frame config: when a state machine is live it OWNS the animated numeric
  // values (GSAP tweens them); we poll its mutable liveConfig each frame rather
  // than routing every tick through React. Falls back to the React config for
  // non-stateful papers.
  const liveConfig = (): PaperConfig => machineRef.current?.liveConfig ?? configRef.current

  const effectiveOptions = (t: number): Record<string, unknown> | null => {
    const cfg = liveConfig()
    if (!cfg.behavior || !behavior) return null
    const o = { ...cfg.behavior, ...overridesRef.current }
    return behavior.loop ? { ...o, ...behavior.loop(o, t) } : o
  }

  const play = () => {
    if (!behavior) return
    playingRef.current = true
    if (tweenRef.current) {
      tweenRef.current.play()
      return
    }
    const param = behavior.progressParam
    const start = (effectiveOptions(0)?.[param] as number) ?? 0
    const state = { p: start }
    tweenRef.current = gsap.to(state, {
      p: 1,
      duration: behavior.duration * (1 - start),
      ease: 'power2.inOut',
      yoyo: behavior.loopMode === 'yoyo',
      repeat: -1,
      onRepeat: () => {
        if (behavior.loopMode === 'restart') state.p = 0
      },
      onUpdate: () => {
        const p = configRef.current.onTwos ? quantizeProgress(state.p, behavior.duration) : state.p
        overridesRef.current[param] = p
        dirtyRef.current = true
        props.onProgress?.(p)
      },
    })
  }

  const pause = () => {
    playingRef.current = false
    tweenRef.current?.pause()
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: Mount-only: autoplay starts once, and the cleanup kills the tween on unmount.
  useEffect(() => {
    if (props.autoplay && !reduced) play()
    return () => {
      tweenRef.current?.kill()
      tweenRef.current = null
    }
  }, [])

  const snapshot = (): PaperConfig => {
    // Re-attach `states`: the rendered config is the animated view with the
    // machine stripped, but a snapshot is a preset — states are part of it.
    const states = resolvedRef.current.states
    const cfg = states ? { ...configRef.current, states } : configRef.current
    if (!cfg.behavior) return states ? paperConfigSchema.parse(cfg) : cfg
    return paperConfigSchema.parse({
      ...cfg,
      behavior: { ...cfg.behavior, ...overridesRef.current },
    })
  }

  useImperativeHandle(ref, () => ({
    play,
    pause,
    get playing() {
      return playingRef.current
    },
    set(param: string, value: unknown) {
      const key = param === 'progress' && behavior ? behavior.progressParam : param
      overridesRef.current[key] = value
      dirtyRef.current = true
      if (behavior && key === behavior.progressParam) props.onProgress?.(value as number)
    },
    getProgress() {
      if (!behavior) return 0
      return (effectiveOptions(0)?.[behavior.progressParam] as number) ?? 0
    },
    snapshot,
    toJSON: () => serializePreset(snapshot()),
    get mesh() {
      return meshRef.current
    },
    get state() {
      return machineState
    },
    sendState: (event: StateEvent) => machineRef.current?.send(event) ?? null,
    pickProgrammatic: () => machineRef.current?.pickProgrammatic() ?? false,
    placeProgrammatic: () => machineRef.current?.placeProgrammatic() ?? false,
    returnProgrammatic: () => machineRef.current?.returnProgrammatic() ?? false,
  }))

  const idlePose = useRef<IdlePose>({ position: [0, 0, 0], rotation: [0, 0, 0] })

  useFrame(({ clock }, delta) => {
    const cfg = liveConfig()
    // Reduced motion freezes time-driven deformers at their resting phase.
    const now = reduced ? 0 : cfg.onTwos ? quantizeTime(clock.elapsedTime) : clock.elapsedTime

    // Whole-sheet motion — idle presets and behavior transforms (flight's
    // travel across the scene) compose additively; vertices stay untouched.
    const hasBehaviorTransform = Boolean(behavior?.transform && cfg.behavior)
    if ((idle?.transform || hasBehaviorTransform) && groupRef.current) {
      const pose = idlePose.current
      pose.position[0] = pose.position[1] = pose.position[2] = 0
      pose.rotation[0] = pose.rotation[1] = pose.rotation[2] = 0
      idle?.transform?.(now, pose)
      if (hasBehaviorTransform) {
        const o = effectiveOptions(now)
        if (o) behavior!.transform!(o, now, pose)
      }
      const base = props.position ?? [0, 0, 0]
      const baseRot = props.rotation ?? [0, 0, 0]
      groupRef.current.position.set(
        base[0] + pose.position[0],
        base[1] + pose.position[1],
        base[2] + pose.position[2],
      )
      groupRef.current.rotation.set(
        baseRot[0] + pose.rotation[0],
        baseRot[1] + pose.rotation[1],
        baseRot[2] + pose.rotation[2],
      )
    }

    // Simulation path: cloth owns the vertices.
    if (isCloth && sim) {
      const cloth = cfg.physics as ClothConfig
      sim.setParams({
        wind: cloth.wind,
        gravity: cloth.gravity,
        stiffness: cloth.stiffness,
        floor: cloth.floor,
      })
      sim.step(delta)
      if (!sim.asleep) {
        const position = geometry.attributes.position as THREE.BufferAttribute
        ;(position.array as Float32Array).set(sim.positions)
        position.needsUpdate = true
        geometry.computeVertexNormals()
      }
      return
    }

    // Shape path: the deformer stack.
    const stack = buildStack(cfg, overridesRef.current, behavior, now)
    if (!stack) return
    const animated = !reduced && stackIsAnimated(stack)
    const hasLoop = !reduced && Boolean(cfg.behavior && behavior?.loop)
    // A state transition tweens numeric leaves off the React path, so the
    // stack must re-apply every frame while the machine is transitioning.
    const machineAnimating = Boolean(machineRef.current?.transitioning)
    if (!dirtyRef.current && !hasLoop && !animated && !machineAnimating) return
    dirtyRef.current = false

    const ctx = { t: now, sheet: cfg.sheet }
    applyDeformerStack(geometry, basePositions, stack, ctx)

    if (props.interactive && behavior?.handles) {
      const o = effectiveOptions(now)
      behavior.handles.forEach((h, i) => {
        const mesh = handleRefs.current[i]
        if (!mesh || !o) return
        const [u, v] = h.anchor(o, cfg.sheet)
        anchorScratch.set((u - 0.5) * cfg.sheet.width, (v - 0.5) * cfg.sheet.height, 0)
        displacePoint(anchorScratch, u, v, stack, ctx)
        mesh.position.copy(anchorScratch)
      })
    }
  })

  const localDragPoint = (e: ThreeEvent<PointerEvent>): { x: number; y: number } | null => {
    const group = groupRef.current
    if (!group) return null
    planeNormal.set(0, 0, 1).applyQuaternion(group.getWorldQuaternion(quatScratch))
    dragPlane.setFromNormalAndCoplanarPoint(planeNormal, group.getWorldPosition(dragPoint))
    const hit = e.ray.intersectPlane(dragPlane, dragPoint)
    if (!hit) return null
    group.worldToLocal(hit)
    return { x: hit.x, y: hit.y }
  }

  const onHandleDrag = (e: ThreeEvent<PointerEvent>) => {
    if (!behavior?.handles || !draggingRef.current) return
    const handleSpec = behavior.handles.find((h) => h.id === draggingRef.current)
    const local = localDragPoint(e)
    const o = effectiveOptions(0)
    if (!handleSpec || !local || !o) return
    Object.assign(overridesRef.current, handleSpec.drag(local, o, configRef.current.sheet))
    dirtyRef.current = true
    const p = overridesRef.current[behavior.progressParam]
    if (typeof p === 'number') props.onProgress?.(p)
  }

  // Cloth grab: pick the nearest particle, then drag it on a camera-facing
  // plane through the grab point — full 3D pull, not just in-plane.
  const grabAnchor = useRef(new THREE.Vector3())
  const clothDown = (e: ThreeEvent<PointerEvent>) => {
    if (!isCloth || !sim || !props.interactive || !groupRef.current) return
    e.stopPropagation()
    if (controls) controls.enabled = false
    grabAnchor.current.copy(e.point) // world-space anchor for the drag plane
    const local = groupRef.current.worldToLocal(worldScratch.copy(e.point))
    sim.grabNearest(local.x, local.y, local.z)
    draggingRef.current = 'cloth'
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }
  const clothMove = (e: ThreeEvent<PointerEvent>) => {
    if (draggingRef.current !== 'cloth' || !sim || !groupRef.current) return
    camera.getWorldDirection(planeNormal)
    dragPlane.setFromNormalAndCoplanarPoint(planeNormal, grabAnchor.current)
    const hit = e.ray.intersectPlane(dragPlane, dragPoint)
    if (!hit) return
    groupRef.current.worldToLocal(hit)
    sim.moveGrab(hit.x, hit.y, hit.z)
  }
  const clothUp = (e: ThreeEvent<PointerEvent>) => {
    if (draggingRef.current !== 'cloth' || !sim) return
    draggingRef.current = null
    if (controls) controls.enabled = true
    sim.release()
    ;(e.target as Element).releasePointerCapture(e.pointerId)
  }

  // Interaction-state triggers (rest ↔ hover ↔ pressed); pick/place/return
  // are driven by the field's carry controller through `sendState`.
  const sendState = (event: StateEvent) => machineRef.current?.send(event)

  return (
    <group ref={groupRef} position={props.position} rotation={props.rotation}>
      <mesh
        ref={meshRef}
        geometry={geometry}
        castShadow
        receiveShadow
        frustumCulled={false}
        onPointerOver={statesLive ? () => sendState('enter') : undefined}
        onPointerOut={statesLive ? () => sendState('leave') : undefined}
        onPointerDown={
          isCloth || statesLive
            ? (e) => {
                if (isCloth) clothDown(e)
                if (statesLive) sendState('down')
              }
            : undefined
        }
        onPointerMove={isCloth ? clothMove : undefined}
        onPointerUp={
          isCloth || statesLive
            ? (e) => {
                if (isCloth) clothUp(e)
                if (statesLive) sendState('up')
              }
            : undefined
        }
      >
        <PaperMaterial
          stock={stock}
          texture={texture}
          backTexture={backTexture}
          surface={config.surface}
          thickness={config.sheet.thickness}
          sheet={config.sheet}
          lighting={config.scene.lighting}
        />
      </mesh>
      {props.interactive &&
        !isCloth &&
        behavior?.handles?.map((h, i) => (
          <mesh
            key={h.id}
            ref={(m) => {
              handleRefs.current[i] = m
            }}
            onPointerDown={(e) => {
              e.stopPropagation()
              draggingRef.current = h.id
              pause()
              if (controls) controls.enabled = false
              ;(e.target as Element).setPointerCapture(e.pointerId)
            }}
            onPointerMove={onHandleDrag}
            onPointerUp={(e) => {
              if (!draggingRef.current) return
              draggingRef.current = null
              if (controls) controls.enabled = true
              ;(e.target as Element).releasePointerCapture(e.pointerId)
              props.onBehaviorChange?.({ ...overridesRef.current })
            }}
          >
            <sphereGeometry args={[0.035, 16, 16]} />
            <meshBasicMaterial color="#4f7cff" depthTest={false} transparent opacity={0.9} />
          </mesh>
        ))}
    </group>
  )
})

/** Expand the config into the deformer stack that should run this frame. */
function buildStack(
  config: PaperConfig,
  overrides: Record<string, unknown>,
  behavior?: Behavior | null,
  t = 0,
): DeformerInstance[] | null {
  // Cloth owns the vertices — no deformer stack.
  if (typeof config.physics === 'object') return null
  const idle =
    typeof config.physics === 'string' && config.physics !== 'none'
      ? getIdlePreset(config.physics as IdleName)
      : null
  const idleStack = idle?.stack?.() ?? []

  let shapeStack: DeformerInstance[] = []
  if (config.deformers) {
    // Raw deformer stack wins — it's the Advanced fork of a behavior.
    shapeStack = resolveDeformerStack(config.deformers)
  } else if (config.behavior) {
    const b = behavior ?? getBehavior(config.behavior.type)
    let options: Record<string, unknown> = { ...config.behavior, ...overrides }
    if (b.loop) options = { ...options, ...b.loop(options, t) }
    shapeStack = b.stack(options, config.sheet)
  }

  const combined = [...shapeStack, ...idleStack]
  return combined.length > 0 ? combined : null
}
