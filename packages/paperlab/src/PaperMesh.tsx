import * as THREE from 'three'
import { gsap } from 'gsap'
import { useFrame, useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import type {
  BehaviorConfig,
  ContentConfig,
  DeformerInstanceConfig,
  PaperConfig,
  PaperConfigInput,
  SheetConfig,
  StockName,
} from './config/schema'
import { paperConfigSchema } from './config/schema'
import { mergeConfig, parsePreset, serializePreset } from './config/serialize'
import { createSheetGeometry } from './core/sheet'
import { getStock } from './core/stock'
import { getPreset } from './config/presets'
import { useContentTexture } from './content/texture'
import { applyDeformerStack, displacePoint, stackMinSegments } from './deformers/compose'
import { PaperMaterial } from './surface/PaperMaterial'
import type { DeformerInstance } from './deformers/types'
import { getBehavior } from './behaviors/registry'
import type { Behavior } from './behaviors/types'

export interface PaperMeshProps {
  /** Built-in preset name, or a (partial) preset object. Props below override it. */
  preset?: string | PaperConfigInput
  sheet?: Partial<SheetConfig>
  stock?: StockName
  content?: ContentConfig
  behavior?: BehaviorConfig
  deformers?: DeformerInstanceConfig[]
  onTwos?: boolean
  /** Show draggable behavior handles (corner grabs etc.). */
  interactive?: boolean
  /** Start the behavior's transport loop on mount. */
  autoplay?: boolean
  position?: [number, number, number]
  rotation?: [number, number, number]
  /** Fires every animation tick with the behavior's progress (0..1). */
  onProgress?(value: number): void
  /** Fires when a handle drag ends, with the params the drag changed. */
  onBehaviorChange?(patch: Record<string, unknown>): void
}

export interface PaperHandle {
  play(): void
  pause(): void
  readonly playing: boolean
  /** Live-override a behavior param, e.g. `set('progress', 0.5)`. */
  set(param: string, value: unknown): void
  getProgress(): number
  /** Current full state (including live overrides) as a preset. */
  snapshot(): PaperConfig
  toJSON(): string
  readonly mesh: THREE.Mesh | null
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
  if (props.onTwos !== undefined) overrides.onTwos = props.onTwos
  return paperConfigSchema.parse(mergeConfig(base as PaperConfigInput, overrides))
}

const dragPlane = new THREE.Plane()
const dragPoint = new THREE.Vector3()
const planeNormal = new THREE.Vector3()
const anchorScratch = new THREE.Vector3()

/**
 * The atom: one sheet of paper, hero-mode CPU path. The deformer stack runs
 * in JS, writing geometry positions (correct raycasting, shadows, handles).
 * GSAP owns animated values; useFrame owns geometry writes — never both.
 */
export const PaperMesh = forwardRef<PaperHandle, PaperMeshProps>(function PaperMesh(props, ref) {
  const config = resolveConfig(props)
  const behavior: Behavior | null = config.behavior ? getBehavior(config.behavior.type) : null

  const meshRef = useRef<THREE.Mesh>(null)
  const groupRef = useRef<THREE.Group>(null)
  const handleRefs = useRef<(THREE.Mesh | null)[]>([])

  // Live param overrides (transport progress, handle drags) — merged over
  // config.behavior each frame, never persisted into React state.
  const overridesRef = useRef<Record<string, unknown>>({})
  const dirtyRef = useRef(true)
  const playingRef = useRef(false)
  const tweenRef = useRef<gsap.core.Tween | null>(null)
  const draggingRef = useRef<string | null>(null)

  // Latest config, readable from stable callbacks/imperative methods.
  const configRef = useRef(config)
  configRef.current = config

  // Whatever makeDefault camera controls the scene has — paused during handle drags.
  const controls = useThree((s) => s.controls) as { enabled?: boolean } | null

  const behaviorKey = JSON.stringify(config.behavior ?? null)
  const deformersKey = JSON.stringify(config.deformers ?? null)
  const sheetKey = JSON.stringify(config.sheet)

  // Config edits invalidate live overrides (except while dragging/playing,
  // where the override IS the newest value and gets rewritten next tick).
  useEffect(() => {
    if (!draggingRef.current && !playingRef.current) overridesRef.current = {}
    dirtyRef.current = true
  }, [behaviorKey, deformersKey, sheetKey])

  const minSegments = useMemo(() => {
    const probe = buildStack(configRef.current, {})
    return probe ? stackMinSegments(probe) : 2
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [behaviorKey, deformersKey])

  const geometry = useMemo(
    () => createSheetGeometry(config.sheet, minSegments),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sheetKey, minSegments],
  )
  const basePositions = useMemo(
    () => Float32Array.from(geometry.attributes.position!.array as Float32Array),
    [geometry],
  )

  const stock = getStock(config.stock)
  const texture = useContentTexture(config.content, config.sheet, stock)

  const effectiveOptions = (t: number): Record<string, unknown> | null => {
    const cfg = configRef.current
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
        overridesRef.current[param] = state.p
        dirtyRef.current = true
        props.onProgress?.(state.p)
      },
    })
  }

  const pause = () => {
    playingRef.current = false
    tweenRef.current?.pause()
  }

  useEffect(() => {
    if (props.autoplay) play()
    return () => {
      tweenRef.current?.kill()
      tweenRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const snapshot = (): PaperConfig => {
    const cfg = configRef.current
    if (!cfg.behavior) return cfg
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
      overridesRef.current[param] = value
      dirtyRef.current = true
      if (behavior && param === behavior.progressParam) props.onProgress?.(value as number)
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
  }))

  useFrame(({ clock }) => {
    const cfg = configRef.current
    const hasLoop = Boolean(cfg.behavior && behavior?.loop)
    if (!dirtyRef.current && !hasLoop) return
    dirtyRef.current = false

    const stack = buildStack(cfg, overridesRef.current, behavior, clock.elapsedTime)
    if (!stack) return
    const ctx = { t: clock.elapsedTime, sheet: cfg.sheet }
    applyDeformerStack(geometry, basePositions, stack, ctx)

    // Keep handle grab points riding the deformed surface.
    if (props.interactive && behavior?.handles) {
      const o = effectiveOptions(clock.elapsedTime)
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
    // Drag against the paper's flat plane (local z=0) in world space.
    planeNormal.set(0, 0, 1).applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion()))
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

  return (
    <group ref={groupRef} position={props.position} rotation={props.rotation}>
      <mesh ref={meshRef} geometry={geometry} castShadow receiveShadow frustumCulled={false}>
        <PaperMaterial
          stock={stock}
          texture={texture}
          surface={config.surface}
          thickness={config.sheet.thickness}
        />
      </mesh>
      {props.interactive &&
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
  // Raw deformer stack wins — it's the Advanced fork of a behavior.
  if (config.deformers) return config.deformers as DeformerInstance[]
  if (!config.behavior) return null
  const b = behavior ?? getBehavior(config.behavior.type)
  let options: Record<string, unknown> = { ...config.behavior, ...overrides }
  if (b.loop) options = { ...options, ...b.loop(options, t) }
  return b.stack(options, config.sheet)
}
